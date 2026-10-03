import { randomUUID } from 'node:crypto';
import type { MetaPublishRateLimiter, MetaRateLimiter, RateLimitDecision } from './meta-types.js';
import type { RateLimitConfig } from './meta-rate-limiter-config.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Minimal Redis client interface.
 *
 * Matches the `eval` signature of `ioredis` without forcing
 * `packages/publishers` to depend on `ioredis` at runtime. The worker
 * passes its own Redis client instance.
 */
export interface RateLimiterRedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * Atomic check-and-reserve.
 *
 * Keys and args:
 *   KEYS[1] — destination hourly window (sorted set)
 *   KEYS[2] — global hourly window (sorted set)
 *   KEYS[3] — global daily window (sorted set)
 *   ARGV[1] — now_ms
 *   ARGV[2] — hour_window_ms
 *   ARGV[3] — day_window_ms
 *   ARGV[4] — per-destination max
 *   ARGV[5] — global hourly max
 *   ARGV[6] — global daily max
 *   ARGV[7] — unique request id
 *
 * Returns:
 *   { 1, min_remaining, 0 }              — allowed
 *   { 0, 0, retry_after_seconds }        — denied
 *
 * Sliding window: expired entries are pruned on every call. Only the
 * entries in the current window count toward the limit.
 */
const CHECK_AND_RESERVE_LUA = `
local now = tonumber(ARGV[1])
local hour_window = tonumber(ARGV[2])
local day_window = tonumber(ARGV[3])
local dest_max = tonumber(ARGV[4])
local global_hour_max = tonumber(ARGV[5])
local global_day_max = tonumber(ARGV[6])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - hour_window)
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now - hour_window)
redis.call('ZREMRANGEBYSCORE', KEYS[3], 0, now - day_window)

local dest_count = redis.call('ZCARD', KEYS[1])
local global_hour_count = redis.call('ZCARD', KEYS[2])
local global_day_count = redis.call('ZCARD', KEYS[3])

local max_wait_seconds = 0
local denied = 0

if dest_count >= dest_max then
  denied = 1
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local wait_ms = tonumber(oldest[2]) + hour_window - now
  local wait_sec = math.ceil(wait_ms / 1000)
  if wait_sec > max_wait_seconds then max_wait_seconds = wait_sec end
end

if global_hour_count >= global_hour_max then
  denied = 1
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local wait_ms = tonumber(oldest[2]) + hour_window - now
  local wait_sec = math.ceil(wait_ms / 1000)
  if wait_sec > max_wait_seconds then max_wait_seconds = wait_sec end
end

if global_day_count >= global_day_max then
  denied = 1
  local oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  local wait_ms = tonumber(oldest[2]) + day_window - now
  local wait_sec = math.ceil(wait_ms / 1000)
  if wait_sec > max_wait_seconds then max_wait_seconds = wait_sec end
end

if denied == 1 then
  return {0, 0, max_wait_seconds}
end

redis.call('ZADD', KEYS[1], now, ARGV[7])
redis.call('ZADD', KEYS[2], now, ARGV[7])
redis.call('ZADD', KEYS[3], now, ARGV[7])

redis.call('PEXPIRE', KEYS[1], hour_window)
redis.call('PEXPIRE', KEYS[2], hour_window)
redis.call('PEXPIRE', KEYS[3], day_window)

local dest_remaining = dest_max - dest_count - 1
local global_hour_remaining = global_hour_max - global_hour_count - 1
local global_day_remaining = global_day_max - global_day_count - 1
local min_remaining = dest_remaining
if global_hour_remaining < min_remaining then min_remaining = global_hour_remaining end
if global_day_remaining < min_remaining then min_remaining = global_day_remaining end

return {1, min_remaining, 0}
`;

export interface RedisMetaRateLimiterOptions {
  redis: RateLimiterRedisLike;
  config: RateLimitConfig;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/**
 * Redis-backed rate limiter for Meta Graph API calls.
 *
 * Implements both the interaction (`pages_manage_engagement`) and the
 * publication (`pages_manage_posts`) interfaces so a single instance
 * can be injected into both adapters.
 *
 * ## Failure mode
 *
 * If the Redis call itself fails, the limiter **fails closed**: the
 * call is denied with a 60-second retry hint. This is intentional.
 * If we cannot prove we are under the Meta BUC limit, we must not make
 * the call. A Redis outage is a temporary condition; a Meta BUC ban is
 * a prolonged one.
 */
export class RedisMetaRateLimiter implements MetaRateLimiter, MetaPublishRateLimiter {
  constructor(private readonly options: RedisMetaRateLimiterOptions) {}

  async checkEngagement(destinationId: string): Promise<RateLimitDecision> {
    return this.check('engagement', destinationId);
  }

  async checkPublish(destinationId: string): Promise<RateLimitDecision> {
    return this.check('publish', destinationId);
  }

  private async check(
    kind: 'publish' | 'engagement',
    destinationId: string,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const requestId = randomUUID();
    const budget = this.options.config[kind];

    // Hash tags ensure all three keys for a kind map to the same Redis
    // Cluster slot, which is required for multi-key Lua scripts.
    const destKey = `ratelimit:{${kind}}:dest:${destinationId}:hour`;
    const globalHourKey = `ratelimit:{${kind}}:global:hour`;
    const globalDayKey = `ratelimit:{${kind}}:global:day`;

    let raw: unknown;
    try {
      raw = await this.options.redis.eval(
        CHECK_AND_RESERVE_LUA,
        3,
        destKey,
        globalHourKey,
        globalDayKey,
        now,
        HOUR_MS,
        DAY_MS,
        budget.perHourPerDestination,
        budget.globalPerHour,
        budget.globalPerDay,
        requestId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger().error(`[rate-limit] redis error during ${kind} check: ${msg}`);
      return { allowed: false, retryAfterSeconds: 60 };
    }

    const result = raw as [number, number, number];
    if (result[0] === 1) {
      return { allowed: true, remaining: result[1] };
    }
    return {
      allowed: false,
      remaining: result[1],
      retryAfterSeconds: result[2],
    };
  }

  private logger(): Pick<Console, 'info' | 'warn' | 'error'> {
    return this.options.logger ?? console;
  }
}
