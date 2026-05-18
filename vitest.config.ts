import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['packages/*/src/**', 'apps/*/src/**'],
    },
    testTimeout: 30000,
    // Integration tests share a single Postgres test database; running files
    // in parallel causes one suite's TRUNCATE to wipe another's data mid-test.
    // Force sequential execution to keep the test DB consistent.
    fileParallelism: false,
  },
});
