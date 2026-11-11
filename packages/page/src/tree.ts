import type { TreeKind, TreeOp } from "@reactdx/messages"
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

type Named = { displayName?: string; name?: string }

function kindOf(fiber: Fiber): TreeKind | undefined {
  if (fiber.tag === 0) return "function"
  if (fiber.tag === 5) return "host"
}

function nameOf(fiber: Fiber): string {
  if (fiber.tag === 5) return fiber.type as string
  const type = fiber.type as Named
  return type.displayName || type.name || "Anonymous"
}

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
    ops.push({
      op: "add",
      id,
      parentId,
      rootId,
      kind: kindOf(fiber) as TreeKind,
      name: nameOf(fiber),
      key: fiber.key,
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

  return {
    full(root: FiberRoot, rootId: number): TreeOp[] {
      const host = root.current as unknown as Fiber
      const ops: TreeOp[] = []
      addChildren(host, idOf(host), 0, rootId, ops)
      return ops
    },
  }
}
