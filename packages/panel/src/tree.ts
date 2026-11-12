import type { TreeBatchMessage, TreeKind, TreeOp } from "@reactdx/messages"
import { createSignal } from "solid-js"

export type Row = {
  id: number
  name: string
  depth: number
  kind: TreeKind
  key: string | null
  expandable: boolean
  expanded: boolean
}

type Node = {
  rootId: number
  parentId: number
  kind: TreeKind
  name: string
  key: string | null
  children: number[]
}

export type TreeStore = ReturnType<typeof createTreeStore>

// The page's component tree, rebuilt from the agent's ops (docs/messages.md).
export function createTreeStore() {
  const nodes = new Map<number, Node>()
  const tops = new Map<number, number[]>()
  const collapsed = new Set<number>()
  const [version, setVersion] = createSignal(0)
  const [selected, select] = createSignal<number>()

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
      const { id, rootId, parentId, kind, name, key, index } = op
      const list = siblings(rootId, parentId)
      if (!list) return false
      nodes.set(id, { rootId, parentId, kind, name, key, children: [] })
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

  // The nearest non-host descendants: what a node's row shows as its children.
  const shown = (ids: number[], out: number[] = []) => {
    for (const id of ids) {
      const node = nodes.get(id)
      if (!node) continue
      if (node.kind === "host") shown(node.children, out)
      else out.push(id)
    }
    return out
  }

  // Host elements are hidden: their children take their place and depth.
  const rows = (rootId: number): Row[] => {
    version()
    const rows: Row[] = []
    const visit = (id: number, depth: number) => {
      const { name, kind, key, children } = nodes.get(id) as Node
      const kids = shown(children)
      const expanded = !collapsed.has(id)
      rows.push({
        id,
        name,
        depth,
        kind,
        key,
        expandable: kids.length > 0,
        expanded,
      })
      if (expanded) for (const kid of kids) visit(kid, depth + 1)
    }
    for (const id of shown(tops.get(rootId) ?? [])) visit(id, 0)
    return rows
  }

  // Moves the selection within one root's rows; false for keys it doesn't handle.
  const key = (rootId: number, name: string): boolean => {
    const list = rows(rootId)
    const at = list.findIndex((row) => row.id === selected())
    const last = list.length - 1
    const to = {
      ArrowUp: Math.max(at - 1, 0),
      ArrowDown: Math.min(at + 1, last),
      Home: 0,
      End: last,
    }[name]
    if (to === undefined) return false
    const row = list[to]
    if (row) select(row.id)
    return true
  }

  return {
    // True when the panel must ask the page for a resync.
    apply(batch: TreeBatchMessage): boolean {
      if (batch.ops[0]?.op === "reset") stale = false
      else if (stale) return false
      else if (batch.seq !== expected) stale = true
      if (!stale) stale = !batch.ops.every(applyOp)
      expected = batch.seq + 1
      if (!nodes.has(selected() as number)) select(undefined)
      setVersion(version() + 1)
      return stale
    },

    rows,
    key,
    selected,
    select: (id: number) => select(id),

    toggle(id: number) {
      if (!collapsed.delete(id)) collapsed.add(id)
      setVersion(version() + 1)
    },

    clear() {
      reset()
      collapsed.clear()
      select(undefined)
      setVersion(version() + 1)
    },
  }
}
