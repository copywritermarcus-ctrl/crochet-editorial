import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/helpers/globalSetup.ts'],
    // Every test builds its own SQLite file in a temp directory, so parallel
    // test files never contend. Migrations run once, in globalSetup.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
});
