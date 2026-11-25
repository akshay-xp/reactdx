import type {
  CountsMessage,
  RenderCount,
  TreeBatchMessage,
  TreeKind,
  TreeOp,
} from "@reactdx/messages"
import { batch, createSignal } from "solid-js"
import { nextInternal } from "./next"

export type Row = {
  id: number
  name: string
  depth: number
  kind: TreeKind
  key: string | null
  expandable: boolean
  expanded: boolean
  match: boolean
  // A component whose nearest component ancestor is a Server Component: where
  // client code starts.
  client: boolean
  // A run of same-named siblings shown as one row (its id is minus the first
  // member's): how many.
  group?: { size: number }
}

const RECENT_MS = 1000
const TICK_MS = 100
// Consecutive siblings with the same name and kind that make a group row.
const GROUP_MIN = 5

// Kinds that are components (Suspense, providers and DOM elements aren't).
const COMPONENT_KINDS = new Set<TreeKind>([
  "function",
  "class",
  "forwardRef",
  "memo",
  "lazy",
  "server",
])

type Node = {
  rootId: number
  parentId: number
  kind: TreeKind
  name: string
  key: string | null
  children: number[]
  // The nearest component kind at or above this node.
  scope: TreeKind | undefined
  client: boolean
  // One of Next's own (src/next.ts); hidden only in a root that's Next's.
  internal: boolean
}

export type TreeStore = ReturnType<typeof createTreeStore>

