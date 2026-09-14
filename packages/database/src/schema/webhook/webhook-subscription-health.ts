import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { nullableTimestampColumn, updatedAtColumn } from '../_common.js';
import { webhookSubscriptions } from './webhook-subscriptions.js';

/**
 * Operational health extension for a webhook subscription.
 *
 * Strict 1:1 extension. Mirrors the pattern established by
 * `source_endpoint_health` for source endpoints: high-frequency
 * operational updates are separated from relatively stable configuration.
 *
 * The record is created automatically when its owning subscription is
 * created and is deleted with it.
 *
 * Storage now, use later: the table is part of DB v1.2; consumption
 * (alerting, auto-pause, dashboards) is deferred (see D-009).
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.44
 */
export const webhookSubscriptionHealth = pgTable(
  'webhook_subscription_health',
  {
    subscriptionId: uuid('subscription_id')
      .primaryKey()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    consecutiveSuccesses: integer('consecutive_successes').notNull().default(0),
    lastSuccessAt: nullableTimestampColumn('last_success_at'),
    lastFailureAt: nullableTimestampColumn('last_failure_at'),
    lastErrorCategory: varchar('last_error_category', { length: 64 }),
    lastErrorMessage: text('last_error_message'),
    eventsToday: integer('events_today').notNull().default(0),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('webhook_subscription_health_last_failure_at_idx').on(table.lastFailureAt),
    check('webhook_subscription_health_failures_check', sql`${table.consecutiveFailures} >= 0`),
    check('webhook_subscription_health_successes_check', sql`${table.consecutiveSuccesses} >= 0`),
    check('webhook_subscription_health_events_today_check', sql`${table.eventsToday} >= 0`),
  ],
);
