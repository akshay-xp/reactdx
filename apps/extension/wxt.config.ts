import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'ReactDX',
    permissions: ['scripting', 'storage'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'reactdx@akxp.net',
          // world: "MAIN" content scripts arrived in Firefox 128.
          strict_min_version: '128.0',
          // ReactDX never sends data anywhere.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
