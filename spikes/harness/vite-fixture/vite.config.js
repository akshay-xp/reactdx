import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  cacheDir: `node_modules/.vite-react-${mode}`,
  build: { rollupOptions: { input: ['index.html', 'other.html'] } },
  resolve: {
    alias: [
      { find: /^react(\/.*)?$/, replacement: `react-${mode}$1` },
      { find: /^react-dom(\/.*)?$/, replacement: `react-dom-${mode}$1` },
    ],
  },
}));
