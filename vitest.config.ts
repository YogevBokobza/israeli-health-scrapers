import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Browser-backed tests opt in via IHS_TEST_BROWSER=1 so the default `npm test`
    // stays hermetic and runs anywhere, including CI without browsers installed.
    environment: 'node',
  },
});
