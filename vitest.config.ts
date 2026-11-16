import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@nexora/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@nexora/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@nexora/promptpay': fileURLToPath(new URL('./packages/promptpay/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/shared/src/**/*.test.ts',
      'packages/promptpay/src/**/*.test.ts',
      'apps/api/test/**/*.test.ts',
    ],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    setupFiles: ['apps/api/test/setup-env.ts'],
  },
});
