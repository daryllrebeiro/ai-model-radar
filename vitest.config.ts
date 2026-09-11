import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // P2-4 hygiene: worker JSON backends are deleted at startup (never the
    // dev `.radar-data.json`) so runs start from empty state.
    setupFiles: ['./tests/setup.ts'],
    // Serial by default: the local JSON backend is single-writer. Pass
    // --fileParallelism (npm run test:parallel, local mode only) to fan out —
    // each worker then gets its own .radar-data-worker-<id>.json via
    // VITEST_POOL_ID (see db/client.ts). Postgres mode stays serial:
    // parallel files would share tables without isolated schemas.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      // Ratchet thresholds on the engine/domain layer (P2). Raise deliberately.
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 55,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
