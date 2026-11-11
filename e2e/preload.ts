import path from "node:path"
import { build } from "esbuild"

const hook = path.resolve(import.meta.dirname, "../packages/page/src/hook.ts")

// Forces an install order RDT's own timing wouldn't give: "first" installs ReactDX's hook
// before any page or extension script; "after-rdt" waits for RDT's hook (up to 2 s).
const entries = {
  first: "installHook(window)",
  "after-rdt": `const start = Date.now()
const wait = () =>
  Object.hasOwn(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__") || Date.now() - start > 2000
    ? installHook(window)
    : setTimeout(wait, 10)
wait()`,
}

export async function preloadHook(order: keyof typeof entries) {
  const result = await build({
    stdin: {
      contents: `import { installHook } from ${JSON.stringify(hook)}\n${entries[order]}`,
      loader: "ts",
      resolveDir: import.meta.dirname,
    },
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "warning",
  })
  return result.outputFiles[0]?.text ?? ""
}
