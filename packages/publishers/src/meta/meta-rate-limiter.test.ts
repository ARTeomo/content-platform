import { describe, expect, it } from 'vitest';
import { NoopMetaRateLimiter } from './meta-rate-limiter.js';

describe('NoopMetaRateLimiter', () => {
  it('always allows', async () => {
    const limiter = new NoopMetaRateLimiter();
    const decision = await limiter.checkEngagement('dest-1');
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterSeconds).toBeUndefined();
  });
});
