import type { ExternalInteractionDraft } from '@content-platform/database';
import type { MetaWebhookChange } from './types.js';

export interface ChangeExtractionContext {
  /** Destination id resolved from the Page ID, or `null` if unknown. */
  destinationId: string | null;
  /** The `webhook_events.id` that originated this change. */
  webhookEventId: string;
  /** Resolve a `publication_id` from a Meta `post_id` if known. */
  resolvePublicationId: (postId: string) => Promise<string | null>;
}

/**
 * A field-specific change extractor.
 *
 * Extractors return zero or more drafts. An empty array means the change
 * was recognized but does not produce an interaction (e.g. a status
 * update on our own post).
 */
export interface ChangeExtractor {
  readonly field: string;
  extract(
    change: MetaWebhookChange,
    context: ChangeExtractionContext,
  ): Promise<ExternalInteractionDraft[]>;
}

/**
 * Registry of change extractors, keyed by field name.
 *
 * Unsupported fields are skipped silently — this is how the platform
 * tolerates new Meta fields without breaking existing events.
 */
export class ChangeExtractorRegistry {
  private readonly extractors = new Map<string, ChangeExtractor>();

  register(extractor: ChangeExtractor): this {
    this.extractors.set(extractor.field, extractor);
    return this;
  }

  get(field: string): ChangeExtractor | undefined {
    return this.extractors.get(field);
  }

  has(field: string): boolean {
    return this.extractors.has(field);
  }
}
