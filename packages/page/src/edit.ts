// Writes the panel's edits through React's own override functions (docs/page.md,
// Edits): React copies along the path and re-renders, so memo, effect deps and
// children see a real change.

import type { EditRoot, EditValue, ValueKey } from "@reactdx/messages"
import { hookAt, type RawHook } from "./hooks.ts"

const NUMBERS: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
  "-0": -0,
}

// The value an EditValue (checked by parseEditValue) stands for.
export function fromEditValue(value: EditValue): unknown {
  if (Array.isArray(value)) return value.map(fromEditValue)
  if (value === null || typeof value !== "object") return value
  if (value.type === "undefined") return undefined
  if (value.type === "number") return NUMBERS[value.value]
  return Object.fromEntries(
    Object.entries(value.props).map(([key, item]) => [
      key,
      fromEditValue(item),
    ]),
  )
}

// The development renderer's override functions (react-dom 18 and 19).
export type Renderer = {
  overrideProps?: (fiber: object, path: ValueKey[], value: unknown) => void
  overrideHookState?: (
    fiber: object,
    index: number,
    path: ValueKey[],
    value: unknown,
  ) => void
}

const STATE_HOOKS = new Set(["State", "Reducer"])

const isPlain = (value: unknown) =>
  Array.isArray(value) ||
  (typeof value === "object" &&
    value !== null &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)))

// Every container the path writes through, from `root`, is a plain object or
// array: React's copy would turn a Map, Set or class instance into an object.
// Read through descriptors, so no getter runs.
export function plainPath(root: unknown, path: ValueKey[]) {
  let at = root
  for (const key of path.slice(0, -1)) {
    if (!isPlain(at)) return false
    at = Object.getOwnPropertyDescriptor(at, key)?.value
  }
  return path.length === 0 || isPlain(at)
}

// A copy of `value` with `next` at `path`: each container along it copied (an
// array by slice, an object by spread), as React's overrides do.
export function copyWithSet(
  value: unknown,
  path: ValueKey[],
  next: unknown,
): unknown {
  if (path.length === 0) return next
  const [key, ...rest] = path as [ValueKey, ...ValueKey[]]
  const copy = Array.isArray(value)
    ? value.slice()
    : { ...(value as Record<string, unknown>) }
  ;(copy as Record<ValueKey, unknown>)[key] = copyWithSet(
    (value as Record<ValueKey, unknown>)[key],
    rest,
    next,
  )
  return copy
}

type ClassInstance = {
  state: unknown
  setState: (update: (previous: unknown) => unknown) => void
}

// Writes `value` at `path` under `root`. `hooks`: the fiber's hooks as last read.
// Anything it can't write (another root, a hook without state) is ignored.
export function applyEdit(
  renderer: Renderer,
  fiber: object,
  root: EditRoot,
  path: ValueKey[],
  value: unknown,
  hooks: RawHook[] = [],
) {
  if (root === "props") {
    if (plainPath((fiber as { memoizedProps: unknown }).memoizedProps, path))
      renderer.overrideProps?.(fiber, path, value)
    return
  }
  // React has no override for class state, and a render recomputes it from the
  // update queue (a mutated instance.state is reverted): an update through the
  // queue, its copy holding every key, so the merge is the copy (class
  // components are tag 1).
  if (root === "state") {
    const { tag, stateNode } = fiber as { tag: number; stateNode: unknown }
    const instance = stateNode as ClassInstance | null
    if (tag !== 1 || !instance || !plainPath(instance.state, path)) return
    instance.setState((previous) => copyWithSet(previous, path, value))
    return
  }
  if (typeof root !== "object" || !("hook" in root)) return
  const hook = hookAt(hooks, root.hook)
  if (!hook || !STATE_HOOKS.has(hook.name) || hook.index === undefined) return
  if (plainPath(hook.value, path))
    renderer.overrideHookState?.(fiber, hook.index, path, value)
}
