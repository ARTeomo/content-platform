-- ---------------------------------------------------------------------------
-- Phase 20 — seed default interaction response configuration.
--
-- These are the fail-safe defaults the worker expects to find in
-- `system_config`. Operators can override any of them at runtime; the
-- worker reloads them on the next process start.
--
-- The rule set is intentionally empty: the policy engine is
-- fail-closed, so an empty rule set routes every inbound comment to
-- MODERATION_REQUIRED. The operator must add AUTO_RESPOND rules to
-- activate the auto-response path.
-- ---------------------------------------------------------------------------

INSERT INTO system_config (key, value) VALUES
  (
    'interaction_response_rules',
    '[]'::jsonb
  ),
  (
    'interaction_response_templates',
    '{}'::jsonb
  ),
  (
    'interaction_response.max_per_hour_per_destination',
    '20'::jsonb
  ),
  (
    'interaction_response.min_interval_seconds',
    '30'::jsonb
  ),
  (
    'interaction_response.global_max_per_hour',
    '100'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
