// Why each component rendered, recorded per commit while the panel watches
// (docs/page.md, Render insight). Values stay as references: nothing is
// serialized until the panel shows a record.

import { MAX_TREE_STRING } from "@reactdx/messages"
import type { Fiber } from "./tree.ts"

export type RenderKind =
  | "mount"
  | "props"
  | "state"
  | "context"
  | "parent"
  | "force"

// A key whose value changed, with both values (references, not copies).
export type Change = { key: string; old: unknown; new: unknown }

export type RenderRecord = {
  seq: number
  kinds: RenderKind[]
  props?: Change[]
  // A class component's state keys.
  state?: Change[]
  // State hooks by hook list index (docs/page.md, Hooks).
  hooks?: HookChange[]
  // Contexts by read order (the Context section's).
  contexts?: ContextChange[]
}

export type ContextChange = { read: number; old: unknown; new: unknown }

export type HookChange = { index: number; old: unknown; new: unknown }

type Commit = {
  seq: number
  time: number
  rootId: number
  records: Map<number, RenderRecord>
}

// Function, class, forwardRef and memo components: the fibers that render.
const COMPONENTS = new Set([0, 1, 11, 14, 15])
// React's PerformedWork flag: the fiber rendered in this commit.
const PERFORMED_WORK = 1

type Flagged = Fiber & { flags: number }

type ContextRead = {
  context: { displayName?: unknown }
  memoizedValue: unknown
  next: ContextRead | null
}

// The contexts a fiber read in its last render, once each, in first-read order:
// useContext, use(), a class's contextType and consumers all land in this list.
export function contextsOf(fiber: Fiber) {
  const reads = new Map<unknown, unknown>()
  const dependencies = (
    fiber as unknown as {
      dependencies: { firstContext: ContextRead | null } | null
    }
  ).dependencies
  for (let at = dependencies?.firstContext ?? null; at; at = at.next)
    if (!reads.has(at.context)) reads.set(at.context, at.memoizedValue)
  return [...reads].map(([context, value]) => {
    const name = (context as { displayName?: unknown }).displayName
    return {
      name:
        typeof name === "string" && name
          ? name.slice(0, MAX_TREE_STRING)
          : "Context",
      value,
      context,
    }
  })
}

// The keys whose values differ (Object.is), over both objects' keys.
function diffKeys(prev: unknown, next: unknown): Change[] {
  const a = (prev ?? {}) as Record<string, unknown>
  const b = (next ?? {}) as Record<string, unknown>
  const changes: Change[] = []
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (!Object.is(a[key], b[key]))
      changes.push({ key, old: a[key], new: b[key] })
  return changes
}

type HookState = {
  memoizedState: unknown
  queue: unknown
  next: HookState | null
}

// Hooks with an update queue (state, reducer, transition, external store...)
// whose value changed, walking both renders' hook lists side by side.
function diffHooks(prev: unknown, next: unknown): HookChange[] {
  const changes: HookChange[] = []
  let a = prev as HookState | null
  let b = next as HookState | null
  for (let index = 0; a && b; index++, a = a.next, b = b.next)
    if (b.queue && !Object.is(a.memoizedState, b.memoizedState))
      changes.push({ index, old: a.memoizedState, new: b.memoizedState })
  return changes
}

// Contexts read in both renders whose value changed, by this render's read order.
function diffContexts(prev: Fiber, next: Fiber): ContextChange[] {
  const before = new Map(
    contextsOf(prev).map(({ context, value }) => [context, value]),
  )
  const changes: ContextChange[] = []
  contextsOf(next).forEach(({ context, value }, read) => {
    if (before.has(context) && !Object.is(before.get(context), value))
      changes.push({ read, old: before.get(context), new: value })
  })
  return changes
}

export function createRecorder() {
  let seq = 1
  const commits: Commit[] = []

  const reasons = (at: number, fiber: Fiber): RenderRecord => {
    const prev = fiber.alternate
    if (!prev) return { seq: at, kinds: ["mount"] }
    const record: RenderRecord = { seq: at, kinds: [] }
    const note = <F extends "props" | "state" | "hooks" | "contexts">(
      kind: RenderKind,
      field: F,
      changes: NonNullable<RenderRecord[F]>,
    ) => {
      if (!changes.length) return
      if (!record.kinds.includes(kind)) record.kinds.push(kind)
      record[field] = changes
    }
    note("props", "props", diffKeys(prev.memoizedProps, fiber.memoizedProps))
    if (fiber.tag === 1)
      note("state", "state", diffKeys(prev.memoizedState, fiber.memoizedState))
    else
      note("state", "hooks", diffHooks(prev.memoizedState, fiber.memoizedState))
    note("context", "contexts", diffContexts(prev, fiber))
    if (!record.kinds.length) record.kinds.push("parent")
    return record
  }

  return {
    // `walk` visits the commit's fibers (the tree's commit walk).
    commit(
      rootId: number,
      _updaters: Set<unknown>,
      walk: (visit: (fiber: Fiber, id: number) => void) => void,
    ) {
      const records = new Map<number, RenderRecord>()
      const at = seq++
      walk((fiber, id) => {
        if (
          COMPONENTS.has(fiber.tag) &&
          (fiber as Flagged).flags & PERFORMED_WORK
        )
          records.set(id, reasons(at, fiber))
      })
      commits.push({ seq: at, time: performance.now(), rootId, records })
    },
    latest(id: number) {
      for (let i = commits.length - 1; i >= 0; i--) {
        const found = commits[i]?.records.get(id)
        if (found) return found
      }
    },
  }
}
