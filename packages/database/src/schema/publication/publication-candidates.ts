import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from '../content/content-items.js';
import { stories } from '../story/stories.js';
import { images } from '../media/images.js';

/**
 * Persisted editorial publication candidate.
 *
 * A candidate represents a specific version of content intended for
 * publication. It is independent from transient worker execution state.
 * Multiple candidates may exist for the same content item (versioned
 * editorial revisions).
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.23
 */
export const publicationCandidates = pgTable(
  'publication_candidates',
  {
    id: idColumn(),
    contentId: uuid('content_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    caption: text('caption').notNull(),
    summary: text('summary').notNull(),
    sourceUrl: text('source_url').notNull(),
    imageId: uuid('image_id').references(() => images.id, { onDelete: 'set null' }),
    validationStatus: text('validation_status').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('publication_candidates_content_id_idx').on(table.contentId),
    index('publication_candidates_story_id_idx').on(table.storyId),
    index('publication_candidates_validation_status_idx').on(table.validationStatus),
    check('publication_candidates_version_check', sql`${table.version} > 0`),
    check(
      'publication_candidates_validation_status_check',
      sql`${table.validationStatus} IN ('PASS', 'FAIL', 'REVIEW')`,
    ),
  ],
);
