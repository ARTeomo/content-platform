import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle-kit configuration for the content-platform database package.
 *
 * @see DATABASE_SCHEMA_CONTRACT.md §10
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
