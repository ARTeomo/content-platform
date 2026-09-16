import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@content-platform/database': resolve(__dirname, '../../packages/database/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share a single PostgreSQL and Redis. Running
    // test files in parallel would cause one file's TRUNCATE to wipe
    // another file's in-flight rows.
    fileParallelism: false,
  },
});
