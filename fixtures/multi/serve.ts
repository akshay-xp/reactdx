import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { build } from "esbuild"

const root = import.meta.dirname
const PORT = 5221

// One Vite alias set can't serve two React copies on one page, so each root is its own bundle.
// esbuild's alias also rewrites react-dom's internal `react` import and `react/jsx-dev-runtime`.
await Promise.all(
  ["18", "19"].map((version) =>
    build({
      absWorkingDir: root,
      entryPoints: [`src/root-${version}.jsx`],
      outfile: `dist/root-${version}.js`,
      bundle: true,
      format: "iife",
      jsx: "automatic",
      jsxDev: true,
      define: { "process.env.NODE_ENV": '"development"' },
      alias: { react: `react-${version}`, "react-dom": `react-dom-${version}` },
      logLevel: "warning",
    }),
  ),
)

const files: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"],
  "/root-18.js": ["dist/root-18.js", "text/javascript"],
  "/root-19.js": ["dist/root-19.js", "text/javascript"],
}

createServer(async (request, response) => {
  const file = files[new URL(request.url ?? "/", "http://localhost").pathname]
  if (!file) return response.writeHead(404).end()
  response
    .writeHead(200, { "content-type": file[1] })
    .end(await readFile(path.join(root, file[0])))
}).listen(PORT, () => console.log(`multi fixture on http://localhost:${PORT}`))
