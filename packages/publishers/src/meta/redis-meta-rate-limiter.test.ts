import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis, type RedisOptions } from 'ioredis';
import { RedisMetaRateLimiter } from './redis-meta-rate-limiter.js';
import type { RateLimitConfig } from './meta-rate-limiter-config.js';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

function redisOptionsFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const opts: RedisOptions = {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    family: 4,
    maxRetriesPerRequest: 3,
    // Keep the offline queue enabled so commands issued before the
    // connection is ready are buffered instead of failing. Production
    // uses `enableOfflineQueue: false` to fail fast; tests want
    // reliability.
    enableOfflineQueue: true,
  };
  if (parsed.username) opts.username = decodeURIComponent(parsed.username);
  if (parsed.password) opts.password = decodeURIComponent(parsed.password);
  if (parsed.protocol === 'rediss:' || parsed.hostname.endsWith('.upstash.io')) {
    opts.tls = { servername: parsed.hostname };
  }
  return opts;
}

/**
 * Delete all keys matching a pattern using SCAN + DEL.
 *
 * Upstash does not support the `KEYS` command on production instances,
 * so we iterate with `SCAN` instead.
 */
async function deleteByPattern(redis: Redis, pattern: string): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0');
  return deleted;
}

describe.skipIf(!TEST_REDIS_URL)('RedisMetaRateLimiter', () => {
  let redis: Redis;
  let limiter: RedisMetaRateLimiter;

  const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dest = (suffix: string): string => `test-${RUN_ID}-${suffix}`;

  const config: RateLimitConfig = {
    publish: {
      perHourPerDestination: 3,
      globalPerHour: 10,
      globalPerDay: 100,
    },
    engagement: {
      perHourPerDestination: 2,
      globalPerHour: 5,
      globalPerDay: 50,
    },
  };

  beforeAll(async () => {
    redis = new Redis(redisOptionsFromUrl(TEST_REDIS_URL!));
    redis.on('error', () => {
      /* suppress test noise */
    });
    // Block until the connection is established. With
    // `enableOfflineQueue: true` the PING is queued and sent as soon
    // as the socket becomes writable.
    await redis.ping();
    limiter = new RedisMetaRateLimiter({ redis, config });
  });

  afterAll(async () => {
    await deleteByPattern(redis, 'ratelimit:*');
    await redis.quit();
  });

  beforeEach(async () => {
    await deleteByPattern(redis, 'ratelimit:*');
  });

  it('allows calls under the per-destination limit', async () => {
    const r1 = await limiter.checkPublish(dest('a'));
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await limiter.checkPublish(dest('a'));
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.checkPublish(dest('a'));
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('denies calls over the per-destination limit', async () => {
    const d = dest('b');
    await limiter.checkPublish(d);
    await limiter.checkPublish(d);
    await limiter.checkPublish(d);

    const denied = await limiter.checkPublish(d);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('keeps destinations independent', async () => {
    const d1 = dest('c1');
    const d2 = dest('c2');

    await limiter.checkPublish(d1);
    await limiter.checkPublish(d1);
    await limiter.checkPublish(d1);

    const r1 = await limiter.checkPublish(d1);
    expect(r1.allowed).toBe(false);

    const r2 = await limiter.checkPublish(d2);
    expect(r2.allowed).toBe(true);
  });

  it('keeps publish and engagement budgets independent', async () => {
    const d = dest('d');

    // Publish: per-dest limit is 3
    await limiter.checkPublish(d);
    await limiter.checkPublish(d);
    await limiter.checkPublish(d);
    const pubDenied = await limiter.checkPublish(d);
    expect(pubDenied.allowed).toBe(false);

    // Engagement: per-dest limit is 2, fresh bucket
    const eng1 = await limiter.checkEngagement(d);
    expect(eng1.allowed).toBe(true);

    const eng2 = await limiter.checkEngagement(d);
    expect(eng2.allowed).toBe(true);

    const eng3 = await limiter.checkEngagement(d);
    expect(eng3.allowed).toBe(false);
  });

  it('enforces the global hourly limit across destinations', async () => {
    // publish global per-hour = 10; per-dest = 3
    const d1 = dest('e1');
    const d2 = dest('e2');
    const d3 = dest('e3');
    const d4 = dest('e4');

    for (let i = 0; i < 3; i++) await limiter.checkPublish(d1);
    for (let i = 0; i < 3; i++) await limiter.checkPublish(d2);
    for (let i = 0; i < 3; i++) await limiter.checkPublish(d3);

    // 10th call: global hour allows, per-dest allows
    const r10 = await limiter.checkPublish(d4);
    expect(r10.allowed).toBe(true);

    // 11th call: global hour exhausted
    const r11 = await limiter.checkPublish(d4);
    expect(r11.allowed).toBe(false);
    expect(r11.retryAfterSeconds).toBeGreaterThan(0);
  });
});
