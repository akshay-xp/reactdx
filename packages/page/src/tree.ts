import { MAX_TREE_STRING, type TreeKind, type TreeOp } from "@reactdx/messages"
import type { FiberRoot } from "./hook.ts"

// The fields of React's Fiber that the tree reads (same in React 18 and 19).
type Fiber = {
  tag: number
  key: string | null
  type: unknown
  elementType: unknown
  child: Fiber | null
  sibling: Fiber | null
  alternate: Fiber | null
  memoizedState: unknown
}

type Named = {
  displayName?: string
  name?: string
  render?: Named
  type?: Named
  _context?: Named
}

const KINDS: Record<number, TreeKind> = {
  0: "function",
  1: "class",
  5: "host",
  9: "consumer",
  10: "provider",
  11: "forwardRef",
  12: "profiler",
  13: "suspense",
  14: "memo",
  15: "memo",
  26: "host",
  27: "host",
  31: "activity",
}

const FIXED_NAMES: Partial<Record<TreeKind, string>> = {
  profiler: "Profiler",
  suspense: "Suspense",
  activity: "Activity",
}

const LAZY = Symbol.for("react.lazy")

// Every other tag (root, text, fragment, mode, portal, offscreen...) is skipped.
function kindOf(fiber: Fiber): TreeKind | undefined {
  const kind = KINDS[fiber.tag]
  if (kind && (fiber.elementType as { $$typeof?: symbol })?.$$typeof === LAZY)
    return "lazy"
  return kind
}

// A component's own name, looking through forwardRef and memo wrappers.
const typeName = (type: Named): string =>
  type.displayName ||
  (type.render && typeName(type.render)) ||
  (type.type && typeName(type.type)) ||
  type.name ||
  "Anonymous"

function nameOf(fiber: Fiber, kind: TreeKind): string {
  const type = fiber.type as Named
  const fixed = FIXED_NAMES[kind]
  if (fixed) return fixed
  if (kind === "host") return fiber.type as string
  if (kind === "provider" || kind === "consumer")
    return (type._context ?? type).displayName || "Context"
  // A lazy fiber's elementType is the lazy wrapper; its type is what resolved.
  if (kind === "lazy") return typeName(type)
  return typeName(fiber.elementType as Named)
}

const bounded = (value: string) => value.slice(0, MAX_TREE_STRING)

// Ids are stable for a fiber's life: React swaps a fiber with its alternate on
// every update, so both carry the id.
export function createTree() {
  const ids = new WeakMap<Fiber, number>()
  let nextId = 1
  const idOf = (fiber: Fiber) => {
    const id =
      ids.get(fiber) ??
      (fiber.alternate && ids.get(fiber.alternate)) ??
      nextId++
    ids.set(fiber, id)
    if (fiber.alternate) ids.set(fiber.alternate, id)
    return id
  }

  // Emitted child ids per emitted id; a root's HostRoot is keyed by its own id.
  const children = new Map<number, number[]>()

  // Skipped fibers (fragments, text, modes...) pass their children up.
  const visible = (fiber: Fiber, out: Fiber[] = []) => {
    for (let child = fiber.child; child; child = child.sibling)
      if (kindOf(child)) out.push(child)
      else visible(child, out)
    return out
  }

  const addSubtree = (
    fiber: Fiber,
    parentId: number,
    rootId: number,
    index: number,
    ops: TreeOp[],
  ) => {
    const id = idOf(fiber)
    const kind = kindOf(fiber) as TreeKind
    ops.push({
      op: "add",
      id,
      parentId,
      rootId,
      kind,
      name: bounded(nameOf(fiber, kind)),
      key: fiber.key === null ? null : bounded(fiber.key),
      index,
    })
    addChildren(fiber, id, id, rootId, ops)
  }

  // `key` is where the children are stored; `parentId` is what the ops say (0 at a root).
  const addChildren = (
    fiber: Fiber,
    key: number,
    parentId: number,
    rootId: number,
    ops: TreeOp[],
  ) => {
    const kids = visible(fiber)
    children.set(key, kids.map(idOf))
    kids.forEach((kid, index) => {
      addSubtree(kid, parentId, rootId, index, ops)
    })
  }

  const forget = (id: number) => {
    for (const child of children.get(id) ?? []) forget(child)
    children.delete(id)
  }

  // Brings a known node's stored children in line with this commit.
  const update = (
    fiber: Fiber,
    key: number,
    parentId: number,
    rootId: number,
    ops: TreeOp[],
  ) => {
    const prev = children.get(key)
    // A bailed-out subtree keeps its child fibers, so nothing below it changed.
    if (prev && fiber.alternate && fiber.child === fiber.alternate.child) return
    const kids = visible(fiber)
    const next = kids.map(idOf)
    const kept = new Set(next)
    for (const id of prev ?? [])
      if (!kept.has(id)) {
        ops.push({ op: "remove", id })
        forget(id)
      }
    const known = new Set(prev)
    kids.forEach((kid, index) => {
      const id = next[index] as number
      if (known.has(id)) update(kid, id, id, rootId, ops)
      else addSubtree(kid, parentId, rootId, index, ops)
    })
    children.set(key, next)
  }

  return {
    // Appends rather than returns: spreading a large tree into push() overflows the stack.
    full(root: FiberRoot, rootId: number, ops: TreeOp[]) {
      const host = root.current as unknown as Fiber
      addChildren(host, idOf(host), 0, rootId, ops)
    },
    commit(root: FiberRoot, rootId: number, ops: TreeOp[]) {
      const host = root.current as unknown as Fiber
      update(host, idOf(host), 0, rootId, ops)
    },
  }
}
