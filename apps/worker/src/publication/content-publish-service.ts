import { createHash } from 'node:crypto';
import {
  PublicationAttemptsRepository,
  PublicationsRepository,
  sql,
  type Database,
  type TransactionManager,
} from '@content-platform/database';
import type { MetaPublisherAdapter } from '@content-platform/publishers';
import type { ContentPublishJobData, PublicationContext, PublishOutcome } from './types.js';

export interface ContentPublishServiceDeps {
  db: Database;
  txManager: TransactionManager;
  publicationsRepo: PublicationsRepository;
  attemptsRepo: PublicationAttemptsRepository;
  publisherAdapter: MetaPublisherAdapter;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

interface PublicationContextRow {
  publication_id: string;
  publication_status: string;
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

/**
 * Orchestrates publishing a single Publication to its destination.
 *
 * State machine transitions:
 *   SCHEDULED | RETRY  →  RESERVED  →  IN_PROGRESS  →  PUBLISHED
 *                                                  ├→ RETRY
 *                                                  ├→ FAILED
 *                                                  └→ RECONCILIATION
 *
 * Called by the `content.publish` worker for one publication per job.
 */
export class ContentPublishService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: ContentPublishServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async publish(job: ContentPublishJobData): Promise<PublishOutcome> {
    const { publicationId } = job;

    // 1. Load the joined context.
    const context = await this.loadContext(publicationId);
    if (!context) {
      return { status: 'SKIPPED', reason: 'publication not found' };
    }

    // 2. Guard: only SCHEDULED and RETRY are eligible.
    if (context.publicationStatus !== 'SCHEDULED' && context.publicationStatus !== 'RETRY') {
      return {
        status: 'SKIPPED',
        reason: `status is ${context.publicationStatus}`,
      };
    }

    // 3. Reserve + mark IN_PROGRESS atomically (single transaction).
    await this.deps.txManager.run(async (tx) => {
      await this.deps.publicationsRepo.markReserved(tx, publicationId);
      await this.deps.publicationsRepo.markInProgress(tx, publicationId);
    });

    // 4. Build the outbound payload.
    const message = buildMessage(context);
    const link = context.candidateSourceUrl;
    const imageUrl = context.imageResolvedUrl ?? context.imageSourceUrl ?? undefined;
    const requestPayloadHash = hashOutboundPayload({
      pageId: context.destinationExternalId,
      message,
      link,
      imageUrl,
    });

    // 5. Record the attempt (PENDING).
    const attempt = await this.deps.txManager.run(async (tx) =>
      this.deps.attemptsRepo.startAttempt(tx, publicationId),
    );

    // 6. Call the adapter.
    const result = await this.deps.publisherAdapter.postToPage({
      destinationId: context.destinationId,
      pageId: context.destinationExternalId,
      message,
      link,
      ...(imageUrl !== undefined && { imageUrl }),
      requestPayloadHash,
    });

    const at = new Date();

    // 7. Apply the outcome.
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
        });
        this.log.info(
          `[content.publish] publication ${publicationId} → PUBLISHED (${result.externalPostId})`,
        );
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
        return {
          status: 'FAILED',
          errorCategory: result.errorCategory,
          shouldInvalidateCredential: result.shouldInvalidateCredential ?? false,
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

  /**
   * Load the publication and everything needed to build the outbound
   * post. Single SQL query with joins; returns undefined if the
   * publication does not exist.
   */
  private async loadContext(publicationId: string): Promise<PublicationContext | undefined> {
    const rows = (await this.deps.db.execute(sql`
      SELECT
        p.id                       AS publication_id,
        p.status                   AS publication_status,
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

/**
 * Build the outbound post message from the candidate.
 *
 * DB v1 uses the candidate's caption as the message body. If caption is
 * empty, the summary is used. If both are empty, the title is used.
 * The source URL is passed separately as the `link` field.
 */
function buildMessage(context: PublicationContext): string {
  if (context.candidateCaption.length > 0) return context.candidateCaption;
  if (context.candidateSummary.length > 0) return context.candidateSummary;
  return context.candidateTitle;
}

/**
 * Deterministic hash of the outbound payload. Used as
 * request_payload_hash on the attempt record for reconciliation.
 */
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
