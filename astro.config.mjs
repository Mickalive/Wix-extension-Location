// @ts-check
import { defineConfig, envField } from 'astro/config';
import wix from '@wix/astro';
import react from '@astrojs/react';
import wixHostingAdapter from '@wix/astro-wix-hosting-adapter';

export default defineConfig({
  output: 'server',
  adapter: wixHostingAdapter(),
  integrations: [wix(), react()],
  image: { domains: ['static.wixstatic.com'] },
  security: { checkOrigin: false },
  devToolbar: { enabled: false },
  env: {
    schema: {
      ABR_COLLECTION_ID: envField.string({ context: 'server', access: 'public' }),
    },
  },
});
