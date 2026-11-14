import { createHash } from 'node:crypto';
import {
  type PublicationAttemptsRepository,
  type PublicationsRepository,
  sql,
  type Database,
  type TransactionManager,
} from '@content-platform/database';
import type { MetaPublisherAdapter } from '@content-platform/publishers';
import type { AlertingService } from '../observability/index.js';
import type { ContentPublishJobData, PublicationContext, PublishOutcome } from './types.js';

export interface ContentPublishServiceDeps {
  db: Database;
  txManager: TransactionManager;
  publicationsRepo: PublicationsRepository;
  attemptsRepo: PublicationAttemptsRepository;
  publisherAdapter: MetaPublisherAdapter;
  alerting?: AlertingService;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

interface PublicationContextRow {
  publication_id: string;
  publication_status: string;
  content_id: string;
  destination_id: string;
  publication_candidate_id: string;
  external_post_id: string | null;
  candidate_title: string;
  candidate_caption: string;
  candidate_summary: string;
  candidate_source_url: string;
  candidate_image_id: string | null;
  destination_external_id: string;
  destination_name: string;
  image_resolved_url: string | null;
  image_source_url: string | null;
}

export class ContentPublishService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: ContentPublishServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async publish(job: ContentPublishJobData): Promise<PublishOutcome> {
    const { publicationId } = job;

    const context = await this.loadContext(publicationId);
    if (!context) {
      return { status: 'SKIPPED', reason: 'publication not found' };
    }

    const eligible =
      context.publicationStatus === 'SCHEDULED' ||
      context.publicationStatus === 'RESERVED' ||
      context.publicationStatus === 'RETRY';
    if (!eligible) {
      return { status: 'SKIPPED', reason: `status is ${context.publicationStatus}` };
    }

    const claimed = await this.deps.txManager.run(async (tx) =>
      this.deps.publicationsRepo.claimForPublishing(tx, publicationId),
    );
    if (!claimed) {
      return { status: 'SKIPPED', reason: 'concurrent claim lost' };
    }

    const message = buildMessage(context);
    const link = context.candidateSourceUrl;
    const imageUrl = context.imageResolvedUrl ?? context.imageSourceUrl ?? undefined;
    const requestPayloadHash = hashOutboundPayload({
      pageId: context.destinationExternalId,
      message,
      link,
      imageUrl,
    });

    const attempt = await this.deps.txManager.run(async (tx) =>
      this.deps.attemptsRepo.startAttempt(tx, publicationId),
    );

    const result = await this.deps.publisherAdapter.postToPage({
      destinationId: context.destinationId,
      pageId: context.destinationExternalId,
      message,
      link,
      ...(imageUrl !== undefined && { imageUrl }),
      requestPayloadHash,
    });

    const at = new Date();

