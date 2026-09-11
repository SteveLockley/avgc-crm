import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/render/**', 'node_modules/**'],   // .astro renders need vitest.render.config.ts
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
});
