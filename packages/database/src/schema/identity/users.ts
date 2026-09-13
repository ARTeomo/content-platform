import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from '../_common.js';
import { roles } from './roles.js';

/**
 * Authenticated application user.
 *
 * A user belongs to exactly one role. Passwords are stored as hashes;
 * plaintext passwords are never persisted.
 */
export const users = pgTable('users', {
  id: idColumn(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});
