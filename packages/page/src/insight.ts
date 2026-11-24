// Why each component rendered, recorded per commit while the panel watches
// (docs/page.md, Render insight). Values stay as references: nothing is
// serialized until the panel shows a record.

import { MAX_HISTORY, MAX_TREE_STRING } from "@reactdx/messages"
import type { Fiber } from "./tree.ts"

export type RenderKind =
  | "mount"
  | "props"
  | "state"
  | "context"
  | "parent"
  | "force"

// A key whose value changed, with both values (references, not copies).
// `reference`: a prop that's only a new reference: an equal object or array,
// or a different function (functions can't be compared).
export type Change = {
  key: string
  old: unknown
  new: unknown
  reference?: "same-value" | "new-function"
}

export type RenderRecord = {
  seq: number
  // Its commit's Date.now(): kept past the commit's drop.
  time: number
  kinds: RenderKind[]
  props?: Change[]
  // A class component's state keys.
  state?: Change[]
  // State hooks by hook list index (docs/page.md, Hooks).
  hooks?: HookChange[]
  // Contexts by read order (the Context section's).
  contexts?: ContextChange[]
  // Effects this render ran, by hook list index (re-renders only).
  effects?: EffectRun[]
  // A mount in place of a deleted fiber of the same type, in the same commit.
  remount?: Remount
}

export type Remount =
  | { cause: "key"; from: string | null; to: string | null }
  | { cause: "ancestor"; ancestor: number }

// `changed`: the deps that differ from the last render's.
export type EffectRun = {
  index: number
  changed?: { dep: number; old: unknown; new: unknown }[]
}

export type ContextChange = { read: number; old: unknown; new: unknown }

export type HookChange = { index: number; old: unknown; new: unknown }

// A commit as the timeline lists it: `renders` counts the components that
// rendered, `updaters` their ids that scheduled it.
export type CommitSummary = {
  seq: number
  time: number
  rootId: number
  updaters: number[]
  renders: number
  // Renders only because the parent rendered.
  wasted: number
}

// A component whose update scheduled a commit, with the state it changed.
export type Updater = { id: number; hooks: HookChange[] }

type Commit = {
  seq: number
  time: number
  rootId: number
  records: Map<number, RenderRecord>
  // Ids of the components among root.memoizedUpdaters (a root render lists
  // the root itself, which isn't one).
  updaters: number[]
}

// The buffer's bounds: past either, whole commits drop oldest first with the
// values they hold. Records bound memory (a commit of 10,000 cells is 10,000);
// commits bound the panel's list when each renders little.
const MAX_RECORDS = 20_000
const MAX_COMMITS = 1_000

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

// Values sameValue reads before it calls two different references changed.
const MAX_COMPARED = 1000

