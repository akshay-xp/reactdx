import type { TreeBatchMessage, TreeKind } from "@reactdx/messages"
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

  return {
    apply(batch: TreeBatchMessage) {
      for (const op of batch.ops) {
        if (op.op === "reset") reset()
        else if (op.op === "add") {
          const { id, rootId, parentId, kind, name, index } = op
          nodes.set(id, { rootId, parentId, kind, name, children: [] })
          siblings(rootId, parentId)?.splice(index, 0, id)
        } else if (op.op === "remove") {
          const node = nodes.get(op.id)
          if (!node) continue
          const list = siblings(node.rootId, node.parentId)
          list?.splice(list.indexOf(op.id), 1)
          forget(op.id)
        } else if (op.op === "reorder") {
          const list = siblings(op.rootId, op.parentId)
          list?.splice(0, list.length, ...op.children)
        } else {
          const node = nodes.get(op.id)
          if (node) node.name = op.name
        }
      }
      setVersion(version() + 1)
      return false
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
