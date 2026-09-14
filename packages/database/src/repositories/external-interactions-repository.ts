import { and, eq, sql } from 'drizzle-orm';
import { externalInteractions } from '../schema/webhook/external-interactions.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type ExternalInteractionRow = typeof externalInteractions.$inferSelect;

export type InteractionType = 'COMMENT' | 'REACTION' | 'MENTION';

export interface ExternalInteractionDraft {
  webhookEventId?: string;
  destinationId?: string;
  publicationId?: string;
  interactionType: InteractionType;
  externalInteractionId: string;
  parentExternalId?: string;
  actorExternalId?: string;
  actorDisplayName?: string;
  content?: string;
  permalink?: string;
  occurredAt: Date;
  rawMetadata?: Record<string, unknown>;
}

export interface UpsertResult {
  interaction: ExternalInteractionRow;
  /** True if the incoming event was older than the persisted one and was skipped. */
  skipped: boolean;
}

/**
 * Repository for external interactions.
 *
 * The central operation is `upsertMonotonic`, which inserts a new
 * interaction or updates the existing one **only if** the incoming
 * `occurred_at` is newer than the persisted one. This protects against
 * out-of-order delivery by the external provider.
 */
export class ExternalInteractionsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Insert or update an interaction, enforcing monotonic `occurred_at`.
   *
   * If the incoming event is older than the persisted one, the persisted
   * row is left untouched and the result reports `skipped: true`.
   *
   * `publication_id` is preserved when the incoming event does not carry
   * one (COALESCE with the existing value).
   */
  async upsertMonotonic(tx: Transaction, draft: ExternalInteractionDraft): Promise<UpsertResult> {
    const rows = (await tx.execute(sql`
      INSERT INTO external_interactions (
        webhook_event_id,
        destination_id,
        publication_id,
        interaction_type,
        external_interaction_id,
        parent_external_id,
        actor_external_id,
        actor_display_name,
        content,
        permalink,
        occurred_at,
        raw_metadata
      )
      VALUES (
        ${draft.webhookEventId ?? null},
        ${draft.destinationId ?? null},
        ${draft.publicationId ?? null},
        ${draft.interactionType},
        ${draft.externalInteractionId},
        ${draft.parentExternalId ?? null},
        ${draft.actorExternalId ?? null},
        ${draft.actorDisplayName ?? null},
        ${draft.content ?? null},
        ${draft.permalink ?? null},
        ${draft.occurredAt},
        ${JSON.stringify(draft.rawMetadata ?? {})}::jsonb
      )
      ON CONFLICT (interaction_type, external_interaction_id)
      DO UPDATE SET
        webhook_event_id   = EXCLUDED.webhook_event_id,
        destination_id     = EXCLUDED.destination_id,
        publication_id     = COALESCE(EXCLUDED.publication_id, external_interactions.publication_id),
        parent_external_id = EXCLUDED.parent_external_id,
        actor_external_id  = EXCLUDED.actor_external_id,
        actor_display_name = EXCLUDED.actor_display_name,
        content            = EXCLUDED.content,
        permalink          = EXCLUDED.permalink,
        occurred_at        = EXCLUDED.occurred_at,
        raw_metadata       = EXCLUDED.raw_metadata,
        updated_at         = now()
      WHERE external_interactions.occurred_at <= EXCLUDED.occurred_at
      RETURNING *
    `)) as unknown as ExternalInteractionRow[];

    const first = rows[0];
    if (first) {
      return { interaction: first, skipped: false };
    }

    const [existing] = await tx
      .select()
      .from(externalInteractions)
      .where(
        and(
          eq(externalInteractions.interactionType, draft.interactionType),
          eq(externalInteractions.externalInteractionId, draft.externalInteractionId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error('Monotonic upsert skipped but no existing interaction found');
    }

    return { interaction: existing, skipped: true };
  }

  async findByExternalId(
    interactionType: InteractionType,
    externalInteractionId: string,
  ): Promise<ExternalInteractionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(externalInteractions)
      .where(
        and(
          eq(externalInteractions.interactionType, interactionType),
          eq(externalInteractions.externalInteractionId, externalInteractionId),
        ),
      )
      .limit(1);
    return row;
  }

  async findByPublicationId(publicationId: string): Promise<ExternalInteractionRow[]> {
    return await this.db
      .select()
      .from(externalInteractions)
      .where(eq(externalInteractions.publicationId, publicationId));
  }
}
