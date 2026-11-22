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
  // Renders the fiber again, its props and state unchanged.
  scheduleUpdate?: (fiber: object) => void
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

type Box = Record<ValueKey, unknown>

// `value` with each container along `path` copied (an array by slice, an object
// by spread), as React's overrides do, and `change` done to the last one at
// the path's last key.
function copyAlong(
  value: unknown,
  path: Path,
  change: (container: Box, key: ValueKey) => void,
): unknown {
  const [key, ...rest] = path as [ValueKey, ...ValueKey[]]
  const copy = (
    Array.isArray(value) ? value.slice() : { ...(value as Box) }
  ) as Box
  if (rest.length) copy[key] = copyAlong((value as Box)[key], rest, change)
  else change(copy, key)
  return copy
}

export const copyWithSet = (value: unknown, path: Path, next: unknown) =>
  path.length === 0
    ? next
    : copyAlong(value, path, (container, key) => {
        container[key] = next
      })

// An array item is spliced out (the items after it move up); a key deleted.
export const copyWithDelete = (value: unknown, path: Path) =>
  copyAlong(value, path, (container, key) => {
    if (Array.isArray(container)) container.splice(key as number, 1)
    else delete container[key]
  })

export const copyWithRename = (value: unknown, path: Path, to: string) =>
  copyAlong(value, path, (container, key) => {
    container[to] = container[key]
    delete container[key]
  })

// A class instance and its updater, which `replaceState` (createReactClass)
// also uses: it replaces the state whole through the update queue.
type ClassInstance = {
  state: unknown
  updater: {
    enqueueReplaceState: (instance: ClassInstance, state: unknown) => void
  }
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
  // update queue (a mutated instance.state is reverted; setState merges, so it
  // can't delete): the copy replaces it through the queue (class components
  // are tag 1).
  if (root === "state") {
    const { tag, stateNode } = fiber as { tag: number; stateNode: unknown }
    const instance = stateNode as ClassInstance | null
    if (tag !== 1 || !instance || !allowed(instance.state, path, op)) return
    const { state } = instance
    instance.updater.enqueueReplaceState(
      instance,
      op.op === "set"
        ? copyWithSet(state, path, op.value)
        : op.op === "delete"
          ? copyWithDelete(state, path)
          : copyWithRename(state, path, op.to),
    )
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
