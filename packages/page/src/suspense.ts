import { MAX_NAME, type SuspenseCause } from "@reactdx/messages"
import { type Fiber, typeName } from "./tree.ts"

// Suspense waits (docs/page.md, Suspense): a boundary (tag 13) waits while its
// memoizedState is set: showing its fallback, or, in a streamed load, its
// server HTML not yet hydrated (`dehydrated`).
export function waitOf(fiber: Fiber): "fallback" | "dehydrated" | null {
  if (fiber.tag !== 13 || fiber.memoizedState == null) return null
  const { dehydrated } = fiber.memoizedState as { dehydrated?: unknown }
  return dehydrated == null ? "fallback" : "dehydrated"
}

const LAZY = Symbol.for("react.lazy")
const ELEMENT = [
  Symbol.for("react.transitional.element"),
  Symbol.for("react.element"),
]
// Fields React keeps; read defensively, any may be missing.
type Loose = Record<string, unknown>

// A Server Component's name from a Flight lazy's debug info, if any.
function serverName(lazy: Loose): string | undefined {
  const payload = (lazy._payload ?? {}) as Loose
  for (const entries of [payload._debugInfo, lazy._debugInfo])
    if (Array.isArray(entries))
      for (const entry of entries)
        if (typeof (entry as Loose)?.name === "string")
          return ((entry as Loose).name as string).slice(0, MAX_NAME)
}

// What a waiting boundary waits on, from its children: a Server Component
// still streaming (a Flight lazy, Next), the component it renders (React 19
// says nothing about which one suspended), a lazy() one loading, or a promise.
export function causeOf(boundary: Fiber): SuspenseCause {
  const children = (boundary.memoizedProps as Loose | null)?.children
  if (typeof children !== "object" || children === null)
    return { kind: "promise" }
  const child = children as Loose
  if (child.$$typeof === LAZY) {
    const name = serverName(child)
    return name ? { kind: "server", name } : { kind: "lazy" }
  }
  if (!ELEMENT.includes(child.$$typeof as symbol)) return { kind: "promise" }
  const type = child.type
  // A DOM element suspends nothing itself: something inside it did.
  if (type == null || typeof type === "string") return { kind: "promise" }
  if ((type as Loose).$$typeof === LAZY) return { kind: "lazy" }
  return { kind: "inside", name: typeName(type as never).slice(0, MAX_NAME) }
}
