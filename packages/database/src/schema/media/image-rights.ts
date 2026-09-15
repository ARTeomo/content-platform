import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from '../_common.js';
import { images } from './images.js';

/**
 * Rights and attribution evaluation for an image.
 *
 * Strict 1:1 extension of `images`. The `rights_status` vocabulary is
 * domain-validated text; the final taxonomy remains outside DB v1 scope
 * (deferred decision D-003).
 *
 * `attribution_required` defaults to false so that the common case
 * (no attribution obligation) is the implicit one; setting it to true
 * requires the caller to provide `attribution_text`.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.21
 */
export const imageRights = pgTable(
  'image_rights',
  {
    id: idColumn(),
    imageId: uuid('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    rightsStatus: text('rights_status').notNull(),
    sourceDomain: text('source_domain'),
    attributionRequired: boolean('attribution_required').notNull().default(false),
    attributionText: text('attribution_text'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('image_rights_image_id_uq').on(table.imageId)],
);
