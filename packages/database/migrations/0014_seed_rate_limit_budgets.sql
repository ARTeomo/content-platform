-- ---------------------------------------------------------------------------
-- Phase 20 — seed default Meta rate limit budgets.
--
-- These are conservative defaults that protect the App from exceeding
-- Meta's Business Use Case (BUC) rate limits. Operators can tune them
-- at runtime by updating this row; the worker reloads them on the next
-- process start.
--
-- The values apply to Meta Graph API calls only. They are independent
-- of the interaction response policy's max-responses-per-hour setting,
-- which is a product-level rate limit enforced before queueing.
-- ---------------------------------------------------------------------------

INSERT INTO system_config (key, value) VALUES
  (
    'meta.rate_limit.budgets',
    '{
      "publish": {
        "perHourPerDestination": 10,
        "globalPerHour": 100,
        "globalPerDay": 1000
      },
      "engagement": {
        "perHourPerDestination": 30,
        "globalPerHour": 200,
        "globalPerDay": 2000
      }
    }'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
