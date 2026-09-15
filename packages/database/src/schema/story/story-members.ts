import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  real,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { idColumn } from '../_common.js';
import { stories } from './stories.js';
import { contentItems } from '../content/content-items.js';

/**
 * Explicit N:M relationship between Stories and ContentItems.
 *
 * A ContentItem may participate in multiple Stories, and a Story may
 * contain multiple ContentItems. DB v1 does not impose a global
 * one-story-only constraint.
 *
 * `membership_type` distinguishes a PRIMARY member (the preferred
 * representation for the story) from a MENTIONED member.
 * `assignment_method` distinguishes automatic clustering from manual
 * editorial assignment.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.19
 * @see DB v1 Logical Model Specification §17
 */
export const storyMembers = pgTable(
  'story_members',
  {
    id: idColumn(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    relevanceScore: real('relevance_score').notNull(),
    membershipType: varchar('membership_type', { length: 32 }).notNull(),
    assignmentMethod: varchar('assignment_method', { length: 32 }).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('story_members_story_content_uq').on(table.storyId, table.contentItemId),
    index('story_members_story_added_at_idx').on(table.storyId, table.addedAt),
    index('story_members_content_item_id_idx').on(table.contentItemId),
    check(
      'story_members_relevance_check',
      sql`${table.relevanceScore} >= 0 AND ${table.relevanceScore} <= 1`,
    ),
    check(
      'story_members_membership_check',
      sql`${table.membershipType} IN ('PRIMARY', 'MENTIONED')`,
    ),
    check(
      'story_members_assignment_check',
      sql`${table.assignmentMethod} IN ('AUTOMATIC', 'MANUAL')`,
    ),
  ],
);
