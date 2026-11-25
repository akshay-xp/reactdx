import {
  type CallSite,
  MAX_AWAITS,
  MAX_NAME,
  MAX_VALUE_STRING,
  type ServerAwait,
} from "@reactdx/messages"

// Reads React 19's ReactComponentInfo and the await entries beside it in a
// fiber's _debugInfo (docs/m7-findings.md). Every field is optional: a missing
// or odd one leaves its part out.
type Info = Record<string, unknown>

const isPosition = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1

// Where its parent's JSX rendered it: the info's first stack frame, `[name,
// file, line, column, ...]`, a server file (Next: an absolute chunk path).
export function renderedAt(info: Info): CallSite | undefined {
  const frame = Array.isArray(info.stack) ? info.stack[0] : undefined
  if (!Array.isArray(frame)) return
  const [, file, line, column] = frame
  if (typeof file !== "string" || !file) return
  if (!isPosition(line) || !isPosition(column)) return
  const url = file.startsWith("file:") ? file : `file://${file}`
  if (url.length <= MAX_VALUE_STRING) return { url, line, column }
}

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

// Its awaits: entries it owns, named by the await's own first frame (the app's
// call, `getProduct`), not the innermost awaited function (`sleep`).
export function awaitsOf(info: Info, entries: unknown[]): ServerAwait[] {
  const awaits: ServerAwait[] = []
  for (const entry of entries) {
    if (awaits.length === MAX_AWAITS) break
    const { awaited, owner, stack } = (entry ?? {}) as Info
    if (owner !== info || typeof awaited !== "object" || awaited === null)
      continue
    const { name, start, end } = awaited as Info
    if (!isTime(start) || !isTime(end) || end < start) continue
    const frame = Array.isArray(stack) ? stack[0] : undefined
    const called = Array.isArray(frame) ? frame[0] : undefined
    const named = [called, name].find((n) => typeof n === "string" && n)
    awaits.push({
      name: ((named as string | undefined) ?? "Promise").slice(0, MAX_NAME),
      start,
      end,
    })
  }
  return awaits
}
