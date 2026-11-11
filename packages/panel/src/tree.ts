import type { TreeBatchMessage, TreeKind, TreeOp } from "@reactdx/messages"
import { createSignal } from "solid-js"

export type Row = { id: number; name: string; depth: number }

type Node = {
  rootId: number
  parentId: number
  kind: TreeKind
  name: string
  children: number[]
}

export type TreeStore = ReturnType<typeof createTreeStore>

// The page's component tree, rebuilt from the agent's ops (docs/messages.md).
export function createTreeStore() {
  const nodes = new Map<number, Node>()
  const tops = new Map<number, number[]>()
  const [version, setVersion] = createSignal(0)

  const siblings = (rootId: number, parentId: number) => {
    if (parentId) return nodes.get(parentId)?.children
    if (!tops.has(rootId)) tops.set(rootId, [])
    return tops.get(rootId)
  }
  const reset = () => {
    nodes.clear()
    tops.clear()
  }
  const forget = (id: number) => {
    for (const child of nodes.get(id)?.children ?? []) forget(child)
    nodes.delete(id)
  }

  // Applies one op; false when it names a node the mirror doesn't have.
  const applyOp = (op: TreeOp): boolean => {
    if (op.op === "reset") {
      reset()
      return true
    }
    if (op.op === "add") {
      const { id, rootId, parentId, kind, name, index } = op
      const list = siblings(rootId, parentId)
      if (!list) return false
      nodes.set(id, { rootId, parentId, kind, name, children: [] })
      list.splice(index, 0, id)
      return true
    }
    if (op.op === "reorder") {
      const list = siblings(op.rootId, op.parentId)
      list?.splice(0, list.length, ...op.children)
      return list !== undefined
    }
    const node = nodes.get(op.id)
    if (!node) return false
    if (op.op === "rename") node.name = op.name
    else {
      const list = siblings(node.rootId, node.parentId) ?? []
      list.splice(list.indexOf(op.id), 1)
      forget(op.id)
    }
    return true
  }

  // Next seq expected; once out of step, everything waits for a reset.
  let expected = 1
  let stale = false

  return {
    // True when the panel must ask the page for a resync.
    apply(batch: TreeBatchMessage): boolean {
      if (batch.ops[0]?.op === "reset") stale = false
      else if (stale) return false
      else if (batch.seq !== expected) stale = true
      if (!stale) stale = !batch.ops.every(applyOp)
      expected = batch.seq + 1
      setVersion(version() + 1)
      return stale
    },

    // Host elements are hidden: their children take their place and depth.
    rows(rootId: number): Row[] {
      version()
      const rows: Row[] = []
      const visit = (id: number, depth: number) => {
        const node = nodes.get(id)
        if (!node) return
        const shown = node.kind !== "host"
        if (shown) rows.push({ id, name: node.name, depth })
        for (const child of node.children)
          visit(child, shown ? depth + 1 : depth)
      }
      for (const id of tops.get(rootId) ?? []) visit(id, 0)
      return rows
    },

    clear() {
      reset()
      setVersion(version() + 1)
    },
  }
}