    switch (result.status) {
      case 'SUCCESS': {
        await this.deps.txManager.run(async (tx) => {
          await this.deps.publicationsRepo.markPublished(
            tx,
            publicationId,
            result.externalPostId,
            at,
          );
          await this.deps.attemptsRepo.finishSuccess(tx, attempt.id, at, result.externalPostId);
          // First-success rule (owner decision 2026-11-14): the parent
          // content item flips to PUBLISHED on the first successful
          // destination publication. `COALESCE` keeps the earliest
          // timestamp when further destinations succeed later.
          const parent = (await tx.execute(sql`
            UPDATE content_items
            SET status = 'PUBLISHED',
                published_at = COALESCE(published_at, ${at}),
                updated_at = now()
            WHERE id = ${context.contentId}
            RETURNING id
          `)) as unknown as Array<{ id: string }>;
          if (parent.length === 0) {
            // Parent missing: the external post is real, so the
            // publication success stands; only the parent flip is lost.
            this.log.warn(
              `[content.publish] publication ${publicationId} succeeded but parent content item ${context.contentId} is missing; publication success retained`,
            );
          }
          // Resolve prior open failure notifications for this
          // content/destination pair (is_read untouched).
          await tx.execute(sql`
            UPDATE notifications
            SET resolved_at = now()
            WHERE resolved_at IS NULL
              AND type = 'publication_failure'
              AND publication_id IN (
                SELECT p.id
                FROM publications p
                INNER JOIN publication_candidates pc ON pc.id = p.publication_candidate_id
                WHERE pc.content_id = ${context.contentId}
                  AND p.destination_id = ${context.destinationId}
              )
          `);
        });
        this.log.info(
          `[content.publish] publication ${publicationId} → PUBLISHED (${result.externalPostId})`,
        );
        if (this.deps.alerting) {
          await this.deps.alerting.publicationPublished(publicationId, result.externalPostId);
        }
        return { status: 'PUBLISHED', externalPostId: result.externalPostId };
      }

      case 'RETRY': {
        await this.deps.txManager.run(async (tx) => {
          await this.deps.publicationsRepo.markRetry(tx, publicationId);
          await this.deps.attemptsRepo.finishFailure(
            tx,
            attempt.id,
            at,
            'RETRY',
            result.errorCategory,
            result.errorMessage,
          );
        });
        this.log.warn(
          `[content.publish] publication ${publicationId} → RETRY (${result.errorCategory})`,
        );
        return { status: 'RETRY', errorCategory: result.errorCategory };
      }

      case 'FAILED': {
        await this.deps.txManager.run(async (tx) => {
          await this.deps.publicationsRepo.markFailed(tx, publicationId);
          await this.deps.attemptsRepo.finishFailure(
            tx,
            attempt.id,
            at,
            'FAILED',
            result.errorCategory,
            result.errorMessage,
          );
        });
        this.log.error(
          `[content.publish] publication ${publicationId} → FAILED (${result.errorCategory})`,
        );
        if (this.deps.alerting) {
          await this.deps.alerting.publicationFailed(
            publicationId,
            result.errorCategory,
            result.errorMessage,
          );
        }
        return {
          status: 'FAILED',
          errorCategory: result.errorCategory,
          shouldInvalidateCredential: result.shouldInvalidateCredential ?? false,
          destinationId: context.destinationId,
        };
      }

      case 'UNKNOWN': {
        await this.deps.txManager.run(async (tx) => {
          await this.deps.publicationsRepo.markReconciliation(tx, publicationId);
          await this.deps.attemptsRepo.finishFailure(
            tx,
            attempt.id,
            at,
            'UNKNOWN',
            result.errorCategory,
            result.errorMessage,
          );
        });
        this.log.warn(
          `[content.publish] publication ${publicationId} → RECONCILIATION (${result.errorCategory})`,
        );
        return { status: 'RECONCILIATION', errorCategory: result.errorCategory };
      }
    }
  }

  private async loadContext(publicationId: string): Promise<PublicationContext | undefined> {
    const rows = (await this.deps.db.execute(sql`
      SELECT
        p.id                       AS publication_id,
        p.status                   AS publication_status,
        c.content_id               AS content_id,
        p.destination_id           AS destination_id,
        p.publication_candidate_id AS publication_candidate_id,
        p.external_post_id         AS external_post_id,
        c.title                    AS candidate_title,
        c.caption                  AS candidate_caption,
        c.summary                  AS candidate_summary,
        c.source_url               AS candidate_source_url,
        c.image_id                 AS candidate_image_id,
        d.external_id              AS destination_external_id,
        d.name                     AS destination_name,
        i.resolved_url             AS image_resolved_url,
        i.source_url               AS image_source_url
      FROM publications p
      INNER JOIN publication_candidates c ON c.id = p.publication_candidate_id
      INNER JOIN destinations d ON d.id = p.destination_id
      LEFT JOIN images i ON i.id = c.image_id
      WHERE p.id = ${publicationId}
      LIMIT 1
    `)) as unknown as PublicationContextRow[];

    const row = rows[0];
    if (!row) return undefined;

    return {
      publicationId: row.publication_id,
      publicationStatus: row.publication_status,
      contentId: row.content_id,
      destinationId: row.destination_id,
      publicationCandidateId: row.publication_candidate_id,
      externalPostId: row.external_post_id,
      candidateTitle: row.candidate_title,
      candidateCaption: row.candidate_caption,
      candidateSummary: row.candidate_summary,
      candidateSourceUrl: row.candidate_source_url,
      candidateImageId: row.candidate_image_id,
      destinationExternalId: row.destination_external_id,
      destinationName: row.destination_name,
      imageResolvedUrl: row.image_resolved_url,
      imageSourceUrl: row.image_source_url,
    };
  }
}

function buildMessage(context: PublicationContext): string {
  if (context.candidateCaption.length > 0) return context.candidateCaption;
  if (context.candidateSummary.length > 0) return context.candidateSummary;
  return context.candidateTitle;
}

function hashOutboundPayload(input: {
  pageId: string;
  message: string;
  link: string;
  imageUrl: string | undefined;
}): string {
  const payload = JSON.stringify({
    pageId: input.pageId,
    message: input.message,
    link: input.link,
    imageUrl: input.imageUrl ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}
