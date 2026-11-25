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
export function causeOf(
  boundary: Fiber,
  // React 18's record of who suspended (createSuspended), if any.
  recorded?: SuspenseCause,
): SuspenseCause {
  const children = (boundary.memoizedProps as Loose | null)?.children
  if (typeof children !== "object" || children === null)
    return { kind: "promise" }
  const child = children as Loose
  if (child.$$typeof === LAZY) {
    const name = serverName(child)
    return name ? { kind: "server", name } : { kind: "lazy" }
  }
  const element = ELEMENT.includes(child.$$typeof as symbol)
  const type = element ? child.type : undefined
  if ((type as Loose | undefined)?.$$typeof === LAZY) return { kind: "lazy" }
  if (recorded) return recorded
  const name = childName(boundary)
  return name ? { kind: "inside", name } : { kind: "promise" }
}

// The component a boundary's child element renders (not a DOM element, text,
// a list or a lazy one), by name.
export function childName(boundary: Fiber): string | undefined {
  const child = (boundary.memoizedProps as Loose | null)?.children as
    | Loose
    | null
    | undefined
  if (!child || !ELEMENT.includes(child.$$typeof as symbol)) return
  const type = child.type as Loose | string | null | undefined
  if (type == null || typeof type === "string" || type.$$typeof === LAZY) return
  return typeName(type as never).slice(0, MAX_NAME)
}

type Suspender = { name: string; wakeables: Set<unknown> }

// React 18 tells a profiler which component suspended, and on what
// (`markComponentSuspended`; React 19 dropped the hook). Kept per boundary,
// the suspender's nearest one, until its content arrives (`clear`).
export function createSuspended() {
  let records = new WeakMap<Fiber, Suspender>()
  const recordOf = (boundary: Fiber) =>
    records.get(boundary) ??
    (boundary.alternate ? records.get(boundary.alternate) : undefined)
  return {
    hooks: {
      markComponentSuspended(fiber: Fiber, wakeable: unknown) {
        let boundary = fiber.return
        while (boundary && boundary.tag !== 13) boundary = boundary.return
        if (!boundary) return
        let record = recordOf(boundary)
        if (!record) {
          const type = (fiber.type ?? fiber.elementType) as never
          record = {
            name: typeName(type).slice(0, MAX_NAME),
            wakeables: new Set(),
          }
          records.set(boundary, record)
          if (boundary.alternate) records.set(boundary.alternate, record)
        }
        record.wakeables.add(wakeable)
      },
    },
    causeFor(boundary: Fiber): SuspenseCause | undefined {
      const record = recordOf(boundary)
      if (record)
        return {
          kind: "thrown",
          name: record.name,
          count: record.wakeables.size,
        }
    },
    clear(boundary: Fiber) {
      records.delete(boundary)
      if (boundary.alternate) records.delete(boundary.alternate)
    },
    // Unwatched: what was recorded is no longer kept up to date.
    reset() {
      records = new WeakMap()
    },
  }
}
