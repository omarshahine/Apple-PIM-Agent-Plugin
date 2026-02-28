import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://apple-pim.omarknows.app',
  base: '/',
  output: 'static',
  integrations: [tailwind()],
});
