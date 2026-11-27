import { MAX_TREE_STRING, type TreeKind, type TreeOp } from "@reactdx/messages"
import type { FiberRoot } from "./hook.ts"
import { waitOf } from "./suspense.ts"

// The fields of React's Fiber that the tree reads (same in React 18 and 19).
export type Fiber = {
  tag: number
  key: string | null
  type: unknown
  elementType: unknown
  child: Fiber | null
  sibling: Fiber | null
  alternate: Fiber | null
  return: Fiber | null
  memoizedProps: unknown
  memoizedState: unknown
  flags: number
  // Development builds: who rendered it (a Fiber, or React 19 server component info).
  _debugOwner?: unknown
  stateNode: unknown
  // React 19 development builds: the Server Components (and awaits) around it.
  _debugInfo?: unknown
}

// A Server Component's ReactComponentInfo, from a fiber's _debugInfo.
type ServerInfo = { name: string; key?: unknown }
// A Server Component has no fiber: it holds the kids it rendered.
type Server = { info: ServerInfo; id: number; kids: Child[] }
type Child = Fiber | Server

const isServer = (child: Child): child is Server => "info" in child

const PERFORMED_WORK = 1

const NONE: ServerInfo[] = []
// Await and time entries share the array; only component infos have a name.
function serverInfos(fiber: Fiber): ServerInfo[] {
  const debug = fiber._debugInfo
  if (!Array.isArray(debug)) return NONE
  const infos = debug.filter(
    (entry): entry is ServerInfo => typeof entry?.name === "string",
  )
  return infos.length ? infos : NONE
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

// Kinds that are components (Suspense, providers and DOM elements aren't).
const COMPONENT_KINDS = new Set<TreeKind>([
  "function",
  "class",
  "forwardRef",
  "memo",
  "lazy",
])

// Offscreen (tag 22) keeps suspended or hidden content mounted but off screen.
const isHidden = (fiber: Fiber) =>
  fiber.tag === 22 && fiber.memoizedState !== null

// A dehydrated boundary's elements: the server HTML between its <!--$?-->
// (or $, $!) marker and the matching <!--/$-->.
function serverHtml(start: Node, out: Element[]) {
  let depth = 1
  for (let at = start.nextSibling; at; at = at.nextSibling) {
    if (at.nodeType === 1) out.push(at as Element)
    else if (at.nodeType === 8) {
      const data = (at as Comment).data
      if (data === "/$" && --depth === 0) return
      if (data.startsWith("$")) depth++
    }
  }
}

// Every other tag (root, text, fragment, mode, portal, offscreen...) is skipped.
function kindOf(fiber: Fiber): TreeKind | undefined {
  const kind = KINDS[fiber.tag]
  if (kind && (fiber.elementType as { $$typeof?: symbol })?.$$typeof === LAZY)
    return "lazy"
  return kind
}

// A component's own name, looking through forwardRef and memo wrappers.
export const typeName = (type: Named): string =>
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
// every update, so both carry the id. `onForget` hears each id an unmount drops.
export function createTree({
  onForget,
  onArrive,
  now = () => performance.now(),
}: {
  onForget?: (id: number) => void
  // A waiting Suspense boundary whose content arrived.
  // with how long it waited (ms).
  onArrive?: (boundary: Fiber, id: number, ms: number) => void
  // The page's clock, for Suspense waits.
  now?: () => number
} = {}) {
  const ids = new WeakMap<Fiber, number>()
  let nextId = 1
  const idOf = (fiber: Fiber) => {
    const known = ids.get(fiber)
    // Both fibers of a pair are set together: a hit needs no writes (a parent
    // of 10,000 cells looks each up on every commit).
    if (known !== undefined) return known
    const id = (fiber.alternate && ids.get(fiber.alternate)) ?? nextId++
    ids.set(fiber, id)
    if (fiber.alternate) ids.set(fiber.alternate, id)
    return id
  }

  // Emitted child ids per emitted id; a root's HostRoot is keyed by its own id.
  const children = new Map<number, number[]>()
  // Last name sent per id: Fast Refresh or a late displayName renames a mounted fiber.
  const names = new Map<number, string>()
  // The latest fiber per emitted id, for find().
  const fibers = new Map<number, Fiber>()
  const label = (fiber: Fiber) =>
    bounded(nameOf(fiber, kindOf(fiber) as TreeKind))
  const serverIds = new WeakMap<object, number>()
  // Each mounted server node's latest info and the key it's stored under.
  const servers = new Map<number, { info: ServerInfo; parent: number }>()
  const place = (kid: Child, key: number) => {
    if (isServer(kid)) servers.set(kid.id, { info: kid.info, parent: key })
  }
  // A new payload (router.refresh, a navigation) brings new info objects: one
  // named and keyed like a server node already under `key` takes its id.
  const serverId = (info: ServerInfo, key: number, used: Set<number>) => {
    const known = serverIds.get(info)
    if (known !== undefined) return known
    const id =
      children.get(key)?.find((id) => {
        const was = servers.get(id)?.info
        return was?.name === info.name && was.key === info.key && !used.has(id)
      }) ?? nextId++
    serverIds.set(info, id)
    return id
  }
  // Waiting boundaries by id, since when (performance time; a dehydrated one has
  // waited since navigation start, 0).
  const waits = new Map<number, { since: number }>()
  // `added`: the node was just added, here or by a resync, which has to hear
  // a wait it already knew of.
  const track = (fiber: Fiber, id: number, ops: TreeOp[], added = false) => {
    const wait = waitOf(fiber)
    const was = waits.get(id)
    if (added && wait && was) {
      ops.push({ op: "suspense", id, state: "waiting", ms: now() - was.since })
      return
    }
    if (!wait === !was) return
    const at = now()
    if (was) {
      waits.delete(id)
      onArrive?.(fiber, id, at - was.since)
      ops.push({ op: "suspense", id, state: "arrived", ms: at - was.since })
      return
    }
    const since = wait === "dehydrated" ? 0 : at
    waits.set(id, { since })
    ops.push({ op: "suspense", id, state: "waiting", ms: at - since })
  }
  const childId = (child: Child) => (isServer(child) ? child.id : idOf(child))

  // A bailed-out fiber keeps its child fibers: nothing below it changed. Not
  // when both are null: React clears the alternate's child once the last
  // child unmounts.
  const bailedOut = (fiber: Fiber) =>
    fiber.child !== null &&
    fiber.alternate !== null &&
    fiber.child === fiber.alternate.child

  // Each kid's Server Component chain, outermost first; set only once one has
  // any. A skipped fiber's infos (a keyed Fragment's) prefix its kids' chains:
  // React puts them on the Fragment alone.
  let chains: ServerInfo[][] | undefined
  // Skipped fibers (fragments, text, modes...) pass their children up. Kids
  // under a skipped fiber that bailed out go in `stale` too: React didn't
  // clone them, so they're last commit's fibers (no alternate, old flags).
  const visible = (
    fiber: Fiber,
    out: Fiber[] = [],
    stale?: Set<Fiber>,
    under = false,
    prefix = NONE,
  ) => {
    for (let child = fiber.child; child; child = child.sibling)
      if (kindOf(child)) {
        out.push(child)
        if (under) stale?.add(child)
        const own = serverInfos(child)
        const chain = prefix.length ? prefix.concat(own) : own
        if (chain.length && !chains)
          chains = Array<ServerInfo[]>(out.length - 1).fill(NONE)
        chains?.push(chain)
      } else if (!isHidden(child)) {
        const own = serverInfos(child)
        visible(
          child,
          out,
          stale,
          under || bailedOut(child),
          own.length ? prefix.concat(own) : prefix,
        )
      }
    return out
  }

  // Consecutive kids rendered by the same Server Component go under its node;
  // the chain's next info nests inside it.
  const group = (
    kids: Fiber[],
    of: ServerInfo[][],
    key: number,
    depth = 0,
  ): Child[] => {
    const out: Child[] = []
    const used = new Set<number>()
    let open: { server: Server; kids: Fiber[]; of: ServerInfo[][] } | undefined
    const close = () => {
      if (open)
        open.server.kids = group(open.kids, open.of, open.server.id, depth + 1)
      open = undefined
    }
    kids.forEach((kid, i) => {
      const chain = of[i] ?? NONE
      const info = chain[depth]
      if (!info) {
        close()
        out.push(kid)
        return
      }
      if (open?.server.info !== info) {
        close()
        const id = serverId(info, key, used)
        // One node per info: a second run of it, here or under another
        // parent, would post a duplicate id. Its kids stay where they are.
        const at = servers.get(id)?.parent
        if (used.has(id) || (at !== undefined && at !== key)) {
          out.push(kid)
          return
        }
        used.add(id)
        open = { server: { info, id, kids: [] }, kids: [], of: [] }
        out.push(open.server)
      }
      open.kids.push(kid)
      open.of.push(chain)
    })
    close()
    return out
  }

  // `key` is where the fiber's children are stored.
  const kidsOf = (fiber: Fiber, key: number, stale?: Set<Fiber>): Child[] => {
    chains = undefined
    const kids = visible(fiber, [], stale)
    const of = chains
    chains = undefined
    return of ? group(kids, of, key) : kids
  }

  const noop = () => {}
  // Set only while commit runs, so full() visits nothing.
  let visit: (fiber: Fiber, id: number) => void = noop

  const addSubtree = (
    child: Child,
    parentId: number,
    rootId: number,
    index: number,
    ops: TreeOp[],
  ) => {
    if (isServer(child)) {
      const { id, info, kids } = child
      const name = bounded(info.name)
      names.set(id, name)
      ops.push({
        op: "add",
        id,
        parentId,
        rootId,
        kind: "server",
        name,
        key: typeof info.key === "string" ? bounded(info.key) : null,
        index,
      })
      addChildren(kids, id, id, rootId, ops)
      return
    }
    const fiber = child
    const id = idOf(fiber)
    const kind = kindOf(fiber) as TreeKind
    const name = label(fiber)
    names.set(id, name)
    fibers.set(id, fiber)
    visit(fiber, id)
    ops.push({
      op: "add",
      id,
      parentId,
      rootId,
      kind,
      name,
      key: fiber.key === null ? null : bounded(fiber.key),
      index,
    })
    track(fiber, id, ops, true)
    addChildren(kidsOf(fiber, id), id, id, rootId, ops)
  }

  // `key` is where the children are stored; `parentId` is what the ops say (0 at a root).
  const addChildren = (
    kids: Child[],
    key: number,
    parentId: number,
    rootId: number,
    ops: TreeOp[],
  ) => {
    children.set(key, kids.map(childId))
    kids.forEach((kid, index) => {
      place(kid, key)
      addSubtree(kid, parentId, rootId, index, ops)
    })
  }

  const forget = (id: number) => {
    for (const child of children.get(id) ?? []) forget(child)
    children.delete(id)
    names.delete(id)
    fibers.delete(id)
    servers.delete(id)
    waits.delete(id)
    onForget?.(id)
  }

  // This commit's updaters (development builds): React clears the set once the
  // hook returns.
  let updaters: Set<unknown> | undefined
  // React clones every sibling of an updated fiber, and the walk paid for each
  // (#76). A clone with nothing changed keeps its alternate's props, state,
  // child and type, and has no PerformedWork flag. An updater re-run with
  // nothing changed bails out with no flag too, but the recorder counts it.
  const untouched = (fiber: Fiber) => {
    const alternate = fiber.alternate
    return (
      alternate !== null &&
      (fiber.flags & PERFORMED_WORK) === 0 &&
      fiber.memoizedProps === alternate.memoizedProps &&
      fiber.memoizedState === alternate.memoizedState &&
      fiber.child === alternate.child &&
      fiber.type === alternate.type &&
      !updaters?.has(fiber) &&
      !updaters?.has(alternate)
    )
  }

  // Brings a known node's stored children in line with this commit.
  const update = (
    fiber: Fiber,
    key: number,
    parentId: number,
    rootId: number,
    ops: TreeOp[],
  ) => {
    if (children.has(key) && bailedOut(fiber)) return
    const stale = new Set<Fiber>()
    reconcile(kidsOf(fiber, key, stale), stale, key, parentId, rootId, ops)
  }

  // A server node's kids come from its parent fiber's walk, so it reconciles
  // them here rather than through a fiber of its own.
  const reconcile = (
    kids: Child[],
    stale: Set<Fiber>,
    key: number,
    parentId: number,
    rootId: number,
    ops: TreeOp[],
  ) => {
    const prev = children.get(key)
    const next = kids.map(childId)
    // The same children in the same order (a parent of 10,000 cells, one of
    // them updated): no removes, adds or reorder to work out.
    const same =
      prev?.length === next.length && next.every((id, i) => id === prev[i])
    const kept = same ? undefined : new Set(next)
    for (const id of same ? [] : (prev ?? []))
      if (!kept?.has(id)) {
        ops.push({ op: "remove", id })
        forget(id)
      }
    const known = same ? undefined : new Set(prev)
    // What the panel holds after the removes and adds, in its order.
    const applied = same ? next : (prev ?? []).filter((id) => kept?.has(id))
    kids.forEach((kid, index) => {
      const id = next[index] as number
      place(kid, key)
      if (same || known?.has(id)) {
        if (isServer(kid)) {
          reconcile(kid.kids, stale, id, id, rootId, ops)
          return
        }
        fibers.set(id, kid)
        if (untouched(kid)) return
        const name = label(kid)
        if (name !== names.get(id)) {
          names.set(id, name)
          ops.push({ op: "rename", id, name })
        }
        // A stale kid's subtree is unchanged, like a bailed-out one's.
        if (stale.has(kid)) return
        track(kid, id, ops)
        visit(kid, id)
        update(kid, id, id, rootId, ops)
      } else {
        addSubtree(kid, parentId, rootId, index, ops)
        applied.splice(index, 0, id)
      }
    })
    if (!same && applied.some((id, index) => id !== next[index]))
      ops.push({ op: "reorder", rootId, parentId, children: next })
    children.set(key, next)
  }

  return {
    // Appends rather than returns: spreading a large tree into push() overflows the stack.
    full(root: FiberRoot, rootId: number, ops: TreeOp[]) {
      const host = root.current as unknown as Fiber
      const key = idOf(host)
      addChildren(kidsOf(host, key), key, 0, rootId, ops)
    },
    // Ids stay: the same component keeps its id across watches.
    clear() {
      children.clear()
      names.clear()
      fibers.clear()
      servers.clear()
      waits.clear()
    },
    // The nearest mounted component (never a host) owning a DOM element, found
    // through the fiber React keeps on each of its elements.
    // `hosts`: the element's own node may be the answer (the Elements panel).
    owner(element: Element, hosts = false) {
      for (let el: Element | null = element; el; el = el.parentElement) {
        const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
        if (!key) continue
        for (
          let fiber: Fiber | null =
            (el as unknown as Record<string, Fiber>)[key] ?? null;
          fiber;
          fiber = fiber.return
        ) {
          const id = ids.get(fiber)
          const kind = kindOf(fiber)
          if (id && kind && (hosts || kind !== "host") && fibers.has(id))
            return id
        }
        return
      }
    },
    // An emitted, mounted fiber's id and name (either of its two fibers).
    known(fiber: Fiber) {
      const id =
        ids.get(fiber) ??
        (fiber.alternate ? ids.get(fiber.alternate) : undefined)
      if (id !== undefined && fibers.has(id))
        return { id, name: names.get(id) as string }
    },
    // The node's fiber as of the last commit.
    fiber: (id: number) => fibers.get(id),
    // A mounted server node's info, and the _debugInfo array holding it (its
    // awaits follow it there): on its first fiber, or an ancestor of that fiber
    // React put it on instead (a keyed Fragment).
    server(id: number) {
      const info = servers.get(id)?.info
      if (!info) return
      const first = (at: number): Fiber | undefined => {
        const fiber = fibers.get(at)
        if (fiber) return fiber
        for (const child of children.get(at) ?? []) {
          const found = first(child)
          if (found) return found
        }
      }
      for (let at = first(id) ?? null; at; at = at.return) {
        const entries = at._debugInfo
        if (Array.isArray(entries) && entries.includes(info))
          return { info, entries: entries as unknown[] }
      }
      return { info, entries: [] as unknown[] }
    },
    // The components a server node rendered: under it, with no component
    // between (DOM elements, Suspense and providers are walked through).
    clientsUnder(id: number) {
      const out: { id: number; fiber: Fiber }[] = []
      const walk = (at: number) => {
        for (const child of children.get(at) ?? []) {
          if (servers.has(child)) continue
          const fiber = fibers.get(child)
          const kind = fiber && kindOf(fiber)
          if (fiber && kind && COMPONENT_KINDS.has(kind))
            out.push({ id: child, fiber })
          else walk(child)
        }
      }
      walk(id)
      return out
    },
    // Client islands (M7 #83): each component whose nearest component
    // ancestor is a server node, in tree order, with that node, and whether
    // server nodes render under it (a client wrapper around server children).
    islands() {
      const out: {
        id: number
        name: string
        kind: TreeKind
        server: number
        wraps: boolean
      }[] = []
      const nested = new Set<number>()
      const hasServer = (at: number): boolean =>
        (children.get(at) ?? []).some(
          (child) => servers.has(child) || hasServer(child),
        )
      const walk = (
        at: number,
        server: number | undefined,
        collect: boolean,
      ) => {
        for (const child of children.get(at) ?? []) {
          if (servers.has(child)) {
            nested.add(child)
            walk(child, child, collect)
            continue
          }
          const fiber = fibers.get(child)
          const kind = fiber && kindOf(fiber)
          if (!kind || !COMPONENT_KINDS.has(kind)) {
            walk(child, server, collect)
            continue
          }
          if (collect && server !== undefined)
            out.push({
              id: child,
              name: names.get(child) ?? "",
              kind,
              server,
              wraps: hasServer(child),
            })
          walk(child, undefined, collect)
        }
      }
      for (const id of servers.keys()) walk(id, id, false)
      for (const id of servers.keys()) if (!nested.has(id)) walk(id, id, true)
      return out
    },
    // The server nodes under a node, nearest first, not inside another
    // Suspense boundary (what that one waited on is its own).
    serversUnder(id: number) {
      const out: number[] = []
      const walk = (at: number) => {
        for (const child of children.get(at) ?? []) {
          if (fibers.get(child)?.tag === 13) continue
          if (servers.has(child)) out.push(child)
          walk(child)
        }
      }
      walk(id)
      return out
    },
    // The waiting boundaries by id, since when (`waits` above).
    waits: (): ReadonlyMap<number, { since: number }> => waits,
    // The mounted server node an info is, if any.
    serverId(info: object) {
      const id = serverIds.get(info)
      return id !== undefined && servers.has(id) ? id : undefined
    },
    // A node's name and its top-level DOM elements (itself, for a host node).
    // A server node's are its children's, in order.
    find(id: number) {
      const name = names.get(id)
      if (name === undefined) return
      const elements: Element[] = []
      const collect = (at: Fiber) => {
        const dehydrated = (at.memoizedState as { dehydrated?: Node } | null)
          ?.dehydrated
        if (kindOf(at) === "host") elements.push(at.stateNode as Element)
        else if (at.tag === 13 && dehydrated) serverHtml(dehydrated, elements)
        else if (!isHidden(at))
          for (let child = at.child; child; child = child.sibling)
            collect(child)
      }
      const node = (at: number) => {
        const fiber = fibers.get(at)
        if (fiber) collect(fiber)
        else for (const child of children.get(at) ?? []) node(child)
      }
      node(id)
      return { name, elements }
    },
    commit(
      root: FiberRoot,
      rootId: number,
      ops: TreeOp[],
      onVisit: (fiber: Fiber, id: number) => void = noop,
    ) {
      const host = root.current as unknown as Fiber
      updaters = (root as { memoizedUpdaters?: Set<unknown> }).memoizedUpdaters
      visit = onVisit
      update(host, idOf(host), 0, rootId, ops)
      visit = noop
      updaters = undefined
    },
  }
}
