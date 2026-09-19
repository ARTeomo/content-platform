import type { MetaPublishRateLimiter, MetaRateLimiter, RateLimitDecision } from './meta-types.js';

/**
 * No-op rate limiter that always allows.
 *
 * The production implementation is Redis-backed and shared between the
 * queue enqueue path and the adapters. It is not yet implemented; the
 * adapters use this placeholder until that slice arrives.
 *
 * Implements both the engagement and the publish interface, so a single
 * instance can be injected into both adapters during development.
 */
export class NoopMetaRateLimiter implements MetaRateLimiter, MetaPublishRateLimiter {
  async checkEngagement(_destinationId: string): Promise<RateLimitDecision> {
    return { allowed: true };
  }

  async checkPublish(_destinationId: string): Promise<RateLimitDecision> {
    return { allowed: true };
  }
}
