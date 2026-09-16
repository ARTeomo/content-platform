import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share a single PostgreSQL database. Running test
    // files in parallel would cause one file's TRUNCATE to wipe another
    // file's in-flight rows.
    fileParallelism: false,
  },
});
