import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// --mode 18 or 19 picks the React copy; each mode gets its own prebundle cache.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  cacheDir: `node_modules/.vite-react-${mode}`,
  resolve: {
    alias: [
      { find: /^react(\/.*)?$/, replacement: `react-${mode}$1` },
      { find: /^react-dom(\/.*)?$/, replacement: `react-dom-${mode}$1` },
    ],
  },
}))
