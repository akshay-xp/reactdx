import { MAX_TREE_STRING, type TreeKind, type TreeOp } from "@reactdx/messages"
import type { FiberRoot } from "./hook.ts"

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

// Offscreen (tag 22) keeps suspended or hidden content mounted but off screen.
const isHidden = (fiber: Fiber) =>
  fiber.tag === 22 && fiber.memoizedState !== null

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
// every update, so both carry the id. `onForget` hears each id an unmount drops.
export function createTree({
  onForget,
}: {
  onForget?: (id: number) => void
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
  const serverId = (info: ServerInfo) => {
    const known = serverIds.get(info)
    if (known !== undefined) return known
    const id = nextId++
    serverIds.set(info, id)
    return id
  }
  const childId = (child: Child) => (isServer(child) ? child.id : idOf(child))

  // A bailed-out fiber keeps its child fibers: nothing below it changed. Not
  // when both are null: React clears the alternate's child once the last
  // child unmounts.
  const bailedOut = (fiber: Fiber) =>
    fiber.child !== null &&
    fiber.alternate !== null &&
    fiber.child === fiber.alternate.child

  // Skipped fibers (fragments, text, modes...) pass their children up. Kids
  // under a skipped fiber that bailed out go in `stale` too: React didn't
  // clone them, so they're last commit's fibers (no alternate, old flags).
  // Each kid's Server Component chain, outermost first; set only once one has
  // any. A skipped fiber's infos (a keyed Fragment's) prefix its kids' chains:
  // React puts them on the Fragment alone.
  let chains: ServerInfo[][] | undefined
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
  const group = (kids: Fiber[], of: ServerInfo[][], depth = 0): Child[] => {
    const out: Child[] = []
    let open: { server: Server; kids: Fiber[]; of: ServerInfo[][] } | undefined
    const close = () => {
      if (open) open.server.kids = group(open.kids, open.of, depth + 1)
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
        open = {
          server: { info, id: serverId(info), kids: [] },
          kids: [],
          of: [],
        }
        out.push(open.server)
      }
      open.kids.push(kid)
      open.of.push(chain)
    })
    close()
    return out
  }

  const kidsOf = (fiber: Fiber, stale?: Set<Fiber>): Child[] => {
    chains = undefined
    const kids = visible(fiber, [], stale)
    const of = chains
    chains = undefined
    return of ? group(kids, of) : kids
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
    addChildren(kidsOf(fiber), id, id, rootId, ops)
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
      addSubtree(kid, parentId, rootId, index, ops)
    })
  }

  const forget = (id: number) => {
    for (const child of children.get(id) ?? []) forget(child)
    children.delete(id)
    names.delete(id)
    fibers.delete(id)
    onForget?.(id)
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
    reconcile(kidsOf(fiber, stale), stale, key, parentId, rootId, ops)
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
      if (same || known?.has(id)) {
        if (isServer(kid)) {
          reconcile(kid.kids, stale, id, id, rootId, ops)
          return
        }
        fibers.set(id, kid)
        const name = label(kid)
        if (name !== names.get(id)) {
          names.set(id, name)
          ops.push({ op: "rename", id, name })
        }
        // A stale kid's subtree is unchanged, like a bailed-out one's.
        if (stale.has(kid)) return
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
      addChildren(kidsOf(host), idOf(host), 0, rootId, ops)
    },
    // Ids stay: the same component keeps its id across watches.
    clear() {
      children.clear()
      names.clear()
      fibers.clear()
    },
    // The nearest mounted component (never a host) owning a DOM element, found
    // through the fiber React keeps on each of its elements.
    owner(element: Element) {
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
          if (id && kind && kind !== "host" && fibers.has(id)) return id
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
    // A node's name and its top-level DOM elements (itself, for a host node).
    find(id: number) {
      const fiber = fibers.get(id)
      if (!fiber) return
      const elements: Element[] = []
      const collect = (at: Fiber) => {
        if (kindOf(at) === "host") elements.push(at.stateNode as Element)
        else if (!isHidden(at))
          for (let child = at.child; child; child = child.sibling)
            collect(child)
      }
      collect(fiber)
      return { name: names.get(id) as string, elements }
    },
    commit(
      root: FiberRoot,
      rootId: number,
      ops: TreeOp[],
      onVisit: (fiber: Fiber, id: number) => void = noop,
    ) {
      const host = root.current as unknown as Fiber
      visit = onVisit
      update(host, idOf(host), 0, rootId, ops)
      visit = noop
    },
  }
}
