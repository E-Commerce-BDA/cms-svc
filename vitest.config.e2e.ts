import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // The relay is decided at module-declaration time (it reads this variable
    // while the module is being imported), so it has to be in the environment
    // before the app boots. e2e suites drive `drainOnce()` by hand instead.
    env: { DISABLE_OUTBOX_RELAY: 'true' },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
