import { pgTable, text } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn } from '../_common.js';

/**
 * Authenticated application role.
 *
 * Canonical role names: VIEWER, EDITOR, PUBLISHER, ADMIN.
 *
 * A role is referenced by users. It is not itself a user attribute; the
 * role describes a set of permissions, and users are assigned to a role.
 */
export const roles = pgTable('roles', {
  id: idColumn(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: createdAtColumn(),
});
