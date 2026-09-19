import {
  PublicationAttemptsRepository,
  PublicationReconciliationsRepository,
  PublicationsRepository,
  sql,
  type Database,
  type TransactionManager,
} from '@content-platform/database';
import type { MetaPublicationReconciler } from '@content-platform/publishers';
import type { PublicationReconcileJobData, ReconcileOutcome } from './types.js';

export interface PublicationReconcileServiceDeps {
  db: Database;
  txManager: TransactionManager;
  publicationsRepo: PublicationsRepository;
  attemptsRepo: PublicationAttemptsRepository;
  reconciliationsRepo: PublicationReconciliationsRepository;
  reconciler: MetaPublicationReconciler;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

interface ReconcileContextRow {
  publication_id: string;
  publication_status: string;
  destination_id: string;
  candidate_title: string;
  candidate_caption: string;
  candidate_summary: string;
  destination_external_id: string;
}

/**
 * Pull-based reconciliation for publications stuck in RECONCILIATION.
 *
 * The push path (a feed webhook event for our own post) is handled by
 * `webhook.process`. This service is the bounded fallback: it inspects
 * the destination Page's feed for a matching message body.
 *
 * State transitions applied here:
 *   RECONCILIATION → PUBLISHED       (match found)
 *   RECONCILIATION → RETRY           (no match, past propagation grace)
 *   RECONCILIATION → RECONCILIATION  (inconclusive; reconciliation recorded)
 *   RECONCILIATION → FAILED          (no attempt record — data integrity issue)
 */
export class PublicationReconcileService {
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly deps: PublicationReconcileServiceDeps) {
    this.log = deps.logger ?? console;
  }

  async reconcile(job: PublicationReconcileJobData): Promise<ReconcileOutcome> {
    const { publicationId } = job;

    const context = await this.loadContext(publicationId);
    if (!context) {
      return { status: 'SKIPPED', reason: 'publication not found' };
    }

    if (context.publication_status !== 'RECONCILIATION') {
      return { status: 'SKIPPED', reason: `status is ${context.publication_status}` };
    }

    const attempt = await this.deps.attemptsRepo.findLatestForPublication(publicationId);
    if (!attempt) {
      this.log.error(
        `[publication.reconcile] publication ${publicationId} has no attempt; marking FAILED`,
      );
      const at = new Date();
      await this.deps.txManager.run(async (tx) => {
        await this.deps.publicationsRepo.markFailed(tx, publicationId);
        await this.deps.reconciliationsRepo.record(tx, {
          publicationId,
          status: 'UNKNOWN',
          checkedAt: at,
          result: 'NO_ATTEMPT_FOUND',
          details: { reason: 'no attempt record for reconciliation' },
        });
      });
      return { status: 'SKIPPED', reason: 'no attempt record' };
    }

    const message = buildMessage(context);
    const attemptStartedAt = attempt.startedAt ?? attempt.createdAt;

    const result = await this.deps.reconciler.pull({
      destinationId: context.destination_id,
      pageId: context.destination_external_id,
      expectedMessage: message,
      attemptStartedAt,
    });

    const at = new Date();

    switch (result.status) {
      case 'PUBLISHED': {
        await this.deps.txManager.run(async (tx) => {
          await this.deps.publicationsRepo.markPublished(
            tx,
            publicationId,
            result.externalPostId,
            at,
          );
          await this.deps.attemptsRepo.finishSuccess(tx, attempt.id, at, result.externalPostId);
          await this.deps.reconciliationsRepo.record(tx, {
            publicationId,
            attemptId: attempt.id,
            status: 'PUBLISHED',
            checkedAt: at,
            externalPostId: result.externalPostId,
            result: 'MATCHED_VIA_FEED',
          });
        });
        this.log.info(
          `[publication.reconcile] publication ${publicationId} → PUBLISHED (${result.externalPostId})`,
        );
        return { status: 'PUBLISHED', externalPostId: result.externalPostId };
      }

      case 'RETRY_ELIGIBLE': {
        await this.deps.txManager.run(async (tx) => {
          await this.deps.publicationsRepo.markRetry(tx, publicationId);
          await this.deps.attemptsRepo.finishFailure(
            tx,
            attempt.id,
            at,
            'RETRY',
            'RECONCILED_NO_MATCH',
            'Reconciliation found no matching post on the destination feed',
          );
          await this.deps.reconciliationsRepo.record(tx, {
            publicationId,
            attemptId: attempt.id,
            status: 'RETRY_ELIGIBLE',
            checkedAt: at,
            result: 'NO_MATCH',
          });
        });
        this.log.warn(`[publication.reconcile] publication ${publicationId} → RETRY_ELIGIBLE`);
        return { status: 'RETRY_ELIGIBLE' };
      }

      case 'UNKNOWN':
      default: {
        await this.deps.txManager.run(async (tx) => {
          await this.deps.reconciliationsRepo.record(tx, {
            publicationId,
            attemptId: attempt.id,
            status: 'UNKNOWN',
            checkedAt: at,
            result: 'STILL_UNKNOWN',
            details: { reason: result.reason },
          });
        });
        this.log.warn(
          `[publication.reconcile] publication ${publicationId} → STILL_UNKNOWN (${result.reason})`,
        );
        return { status: 'STILL_UNKNOWN', reason: result.reason };
      }
    }
  }

  /**
   * Load the publication and everything needed to reconstruct the
   * outbound message. The message is reconstructed from the candidate;
   * if the candidate was edited after the attempt, the reconciliation
   * may miss the match. This is a known limitation of DB v1: candidates
   * are immutable once approved, so the reconstruction is deterministic
   * in normal operation.
   */
  private async loadContext(publicationId: string): Promise<ReconcileContextRow | undefined> {
    const rows = (await this.deps.db.execute(sql`
      SELECT
        p.id              AS publication_id,
        p.status          AS publication_status,
        p.destination_id  AS destination_id,
        c.title           AS candidate_title,
        c.caption         AS candidate_caption,
        c.summary         AS candidate_summary,
        d.external_id     AS destination_external_id
      FROM publications p
      INNER JOIN publication_candidates c ON c.id = p.publication_candidate_id
      INNER JOIN destinations d ON d.id = p.destination_id
      WHERE p.id = ${publicationId}
      LIMIT 1
    `)) as unknown as ReconcileContextRow[];

    return rows[0];
  }
}

function buildMessage(context: ReconcileContextRow): string {
  if (context.candidate_caption.length > 0) return context.candidate_caption;
  if (context.candidate_summary.length > 0) return context.candidate_summary;
  return context.candidate_title;
}
