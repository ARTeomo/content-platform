import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from '../_common.js';

/**
 * Facebook Page, Instagram Account, or other publishing target.
 *
 * A destination represents **where** content may be published. It is
 * referenced by publications, webhook subscriptions, and provider
 * credentials.
 *
 * The deterministic destination identity is the unique combination of
 * `type` and `external_id`. Provider-specific credential material is not
 * part of this table.
 */
export const destinations = pgTable(
  'destinations',
  {
    id: idColumn(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    externalId: text('external_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    typeExternalIdUnique: uniqueIndex('destinations_type_external_id_unique').on(
      table.type,
      table.externalId,
    ),
  }),
);
