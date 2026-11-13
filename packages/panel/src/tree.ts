import type { TreeBatchMessage, TreeKind, TreeOp } from "@reactdx/messages"
import { batch, createSignal } from "solid-js"

export type Row = {
  id: number
  name: string
  depth: number
  kind: TreeKind
  key: string | null
  expandable: boolean
  expanded: boolean
  match: boolean
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
  const [showHosts, showHostsSignal] = createSignal(false)
  const [query, querySignal] = createSignal("")
  // The row under the pointer: the page highlights it.
  const [hovered, hover] = createSignal<number>()
  const [picking, setPicking] = createSignal(false)
  // Host (DOM element) nodes are rows only while "Show DOM elements" is on.
  const visible = (node: Node | undefined) =>
    node !== undefined && (node.kind !== "host" || showHosts())

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

  // The nearest visible descendants: what a node's row shows as its children.
  const shown = (ids: number[], out: number[] = []) => {
    for (const id of ids) {
      const node = nodes.get(id)
      if (visible(node)) out.push(id)
      else if (node) shown(node.children, out)
    }
    return out
  }

  // Case-insensitive substring on the names of nodes that have rows.
  const isMatch = (node: Node | undefined) => {
    const q = query().toLowerCase()
    return (
      q !== "" &&
      node !== undefined &&
      visible(node) &&
      node.name.toLowerCase().includes(q)
    )
  }

  // Hidden host elements: their children take their place and depth.
  const rows = (rootId: number): Row[] => {
    version()
    const rows: Row[] = []
    const visit = (id: number, depth: number) => {
      const node = nodes.get(id) as Node
      const { name, kind, key, children } = node
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
        match: isMatch(node),
      })
      if (expanded) for (const kid of kids) visit(kid, depth + 1)
    }
    for (const id of shown(tops.get(rootId) ?? [])) visit(id, 0)
    return rows
  }

  const toggle = (id: number) => {
    if (!collapsed.delete(id)) collapsed.add(id)
    setVersion(version() + 1)
  }

  // The nearest visible ancestor, or undefined at the top of a root.
  const parentOf = (id: number) => {
    let parent = nodes.get(id)?.parentId
    while (parent && !visible(nodes.get(parent)))
      parent = nodes.get(parent)?.parentId
    return parent || undefined
  }

  // Every root's matches depth-first, collapsed subtrees included.
  const matches = () => {
    version()
    const out: number[] = []
    const visit = (id: number) => {
      const node = nodes.get(id)
      if (isMatch(node)) out.push(id)
      for (const child of node?.children ?? []) visit(child)
    }
    for (const ids of tops.values()) for (const id of ids) visit(id)
    return out
  }

  // Selects a node and expands its ancestors, so its row exists. One batch: the
  // selection's watchers (TreeView scrolls to the row) see the expanded rows.
  // Counts reveals, so revealing the selected node again (a second pick of it)
  // still scrolls to it: the selection itself doesn't change.
  const [reveals, setReveals] = createSignal(0)
  const reveal = (id: number) =>
    batch(() => {
      for (let at = nodes.get(id)?.parentId; at; at = nodes.get(at)?.parentId)
        collapsed.delete(at)
      select(id)
      setVersion(version() + 1)
      setReveals(reveals() + 1)
    })

  // Moves the selection within one root's rows; false for keys it doesn't handle.
  const key = (rootId: number, name: string): boolean => {
    const list = rows(rootId)
    const at = list.findIndex((row) => row.id === selected())
    const current = list[at]
    if (current && name === "ArrowLeft") {
      const parent = parentOf(current.id)
      if (current.expandable && current.expanded) toggle(current.id)
      else if (parent) select(parent)
      return true
    }
    if (current && name === "ArrowRight") {
      if (current.expandable && !current.expanded) toggle(current.id)
      else if (current.expandable) select((list[at + 1] as Row).id)
      return true
    }
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
    // A node's name, kind and key, for the inspector's header.
    info(id: number) {
      version()
      const node = nodes.get(id)
      return node && { name: node.name, kind: node.kind, key: node.key }
    },
    key,
    selected,
    reveals,
    hovered,
    picking,
    setPicking: (on: boolean) => setPicking(on),
    // The page's pick ends picking; an id the mirror has is selected and revealed.
    picked(id: number | null) {
      setPicking(false)
      if (id !== null && nodes.has(id)) reveal(id)
    },
    hover: (id: number | undefined) => hover(id),
    // Selects a node from outside the tree (the inspector's owners) and makes
    // its row visible; unknown ids do nothing.
    reveal(id: number) {
      if (nodes.has(id)) reveal(id)
    },
    select: (id: number) => select(id),

    toggle,
    query,
    matches,
    // The selection's place among the matches, from 1; 0 when it isn't one.
    position: () => matches().indexOf(selected() as number) + 1,
    // Next (1) or previous (-1) match, wrapping; from a non-match, the first or last.
    step(direction: 1 | -1) {
      const list = matches()
      if (list.length === 0) return
      const at = list.indexOf(selected() as number)
      // From a non-match (-1), +1 lands on 0; -1 must start at 0 to land on the last.
      const from = at === -1 && direction === -1 ? 0 : at
      reveal(list[(from + direction + list.length) % list.length] as number)
    },
    setQuery(value: string) {
      querySignal(value)
      const [first] = matches()
      if (first !== undefined) reveal(first)
    },
    showHosts,
    setShowHosts(on: boolean) {
      showHostsSignal(on)
      if (!visible(nodes.get(selected() as number))) select(undefined)
      setVersion(version() + 1)
    },

    clear() {
      reset()
      collapsed.clear()
      select(undefined)
      hover(undefined)
      setPicking(false)
      setVersion(version() + 1)
    },
  }
}
