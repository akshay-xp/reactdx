import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// Property keys React's own builds read; minifiers can't rename them.
const REACT_MARKERS = [
  "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
  "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
  "__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
]
export const MAX_HOOK_BYTES = 2048
const SCANNED = new Set([".js", ".html", ".json", ".css"])
// Each match becomes `<rule> (<first capture group>)`.
const PATTERNS: [rule: string, pattern: RegExp][] = [
  // A method named eval (".eval") is told apart from the global's.
  ["dynamic code", /(\.?\b(?:eval|Function))\s*\(/g],
  // XML namespace strings (Solid's SVG/MathML) are identifiers, not loads.
  ["remote URL", /\b((?:https?|wss?):\/\/(?!www\.w3\.org\/)[^\s"'`)]+)/g],
  // Banned outright: a static scan can't tell which origin a call reaches.
  [
    "network API",
    /\b(fetch|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/g,
  ],
]

// The panel's own needs (docs/check.md): it reads the inspected page's scripts and
// source maps and asks its dev server to open the editor, and reads the page's
// origin with devtools.inspectedWindow.eval, which runs in the page. Its source map
// library (@jridgewell/resolve-uri) parses relative paths against a placeholder base.
const PANEL = /^chunks\/panel-[\w-]+\.js$/
const ALLOWED = new Set([
  "network API (fetch)",
  "dynamic code (.eval)",
  "remote URL (http://foo.com)",
  "remote URL (http://foo.com/)",
])
const allowed = (file: string, finding: string) =>
  PANEL.test(file.split(path.sep).join("/")) && ALLOWED.has(finding)

// Returns one `<file>: <rule>` line per invariant the built extension in `dir` breaks.
export function checkBundle(dir: string): string[] {
  const violations: string[] = []
  for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (!SCANNED.has(path.extname(file))) continue
    const text = readFileSync(path.join(dir, file), "utf8")
    // CSS comments never load; Tailwind's MIT notice carries a URL.
    const scanned =
      path.extname(file) === ".css"
        ? text.replace(/\/\*[\s\S]*?\*\//g, "")
        : text
    const bytes = Buffer.byteLength(text)
    if (file === "content-scripts/hook.js" && bytes > MAX_HOOK_BYTES) {
      violations.push(
        `${file}: hook.js is ${bytes} bytes, over ${MAX_HOOK_BYTES}`,
      )
    }
    const marker = REACT_MARKERS.find((name) => text.includes(name))
    if (marker) violations.push(`${file}: React (${marker})`)
    for (const [rule, pattern] of PATTERNS) {
      const found = new Set(
        Array.from(scanned.matchAll(pattern), (match) => match[1]),
      )
      for (const name of found)
        if (!allowed(file, `${rule} (${name})`))
          violations.push(`${file}: ${rule} (${name})`)
    }
  }
  return violations
}