// The page's component tree, rebuilt from the agent's ops (docs/messages.md).
export function createTreeStore() {
  const nodes = new Map<number, Node>()
  const tops = new Map<number, number[]>()
  const collapsed = new Set<number>()
  // Members of open groups: a group is open when any of its members is here.
  const opened = new Set<number>()
  // Each group row's members, by its id, as the last rows() found them.
  const groups = new Map<number, number[]>()
  // The page's render counts by id (docs/messages.md, counts).
  const counts = new Map<number, RenderCount>()
  // Counts and recency change on every flush: rows read them through their own
  // signal, so a flush doesn't rebuild the rows.
  const [tally, setTally] = createSignal(0)
  let recent = new Set<number>()
  let fade: ReturnType<typeof setTimeout> | undefined
  const [version, setVersion] = createSignal(0)
  // Suspense waits by id (M7 #80): waiting or arrived, the ms the page sent and
  // when it came. While any waits, a clock ticks so its time counts up.
  const waits = new Map<number, { waiting: boolean; ms: number; at: number }>()
  const [clock, setClock] = createSignal(Date.now())
  let ticking: ReturnType<typeof setInterval> | undefined
  const tick = () => {
    const waiting = [...waits.values()].some((wait) => wait.waiting)
    if (waiting && !ticking)
      ticking = setInterval(() => setClock(Date.now()), TICK_MS)
    else if (!waiting && ticking) {
      clearInterval(ticking)
      ticking = undefined
    }
  }
  const [selected, select] = createSignal<number>()
  const [showHosts, showHostsSignal] = createSignal(false)
  const [showInternals, showInternalsSignal] = createSignal(false)
  // Roots holding Next's AppRouter, and each root's count of internals: a
  // Vite app's own Router or Head is never hidden.
  const nextRoots = new Set<number>()
  const internals = new Map<number, number>()
  const countInternal = (node: Node, by: number) => {
    if (node.internal)
      internals.set(node.rootId, (internals.get(node.rootId) ?? 0) + by)
  }
  const [query, querySignal] = createSignal("")
  // The row under the pointer: the page highlights it.
  const [hovered, hover] = createSignal<number>()
  const [picking, setPicking] = createSignal(false)
  // Suspense outlines drawn on the page (docs/panel.md, Toolbar).
  const [outlines, setOutlines] = createSignal(false)
  // Host (DOM element) nodes are rows only while "Show DOM elements" is on.
  const visible = (node: Node | undefined) =>
    node !== undefined &&
    (node.kind !== "host" || showHosts()) &&
    !(node.internal && nextRoots.has(node.rootId) && !showInternals())

  const siblings = (rootId: number, parentId: number) => {
    if (parentId) return nodes.get(parentId)?.children
    if (!tops.has(rootId)) tops.set(rootId, [])
    return tops.get(rootId)
  }
  const reset = () => {
    nodes.clear()
    tops.clear()
    counts.clear()
    waits.clear()
    tick()
    nextRoots.clear()
    internals.clear()
    setTally(tally() + 1)
  }
  // The nearest node at or above this one that isn't a DOM element.
  const outer = (node: Node | undefined) => {
    let at = node
    while (at?.kind === "host") at = nodes.get(at.parentId)
    return at
  }
  const forget = (id: number) => {
    const node = nodes.get(id)
    if (!node) return
    for (const child of node.children) forget(child)
    countInternal(node, -1)
    nodes.delete(id)
    waits.delete(id)
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
      const parent = nodes.get(parentId)
      const above = parent?.scope
      const component = COMPONENT_KINDS.has(kind)
      const node: Node = {
        rootId,
        parentId,
        kind,
        name,
        key,
        children: [],
        scope: component ? kind : above,
        client: component && kind !== "server" && above === "server",
        internal: nextInternal(name, kind, outer(parent)),
      }
      nodes.set(id, node)
      countInternal(node, 1)
      if (kind === "function" && name === "AppRouter") nextRoots.add(rootId)
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
    if (op.op === "suspense") {
      waits.set(op.id, {
        waiting: op.state === "waiting",
        ms: op.ms,
        at: Date.now(),
      })
      return true
    }
    if (op.op === "rename") {
      countInternal(node, -1)
      node.name = op.name
      node.internal = nextInternal(
        node.name,
        node.kind,
        outer(nodes.get(node.parentId)),
      )
      countInternal(node, 1)
    } else {
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

  // Hidden host elements: their children take their place and depth. Runs of
  // GROUP_MIN or more same-named siblings fold into a group row.
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
        client: node.client,
      })
      if (expanded) visitAll(kids, depth + 1)
    }
    const group = (members: number[], depth: number) => {
      const { name, kind } = nodes.get(members[0] as number) as Node
      const id = -(members[0] as number)
      const expanded = members.some((member) => opened.has(member))
      groups.set(id, members)
      rows.push({
        id,
        name,
        depth,
        kind,
        key: null,
        expandable: true,
        expanded,
        match: false,
        client: false,
        group: { size: members.length },
      })
      if (expanded) for (const member of members) visit(member, depth + 1)
    }
    const visitAll = (ids: number[], depth: number) => {
      for (let at = 0; at < ids.length; ) {
        const first = nodes.get(ids[at] as number) as Node
        let end = at + 1
        while (end < ids.length) {
          const next = nodes.get(ids[end] as number) as Node
          if (next.name !== first.name || next.kind !== first.kind) break
          end++
        }
        if (end - at >= GROUP_MIN) group(ids.slice(at, end), depth)
        else for (const id of ids.slice(at, end)) visit(id, depth)
        at = end
      }
    }
    visitAll(shown(tops.get(rootId) ?? []), 0)
    return rows
  }

  const toggle = (id: number) => {
    if (id < 0) {
      const members = groups.get(id) ?? [-id]
      if (members.some((member) => opened.has(member)))
        for (const member of members) opened.delete(member)
      else opened.add(-id)
    } else if (!collapsed.delete(id)) collapsed.add(id)
    setVersion(version() + 1)
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
      opened.add(id)
      for (let at = nodes.get(id)?.parentId; at; at = nodes.get(at)?.parentId) {
        collapsed.delete(at)
        opened.add(at)
      }
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
      // The row's parent in the list: a group row for its members.
      let parent: Row | undefined
      for (let i = at - 1; i >= 0 && !parent; i--)
        if ((list[i] as Row).depth < current.depth) parent = list[i]
      if (current.expandable && current.expanded) toggle(current.id)
      else if (parent) select(parent.id)
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

  // A filter change: a selection whose row went away is dropped.
  const hideSelection = () => {
    if (!visible(nodes.get(Math.abs(selected() ?? 0)))) select(undefined)
    setVersion(version() + 1)
  }

  return {
    // True when the panel must ask the page for a resync.
    apply(batch: TreeBatchMessage): boolean {
      if (batch.ops[0]?.op === "reset") stale = false
      else if (stale) return false
      else if (batch.seq !== expected) stale = true
      if (!stale) stale = !batch.ops.every(applyOp)
      tick()
      expected = batch.seq + 1
      // A group row's id is minus its first member's.
      if (!nodes.has(Math.abs(selected() ?? 0))) select(undefined)
      setVersion(version() + 1)
      return stale
    },

    rows,
    // A boundary's wait: still waiting (counting up), or how long it took.
    waitOf(id: number) {
      version()
      clock()
      const wait = waits.get(id)
      if (!wait) return
      return wait.waiting
        ? { waiting: true, ms: wait.ms + Date.now() - wait.at }
        : { waiting: false, ms: wait.ms }
    },
    receiveCounts(message: CountsMessage) {
      for (const count of message.counts) counts.set(count.id, count)
      recent = new Set(message.counts.map((count) => count.id))
      clearTimeout(fade)
      fade = setTimeout(() => {
        recent = new Set()
        setTally(tally() + 1)
      }, RECENT_MS)
      setTally(tally() + 1)
    },
    // A node's parent id (undefined at the top of a root, or unknown).
    parentOf(id: number) {
      version()
      return nodes.get(id)?.parentId || undefined
    },
    // A node's render counts (undefined: none since the watch). A group row's
    // are its members' wasted renders.
    countOf(id: number): RenderCount | undefined {
      tally()
      if (id > 0) return counts.get(id)
      const wasted = (groups.get(id) ?? []).reduce(
        (sum, member) => sum + (counts.get(member)?.wasted ?? 0),
        0,
      )
      return { id, renders: 0, wasted }
    },
    // In the newest counts (the page's last flush) for RECENT_MS; a group row
    // while any member is.
    isRecent(id: number) {
      tally()
      return id > 0
        ? recent.has(id)
        : (groups.get(id) ?? []).some((member) => recent.has(member))
    },
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
    outlines,
    setOutlines: (on: boolean) => setOutlines(on),
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
      hideSelection()
    },
    showInternals,
    setShowInternals(on: boolean) {
      showInternalsSignal(on)
      hideSelection()
    },
    // Next's own components in Next roots, hidden or shown.
    hiddenCount() {
      version()
      let count = 0
      for (const rootId of nextRoots) count += internals.get(rootId) ?? 0
      return count
    },

    clear() {
      reset()
      collapsed.clear()
      opened.clear()
      select(undefined)
      hover(undefined)
      setPicking(false)
      setVersion(version() + 1)
    },
  }
}
