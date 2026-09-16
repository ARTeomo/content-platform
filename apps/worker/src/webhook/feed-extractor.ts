import type { ExternalInteractionDraft } from '@content-platform/database';
import type { ChangeExtractor, ChangeExtractionContext } from './change-extractor.js';
import type { MetaWebhookChange } from './types.js';

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/**
 * Extract COMMENT and REACTION interactions from a `feed` change.
 *
 * Recognized `item` values:
 *   - `comment` — creates a COMMENT interaction (add / edited / remove)
 *   - `reaction` — creates a REACTION interaction
 *   - `post` / `status` — ignored (they describe our own posts)
 */
export class FeedChangeExtractor implements ChangeExtractor {
  readonly field = 'feed';

  async extract(
    change: MetaWebhookChange,
    context: ChangeExtractionContext,
  ): Promise<ExternalInteractionDraft[]> {
    const value = change.value;
    const item = asString(value.item);
    const verb = asString(value.verb) ?? 'add';
    const createdTime = asNumber(value.created_time);

    if (item === 'comment') {
      const commentId = asString(value.comment_id);
      if (!commentId) return [];

      const postId = asString(value.post_id);
      const publicationId = postId ? await context.resolvePublicationId(postId) : null;

      const from = asObject(value.from);

      return [
        {
          webhookEventId: context.webhookEventId,
          ...(context.destinationId && { destinationId: context.destinationId }),
          ...(publicationId && { publicationId }),
          interactionType: 'COMMENT',
          externalInteractionId: commentId,
          ...(asString(value.parent_id) && { parentExternalId: asString(value.parent_id)! }),
          ...(asString(from?.id) && { actorExternalId: asString(from?.id)! }),
          ...(asString(from?.name) && { actorDisplayName: asString(from?.name)! }),
          ...(asString(value.message) !== undefined && { content: asString(value.message)! }),
          ...(asString(value.permalink) && { permalink: asString(value.permalink)! }),
          occurredAt: new Date((createdTime ?? Math.floor(Date.now() / 1000)) * 1000),
          rawMetadata: { item, verb, postId },
        },
      ];
    }

    if (item === 'reaction') {
      const postId = asString(value.post_id);
      if (!postId) return [];

      const reactionType = asString(value.reaction_type) ?? 'unknown';
      const publicationId = await context.resolvePublicationId(postId);
      const from = asObject(value.from);

      // Reactions do not carry their own id in all versions of the
      // payload. Synthesize a stable id from (postId, actorId, type).
      const actorId = asString(from?.id) ?? 'anonymous';
      const reactionId = `${postId}:${actorId}:${reactionType}`;

      return [
        {
          webhookEventId: context.webhookEventId,
          ...(context.destinationId && { destinationId: context.destinationId }),
          ...(publicationId && { publicationId }),
          interactionType: 'REACTION',
          externalInteractionId: reactionId,
          parentExternalId: postId,
          ...(asString(from?.id) && { actorExternalId: asString(from?.id)! }),
          ...(asString(from?.name) && { actorDisplayName: asString(from?.name)! }),
          content: reactionType,
          occurredAt: new Date((createdTime ?? Math.floor(Date.now() / 1000)) * 1000),
          rawMetadata: { item, verb, postId, reactionType },
        },
      ];
    }

    return [];
  }
}