const isPlain = (value: unknown): value is object => {
  if (value === null || typeof value !== "object") return false
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Equal plain objects and arrays, key by key through descriptors (no getter
// runs; an accessor counts as different), within `budget` values: past it,
// not the same. Anything else is the same only if it's the same reference.
function sameValue(
  a: unknown,
  b: unknown,
  budget = { left: MAX_COMPARED },
): boolean {
  if (--budget.left < 0) return false
  if (Object.is(a, b)) return true
  if (!isPlain(a) || !isPlain(b) || Array.isArray(a) !== Array.isArray(b))
    return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => {
    const x = Object.getOwnPropertyDescriptor(a, key)
    const y = Object.getOwnPropertyDescriptor(b, key)
    return (
      x !== undefined &&
      y !== undefined &&
      "value" in x &&
      "value" in y &&
      sameValue(x.value, y.value, budget)
    )
  })
}

// Two different values that are only a new reference, if they are.
function referenceOf(old: unknown, next: unknown) {
  if (typeof old === "function" && typeof next === "function")
    return { reference: "new-function" as const }
  if (sameValue(old, next)) return { reference: "same-value" as const }
}

// The keys whose values differ (Object.is), over both objects' keys; with
// `mark`, a new reference to an equal value says so.
function diffKeys(prev: unknown, next: unknown, mark = false): Change[] {
  const a = (prev ?? {}) as Record<string, unknown>
  const b = (next ?? {}) as Record<string, unknown>
  const changes: Change[] = []
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (!Object.is(a[key], b[key]))
      changes.push({
        key,
        old: a[key],
        new: b[key],
        ...(mark && referenceOf(a[key], b[key])),
      })
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

type Effect = { tag: number; deps: unknown[] | null; next: Effect }
// React's HasEffect tag bit: the effect runs after this commit.
const HAS_EFFECT = 1

// Effects that will run: the hook list entries holding an effect of the
// fiber's effect ring with HasEffect, and which of their deps changed.
function diffEffects(prev: Fiber, next: Fiber): EffectRun[] {
  const ring = new Set<unknown>()
  const last = (next as { updateQueue?: { lastEffect?: Effect | null } | null })
    .updateQueue?.lastEffect
  for (let at = last?.next; at; at = at === last ? undefined : at.next)
    ring.add(at)
  const runs: EffectRun[] = []
  let a = prev.memoizedState as HookState | null
  let b = next.memoizedState as HookState | null
  for (let index = 0; a && b; index++, a = a.next, b = b.next) {
    if (!ring.has(b.memoizedState)) continue
    const effect = b.memoizedState as Effect
    if (!(effect.tag & HAS_EFFECT)) continue
    // No deps array: it runs every render, nothing to blame.
    if (effect.deps === null) {
      runs.push({ index })
      continue
    }
    const before = (a.memoizedState as Effect).deps ?? []
    const changed = effect.deps.flatMap((value, dep) =>
      Object.is(before[dep], value)
        ? []
        : [{ dep, old: before[dep], new: value }],
    )
    runs.push({ index, changed })
  }
  return runs
}

type Placed = Fiber & { index: number; deletions: Fiber[] | null }

// A mount in the place of a same-type fiber this commit deleted: React lists
// a parent's deleted children in its `deletions` until it's reused, their
// subtrees still linked. Below the highest new fiber, the old one is found by
// the same child indexes; then the nearest emitted new ancestor (`ids`, this
// commit's visits) is the cause.
function remountOf(fiber: Fiber, ids: Map<Fiber, number>): Remount | undefined {
  const chain = [fiber]
  let top = fiber
  while (top.return && top.return.alternate === null) {
    top = top.return
    chain.unshift(top)
  }
  const parent = top.return as Placed | null
  const replaced = parent?.deletions?.find(
    (deleted) => (deleted as Placed).index === (top as Placed).index,
  )
  let old = replaced
  for (const next of chain.slice(1)) {
    let child = old?.child ?? null
    while (child && (child as Placed).index !== (next as Placed).index)
      child = child.sibling
    old = child ?? undefined
  }
  if (!replaced || !old || old.elementType !== fiber.elementType) return
  const ancestor = chain
    .slice(0, -1)
    .reverse()
    .map((at) => ids.get(at))
    .find((id) => id !== undefined)
  return ancestor === undefined
    ? { cause: "key", from: replaced.key, to: top.key }
    : { cause: "ancestor", ancestor }
}

// Rendered only because the parent did: nothing of its own changed.
const isWasted = (record: RenderRecord) =>
  record.kinds.length === 1 && record.kinds[0] === "parent"

export function createRecorder({
  maxRecords = MAX_RECORDS,
  maxCommits = MAX_COMMITS,
} = {}) {
  let seq = 1
  const commits: Commit[] = []
  let held = 0
  let dropped = false
  // Each component's newest record, kept past its commit's drop: the
  // Inspector's answer for a component that hasn't rendered in a while.
  const latest = new Map<number, RenderRecord>()
  // Renders per component since the watch (not bounded by the buffer), and
  // the ids changed since the last takeCounts.
  const counts = new Map<number, { renders: number; wasted: number }>()
  const changed = new Set<number>()
  // Empties the buffered commits; each component's latest record and its
  // counts stay (the Updates list's Clear).
  const clearCommits = () => {
    commits.length = 0
    held = 0
    dropped = false
  }
  const commitAt = (seq: number) => commits.find((commit) => commit.seq === seq)

  const reasons = (
    at: number,
    time: number,
    fiber: Fiber,
    updated: boolean,
    ids: Map<Fiber, number>,
  ): RenderRecord => {
    const prev = fiber.alternate
    if (!prev) {
      const remount = remountOf(fiber, ids)
      return { seq: at, time, kinds: ["mount"], ...(remount && { remount }) }
    }
    const record: RenderRecord = { seq: at, time, kinds: [] }
    const note = <F extends "props" | "state" | "hooks" | "contexts">(
      kind: RenderKind,
      field: F,
      changes: NonNullable<RenderRecord[F]>,
    ) => {
      if (!changes.length) return
      if (!record.kinds.includes(kind)) record.kinds.push(kind)
      record[field] = changes
    }
    note(
      "props",
      "props",
      diffKeys(prev.memoizedProps, fiber.memoizedProps, true),
    )
    if (fiber.tag === 1)
      note("state", "state", diffKeys(prev.memoizedState, fiber.memoizedState))
    else
      note("state", "hooks", diffHooks(prev.memoizedState, fiber.memoizedState))
    note("context", "contexts", diffContexts(prev, fiber))
    if (fiber.tag !== 1) {
      const effects = diffEffects(prev, fiber)
      if (effects.length) record.effects = effects
    }
    if (!record.kinds.length) record.kinds.push(updated ? "force" : "parent")
    return record
  }

  return {
    // `walk` visits the commit's fibers (the tree's commit walk).
    commit(
      rootId: number,
      // The fibers whose updates this commit rendered (root.memoizedUpdaters).
      updaters: Set<unknown>,
      walk: (visit: (fiber: Fiber, id: number) => void) => void,
    ) {
      const records = new Map<number, RenderRecord>()
      const updaterIds: number[] = []
      // The walk visits parents before children: a remount's new ancestors
      // are known by the time it is.
      const ids = new Map<Fiber, number>()
      const at = seq++
      const time = Date.now()
      walk((fiber, id) => {
        // remountOf looks up only new fibers: a commit touching one of 10,000
        // cells visits them all, and storing each cost more than the rest.
        if (fiber.alternate === null) ids.set(fiber, id)
        if (!COMPONENTS.has(fiber.tag)) return
        // A function component re-run by its own update with nothing changed
        // bails out before React flags the work: still a render.
        const updated =
          updaters.has(fiber) ||
          (fiber.alternate !== null && updaters.has(fiber.alternate))
        if (updated) updaterIds.push(id)
        if (updated || (fiber as Flagged).flags & PERFORMED_WORK) {
          const record = reasons(at, time, fiber, updated, ids)
          records.set(id, record)
          latest.set(id, record)
          const count = counts.get(id) ?? { renders: 0, wasted: 0 }
          count.renders++
          if (isWasted(record)) count.wasted++
          counts.set(id, count)
          changed.add(id)
        }
      })
      commits.push({
        seq: at,
        time,
        rootId,
        records,
        updaters: updaterIds,
      })
      held += records.size
      // The newest commit stays whole, however many it rendered.
      while (
        commits.length > 1 &&
        (held > maxRecords || commits.length > maxCommits)
      ) {
        held -= commits.shift()?.records.size ?? 0
        dropped = true
      }
    },
    clearCommits,
    clear() {
      clearCommits()
      latest.clear()
      counts.clear()
      changed.clear()
    },
    // The counts changed since the last call (`all`: every one).
    takeCounts(all = false) {
      const ids = all ? [...counts.keys()] : [...changed]
      changed.clear()
      return ids.flatMap((id) => {
        const count = counts.get(id)
        return count ? [{ id, ...count }] : []
      })
    },
    // Whether a commit has dropped since the last clear.
    dropped: () => dropped,
    // The seq of the oldest buffered commit (the next one's when empty).
    oldest: () => commits[0]?.seq ?? seq,
    updatersOf(seq: number): Updater[] {
      const found = commitAt(seq)
      return (found?.updaters ?? []).map((id) => ({
        id,
        hooks: found?.records.get(id)?.hooks ?? [],
      }))
    },
    summaries(after: number): CommitSummary[] {
      return commits
        .filter((commit) => commit.seq > after)
        .map(({ seq, time, rootId, updaters, records }) => ({
          seq,
          time,
          rootId,
          updaters,
          renders: records.size,
          wasted: [...records.values()].filter(isWasted).length,
        }))
    },
    rendered(seq: number) {
      const found = commitAt(seq)
      return (
        found &&
        [...found.records].map(([id, record]) => ({ id, kinds: record.kinds }))
      )
    },
    // The seqs of an id's records, oldest first: those in the buffer, after
    // its latest if that one's commit dropped; the last MAX_HISTORY.
    history(id: number) {
      const seqs = commits.flatMap((commit) =>
        commit.records.has(id) ? [commit.seq] : [],
      )
      const newest = latest.get(id)?.seq
      if (newest !== undefined && !seqs.includes(newest)) seqs.unshift(newest)
      return seqs.slice(-MAX_HISTORY)
    },
    record(id: number, seq: number) {
      const found = latest.get(id)
      return found?.seq === seq ? found : commitAt(seq)?.records.get(id)
    },
    latest: (id: number) => latest.get(id),
    // An unmounted component's kept record and counts go (its buffered ones drop with
    // their commits).
    forget: (id: number) => {
      latest.delete(id)
      counts.delete(id)
      changed.delete(id)
    },
  }
}
