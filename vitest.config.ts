import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Each project takes react and react-dom from its own test-env package, so react-dom's
// CommonJS require('react') resolves to the matching React (npm aliases can't do that).
const project = (major: string, version: string) => ({
  test: { name: `react-${major}`, environment: 'jsdom', env: { REACT_VERSION: version } },
  resolve: {
    alias: [
      {
        find: /^(react|react-dom)(\/.*)?$/,
        replacement: `${path.resolve(import.meta.dirname, `test-env/react-${major}/node_modules`)}/$1$2`,
      },
    ],
  },
});

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}'],
    projects: [project('18', '18.3.'), project('19', '19.')],
  },
});
