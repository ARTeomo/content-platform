/**
 * Rate limit budgets for Meta Graph API calls.
 *
 * Two independent kinds, matching Meta's Business Use Case (BUC) rate
 * limit model:
 *
 *   - `publish`     — pages_manage_posts (feed posts, photo posts)
 *   - `engagement`  — pages_manage_engagement (comment replies)
 *
 * Each kind has three independent budgets:
 *
 *   - `perHourPerDestination` — a single Page cannot exceed this many
 *     calls within a one-hour sliding window.
 *   - `globalPerHour` — across all destinations, the App cannot exceed
 *     this many calls within a one-hour sliding window.
 *   - `globalPerDay` — across all destinations, the App cannot exceed
 *     this many calls within a 24-hour sliding window.
 *
 * All three are enforced simultaneously. A call is allowed only when
 * every bucket is below its limit.
 */
export interface RateLimitBudget {
  perHourPerDestination: number;
  globalPerHour: number;
  globalPerDay: number;
}

export interface RateLimitConfig {
  publish: RateLimitBudget;
  engagement: RateLimitBudget;
}

/**
 * Conservative defaults. Meta's actual BUC limits depend on the number
 * of engaged users on the Page and can exceed these values
 * substantially, but a fixed conservative budget is safe across Pages
 * of any size.
 *
 * These values apply when `meta.rate_limit.budgets` is absent from
 * `system_config`.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  publish: {
    perHourPerDestination: 10,
    globalPerHour: 100,
    globalPerDay: 1000,
  },
  engagement: {
    perHourPerDestination: 30,
    globalPerHour: 200,
    globalPerDay: 2000,
  },
};
