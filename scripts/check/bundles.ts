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
  ["dynamic code", /\b(eval|Function)\s*\(/g],
  // XML namespace strings (Solid's SVG/MathML) are identifiers, not loads.
  ["remote URL", /\b((?:https?|wss?):\/\/(?!www\.w3\.org\/)[^\s"'`)]+)/g],
  // Banned outright: a static scan can't tell which origin a call reaches.
  [
    "network API",
    /\b(fetch|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/g,
  ],
]

// Returns one `<file>: <rule>` line per invariant the built extension in `dir` breaks.
export function checkBundle(dir: string): string[] {
  const violations: string[] = []
  for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    if (!SCANNED.has(path.extname(file))) continue
    const text = readFileSync(path.join(dir, file), "utf8")
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
        Array.from(text.matchAll(pattern), (match) => match[1]),
      )
      for (const name of found) violations.push(`${file}: ${rule} (${name})`)
    }
  }
  return violations
}
