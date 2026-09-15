import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';
import { contentItems } from '../content/content-items.js';

/**
 * Image discovery, resolution, and validation artifact associated with
 * content.
 *
 * `content_id` is nullable with ON DELETE SET NULL: an image may outlive
 * its originating content item for rights and forensic purposes. This
 * mirrors the pattern used by `external_interactions` toward its parent
 * entities.
 *
 * `status` is a domain-validated text value. The final image status
 * vocabulary is outside DB v1 scope (deferred decision D-002).
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §5.20
 */
export const images = pgTable(
  'images',
  {
    id: idColumn(),
    contentId: uuid('content_id').references(() => contentItems.id, {
      onDelete: 'set null',
    }),
    sourceUrl: text('source_url').notNull(),
    resolvedUrl: text('resolved_url'),
    mimeType: text('mime_type'),
    width: integer('width'),
    height: integer('height'),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    status: text('status').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('images_content_id_idx').on(table.contentId),
    index('images_status_idx').on(table.status),
    check('images_width_check', sql`${table.width} IS NULL OR ${table.width} > 0`),
    check('images_height_check', sql`${table.height} IS NULL OR ${table.height} > 0`),
    check(
      'images_file_size_bytes_check',
      sql`${table.fileSizeBytes} IS NULL OR ${table.fileSizeBytes} >= 0`,
    ),
  ],
);
