import type { CallSite } from "@reactdx/messages"
import { WEB } from "./source.ts"

// Names hooks from the modules the inspected page served. The parser (acorn) is
// its own chunk, loaded on the first call; each script is fetched and parsed once
// for the panel's lifetime, and a failure is tried again next time.
export function createHookNamer(fetch: typeof globalThis.fetch) {
  const modules = new Map<string, ReturnType<typeof load>>()
  const load = async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} for ${url}`)
    const code = await response.text()
    const parser = await import("./hook-names.ts")
    return { parser, code, ast: parser.parseModule(code) }
  }
  return async ({ url, line, column }: CallSite) => {
    if (!WEB.test(url)) return null
    let module = modules.get(url)
    if (!module) {
      module = load(url)
      modules.set(url, module)
      module.catch(() => modules.delete(url))
    }
    try {
      const { parser, code, ast } = await module
      return parser.hookNameAt(ast, code, line, column)
    } catch {
      return null
    }
  }
}
