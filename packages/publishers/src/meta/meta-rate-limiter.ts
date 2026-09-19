import type { MetaRateLimiter, RateLimitDecision } from './meta-types.js';

/**
 * No-op rate limiter that always allows.
 *
 * The production implementation is Redis-backed and shared between the
 * queue enqueue path and the adapter. It is not yet implemented; the
 * adapter uses this placeholder until that slice arrives.
 */
export class NoopMetaRateLimiter implements MetaRateLimiter {
  async checkEngagement(_destinationId: string): Promise<RateLimitDecision> {
    return { allowed: true };
  }
}
