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
  if (root === "props") return renderer.overrideProps?.(fiber, path, value)
  if (typeof root !== "object" || !("hook" in root)) return
  const hook = hookAt(hooks, root.hook)
  if (hook && STATE_HOOKS.has(hook.name) && hook.index !== undefined)
    renderer.overrideHookState?.(fiber, hook.index, path, value)
}
