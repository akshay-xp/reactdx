import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// --mode 18 or 19 picks the React copy; each mode gets its own prebundle cache.
// bench.html is cross-origin isolated: performance.now() then steps 5 us, not
// 100 us, and e2e/perf.test.ts times our hook per commit in tenths of a ms (#76).
const isolateBench = {
  name: "isolate-bench",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] === "/bench.html") {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
      }
      next()
    })
  },
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), isolateBench],
  cacheDir: `node_modules/.vite-react-${mode}`,
  resolve: {
    alias: [
      { find: /^react(\/.*)?$/, replacement: `react-${mode}$1` },
      { find: /^react-dom(\/.*)?$/, replacement: `react-dom-${mode}$1` },
    ],
  },
}))
