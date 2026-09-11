// Renders .astro pages through Astro's container API. Kept separate from the
// main vitest config because it loads the full Astro/Vite pipeline.
//   npx vitest run --config vitest.render.config.ts
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: { include: ['tests/render/**/*.test.ts'], globals: true },
});
