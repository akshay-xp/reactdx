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
type Path = ValueKey[]
export type Renderer = {
  overrideProps?: (fiber: object, path: Path, value: unknown) => void
  overridePropsDeletePath?: (fiber: object, path: Path) => void
  overridePropsRenamePath?: (fiber: object, from: Path, to: Path) => void
  overrideHookState?: (
    fiber: object,
    index: number,
    path: Path,
    value: unknown,
  ) => void
  overrideHookStateDeletePath?: (
    fiber: object,
    index: number,
    path: Path,
  ) => void
  overrideHookStateRenamePath?: (
    fiber: object,
    index: number,
    from: Path,
    to: Path,
  ) => void
}

// What an edit does at its path: write a value, delete the key or item, or
// rename the key (the last in the path) to `to`.
export type EditOp =
  | { op: "set"; value: unknown }
  | { op: "delete" }
  | { op: "rename"; to: string }

const STATE_HOOKS = new Set(["State", "Reducer"])

const isPlain = (value: unknown) =>
  Array.isArray(value) ||
  (typeof value === "object" &&
    value !== null &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)))

// The container the path's last key is in, when every container from `root`
// down to it is a plain object or array (React's copy would turn a Map, Set or
// class instance into an object). Read through descriptors: no getter runs.
function parentOf(root: unknown, path: Path) {
  let at = root
  for (const key of path.slice(0, -1)) {
    if (!isPlain(at)) return
    at = Object.getOwnPropertyDescriptor(at, key)?.value
  }
  return isPlain(at) ? (at as object) : undefined
}

export const plainPath = (root: unknown, path: Path) =>
  path.length === 0 || parentOf(root, path) !== undefined

// Whether `op` can be done at `path` under `root`: through plain containers
// only; a delete or rename names a key; a rename is of an object's key, to a
// name it doesn't have.
function allowed(root: unknown, path: Path, op: EditOp) {
  if (op.op === "set") return plainPath(root, path)
  const parent = parentOf(root, path)
  if (!parent || path.length === 0) return false
  return (
    op.op === "delete" ||
    (!Array.isArray(parent) && !Object.hasOwn(parent, op.to))
  )
}

const renamed = (path: Path, to: string) => [...path.slice(0, -1), to]

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

// Does `op` at `path` under `root`. `hooks`: the fiber's hooks as last read.
// Anything it can't do (another root, a hook without state, a path through a
// Map) is ignored.
export function applyEdit(
  renderer: Renderer,
  fiber: object,
  root: EditRoot,
  path: Path,
  op: EditOp,
  hooks: RawHook[] = [],
) {
  if (root === "props") {
    const props = (fiber as { memoizedProps: unknown }).memoizedProps
    if (!allowed(props, path, op)) return
    if (op.op === "set") renderer.overrideProps?.(fiber, path, op.value)
    else if (op.op === "delete") renderer.overridePropsDeletePath?.(fiber, path)
    else renderer.overridePropsRenamePath?.(fiber, path, renamed(path, op.to))
    return
  }
  // React has no override for class state, and a render recomputes it from the
  // update queue (a mutated instance.state is reverted): an update through the
  // queue, its copy holding every key, so the merge is the copy (class
  // components are tag 1).
  if (root === "state") {
    const { tag, stateNode } = fiber as { tag: number; stateNode: unknown }
    const instance = stateNode as ClassInstance | null
    if (tag !== 1 || !instance || op.op !== "set") return
    if (!allowed(instance.state, path, op)) return
    instance.setState((previous) => copyWithSet(previous, path, op.value))
    return
  }
  if (typeof root !== "object" || !("hook" in root)) return
  const hook = hookAt(hooks, root.hook)
  if (!hook || !STATE_HOOKS.has(hook.name) || hook.index === undefined) return
  if (!allowed(hook.value, path, op)) return
  const { index } = hook
  if (op.op === "set")
    renderer.overrideHookState?.(fiber, index, path, op.value)
  else if (op.op === "delete")
    renderer.overrideHookStateDeletePath?.(fiber, index, path)
  else
    renderer.overrideHookStateRenamePath?.(
      fiber,
      index,
      path,
      renamed(path, op.to),
    )
}
