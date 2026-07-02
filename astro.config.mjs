import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true
    }
  }),
  integrations: [react()],
  site: 'https://www.alnmouthvillage.golf',
  vite: {
    ssr: {
      noExternal: ['react-dom'],
    },
    resolve: {
      alias: {
        'react-dom/server': 'react-dom/server.edge',
      }
    }
  }
});
