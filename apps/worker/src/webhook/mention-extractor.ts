import type { ExternalInteractionDraft } from '@content-platform/database';
import type { ChangeExtractor, ChangeExtractionContext } from './change-extractor.js';
import type { MetaWebhookChange } from './types.js';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * Extract MENTION interactions from a `mention` change.
 *
 * A mention is when another Page mentions ours. The `post_id` is the
 * mentioning post, `sender_id` is the actor.
 */
export class MentionChangeExtractor implements ChangeExtractor {
  readonly field = 'mention';

  async extract(
    change: MetaWebhookChange,
    context: ChangeExtractionContext,
  ): Promise<ExternalInteractionDraft[]> {
    const value = change.value;
    const postId = asString(value.post_id);
    const senderId = asString(value.sender_id);
    const message = asString(value.message);
    const createdTime = asNumber(value.created_time);

    if (!postId || !senderId) return [];

    return [
      {
        webhookEventId: context.webhookEventId,
        ...(context.destinationId && { destinationId: context.destinationId }),
        interactionType: 'MENTION',
        externalInteractionId: `${senderId}:${postId}`,
        parentExternalId: postId,
        actorExternalId: senderId,
        ...(message !== undefined && { content: message }),
        occurredAt: new Date((createdTime ?? Math.floor(Date.now() / 1000)) * 1000),
        rawMetadata: { postId, senderId },
      },
    ];
  }
}
