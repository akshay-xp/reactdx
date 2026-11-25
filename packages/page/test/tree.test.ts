import {
  GET_SNAPSHOT,
  parseTreeBatch,
  type SnapshotMessage,
  type TreeBatchMessage,
  type TreeOp,
  UNWATCH,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterEach, beforeAll, expect, test, vi } from "vitest"
import { startAgent } from "../src/agent.ts"
import { type HookRecord, installHook } from "../src/hook.ts"
import { createTree } from "../src/tree.ts"
import { react19, ServerChild, server, serverInfo } from "./server.ts"
import { mirror } from "./tree-mirror.ts"
import { windowLike } from "./window.ts"

const h = React.createElement
const posted: unknown[] = []
const roots: Root[] = []
let createRoot: (container: Element) => Root

// One hook and one agent per file: react-dom registers once per module load.
beforeAll(async () => {
  installHook(windowLike())
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import("react-dom/client"))
  startAgent(globalThis, (message) => posted.push(message))
})

// Unwatching drops any ops a test left buffered, so a flush pending from it can't
// post a batch into the next test.
afterEach(async () => {
  send(UNWATCH)
  for (const root of roots.splice(0)) await React.act(() => root.unmount())
  posted.length = 0
})

async function render(node: React.ReactNode) {
  const root = createRoot(document.createElement("div"))
  roots.push(root)
  await React.act(() => root.render(node))
  return root
}

const send = (data: unknown) =>
  globalThis.dispatchEvent(new MessageEvent("message", { data }))

const batches = () =>
  posted.filter(
    (m): m is TreeBatchMessage => (m as { type?: string }).type === "tree",
  )

const adds = (ops: TreeOp[]) =>
  ops.filter((op): op is Extract<TreeOp, { op: "add" }> => op.op === "add")

function Child() {
  return h("span", null, "hi")
}
function App() {
  return h("div", null, h(Child), "x")
}

test("watch posts a reset and the full tree", async () => {
  await render(h(App))
  send(WATCH)

  const [batch] = batches()
  expect(parseTreeBatch(batch)).toEqual(batch)
  expect(batch?.seq).toBe(1)
  expect(batch?.ops[0]).toEqual({ op: "reset" })
  const tree = mirror()
  tree.apply(batch?.ops ?? [])
  expect(tree.outline()).toEqual([
    "App function",
    "  div host",
    "    Child function",
    "      span host",
  ])
  send(GET_SNAPSHOT)
  const snapshot = posted.at(-1) as SnapshotMessage
  const nodes = adds(batch?.ops ?? [])
  expect(nodes.every((n) => n.rootId === snapshot?.roots[0]?.id)).toBe(true)
  expect(nodes[0]?.parentId).toBe(0)
})

class Klass extends React.Component {
  render() {
    return null
  }
}
const Memoized = React.memo(function Memoized() {
  return null
})
const Fwd = React.forwardRef(function Fwd() {
  return null
})
const Named = React.forwardRef(function Inner() {
  return null
})
Named.displayName = "Named"
const Lazy = React.lazy(async () => ({
  default: function Lazy() {
    return null
  },
}))
const Theme = React.createContext(0)
Theme.displayName = "Theme"
const Plain = React.createContext(0)
function Item() {
  return null
}
function Long() {
  return null
}
Long.displayName = "L".repeat(300)
const { Activity } = React as {
  Activity?: React.ComponentType<{ mode: string; children?: React.ReactNode }>
}
const consume = () => null

function Kinds() {
  return h(
    React.Fragment,
    null,
    h(Klass),
    h(Memoized),
    h(Fwd),
    h(Named),
    h(React.Suspense, { fallback: null }, h(Lazy)),
    h(Theme.Provider, { value: 1 }, h(Theme.Consumer, { children: consume })),
    h(Plain.Provider, { value: 1 }),
    h(React.Profiler, { id: "p", onRender() {} }, h(Item)),
    h(() => null),
    [h(Item, { key: "a" }), h(Item, { key: "b" })],
    h(Long),
    Activity && h(Activity, { mode: "visible" }, h(Item)),
  )
}

test("every visible kind gets its kind and name; wrappers emit nothing", async () => {
  await render(h(React.StrictMode, null, h(Kinds)))
  // The lazy component resolves on a later tick.
  await React.act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  send(WATCH)

  const tree = mirror()
  tree.apply(batches()[0]?.ops ?? [])
  expect(tree.outline()).toEqual([
    "Kinds function",
    "  Klass class",
    "  Memoized memo",
    "  Fwd forwardRef",
    "  Named forwardRef",
    "  Suspense suspense",
    "    Lazy lazy",
    "  Theme provider",
    "    Theme consumer",
    "  Context provider",
    "  Profiler profiler",
    "    Item function",
    "  Anonymous function",
    "  Item function key=a",
    "  Item function key=b",
    `  ${"L".repeat(256)} function`,
    ...(Activity ? ["  Activity activity", "    Item function"] : []),
  ])
})

test("a resync over 2,000 ops is split into consecutive batches", async () => {
  function List() {
    return h(
      "ul",
      null,
      Array.from({ length: 2500 }, (_, i) => h("li", { key: i })),
    )
  }
  await render(h(List))
  send(WATCH)

  const [first, second, extra] = batches()
  expect(first?.seq).toBe(1)
  expect(first?.ops).toHaveLength(2000)
  expect(first?.ops[0]).toEqual({ op: "reset" })
  expect(second?.seq).toBe(2)
  expect(second?.ops).toHaveLength(503)
  expect(extra).toBeUndefined()
  for (const batch of [first, second])
    expect(parseTreeBatch(batch)).toEqual(batch)
})

// Fake timers drive the agent's 100 ms flush; watching starts with a mirrored resync.
async function watching(
  run: (
    flush: () => TreeBatchMessage[],
    resync: TreeOp[],
    tree: ReturnType<typeof mirror>,
  ) => Promise<void>,
) {
  // Let a flush scheduled on real timers (by earlier commits) run first.
  await new Promise((resolve) => setTimeout(resolve, 150))
  posted.length = 0
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  try {
    send(WATCH)
    const tree = mirror()
    const resync = batches().flatMap((batch) => batch.ops)
    tree.apply(resync)
    posted.length = 0
    await run(
      () => {
        vi.advanceTimersByTime(100)
        const sent = batches()
        for (const batch of sent) tree.apply(batch.ops)
        posted.length = 0
        return sent
      },
      resync,
      tree,
    )
    return tree
  } finally {
    vi.useRealTimers()
  }
}

const summary = (batch?: TreeBatchMessage) =>
  batch?.ops.map((op) =>
    op.op === "add"
      ? `add ${op.name} at ${op.index}`
      : op.op === "remove"
        ? "remove"
        : op.op,
  )

test("mounts and unmounts send only the changed subtree, on the flush", async () => {
  let setShow = (_: boolean) => {}
  let setCount = (_: number) => {}
  const Sibling = React.memo(function Sibling() {
    return h("b")
  })
  function Extra() {
    return h("span")
  }
  function Toggle() {
    const [show, set] = React.useState(false)
    const [count, setCountState] = React.useState(0)
    setShow = set
    setCount = setCountState
    return h("div", null, h(Sibling), show && h(Extra), h(Sibling), count)
  }
  await render(h(Toggle))
  const ids: number[] = []

  const tree = await watching(async (flush) => {
    await React.act(() => setShow(true))
    expect(batches()).toEqual([])
    const [mounted, ...rest] = flush()
    expect(rest).toEqual([])
    expect(mounted?.seq).toBe(2)
    expect(summary(mounted)).toEqual(["add Extra at 1", "add span at 0"])
    ids.push(...adds(mounted?.ops ?? []).map((op) => op.id))

    await React.act(() => setShow(false))
    const [unmounted, ...more] = flush()
    expect(more).toEqual([])
    expect(unmounted?.ops).toEqual([{ op: "remove", id: ids[0] }])

    await React.act(() => setCount(1))
    expect(flush()).toEqual([])
  })
  expect(tree.outline()).toEqual([
    "Toggle function",
    "  div host",
    "    Sibling memo",
    "      b host",
    "    Sibling memo",
    "      b host",
  ])
})

test("a root mounted while watched is added, and removed when it unmounts", async () => {
  await render(h(App))
  await watching(async (flush, resync) => {
    const first = adds(resync)
    const second = await render(h(Child))
    const [mounted] = flush()
    expect(summary(mounted)).toEqual(["add Child at 0", "add span at 0"])
    const [child] = adds(mounted?.ops ?? [])
    expect(child?.parentId).toBe(0)
    expect(child?.rootId).not.toBe(first[0]?.rootId)

    roots.splice(roots.indexOf(second), 1)
    await React.act(() => second.unmount())
    const [unmounted] = flush()
    expect(unmounted?.ops).toEqual([{ op: "remove", id: child?.id }])
  })
})

test("a keyed reorder sends one reorder op with the same ids", async () => {
  let setOrder = (_: string[]) => {}
  function List() {
    const [order, set] = React.useState(["a", "b", "c"])
    setOrder = set
    return order.map((key) => h(Item, { key }))
  }
  await render(h(List))
  const tree = await watching(async (flush, resync) => {
    const items = adds(resync).filter((op) => op.key)
    const list = adds(resync).find((op) => op.name === "List")
    await React.act(() => setOrder(["c", "b", "a"]))
    const sent = flush()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.ops).toEqual([
      {
        op: "reorder",
        rootId: list?.rootId,
        parentId: list?.id,
        children: items.map((op) => op.id).reverse(),
      },
    ])
  })
  expect(tree.outline()).toEqual([
    "List function",
    "  Item function key=c",
    "  Item function key=b",
    "  Item function key=a",
  ])
})

test("a component whose name changes is renamed", async () => {
  let rerender = (_: number) => {}
  const Renamable: React.FC<{ n: number }> = function Renamable() {
    return null
  }
  function Parent() {
    const [n, set] = React.useState(0)
    rerender = set
    return h(Renamable, { n })
  }
  await render(h(Parent))
  await watching(async (flush, resync) => {
    const child = adds(resync).find((op) => op.name === "Renamable")
    Renamable.displayName = "Renamed"
    await React.act(() => rerender(1))
    const [renamed, ...rest] = flush()
    expect(rest).toEqual([])
    expect(renamed?.ops).toEqual([
      { op: "rename", id: child?.id, name: "Renamed" },
    ])
    await React.act(() => rerender(2))
    expect(flush()).toEqual([])
  })
})

test("suspended content is hidden from the tree until it shows", async () => {
  let resolve = () => {}
  let ready = false
  const promise = new Promise<void>((r) => {
    resolve = () => {
      ready = true
      r()
    }
  })
  let setWaiting = (_: boolean) => {}
  function Spinner() {
    return null
  }
  function Shown() {
    return h("i")
  }
  function Waits() {
    if (!ready) throw promise
    return null
  }
  function Page() {
    const [waiting, set] = React.useState(false)
    setWaiting = set
    return h(
      React.Suspense,
      { fallback: h(Spinner) },
      h(Shown),
      waiting && h(Waits),
    )
  }
  await render(h(Page))
  await watching(async (flush, _, tree) => {
    await React.act(() => setWaiting(true))
    expect(summary(flush()[0])).toEqual([
      "suspense",
      "remove",
      "add Spinner at 0",
    ])
    expect(tree.outline()).toEqual([
      "Page function",
      "  Suspense suspense",
      "    Spinner function",
    ])
    await React.act(async () => resolve())
    expect(summary(flush()[0])).toEqual([
      "suspense",
      "remove",
      "add Shown at 0",
      "add i at 0",
      "add Waits at 1",
    ])
    expect(tree.outline()).toEqual([
      "Page function",
      "  Suspense suspense",
      "    Shown function",
      "      i host",
      "    Waits function",
    ])
  })
})

test("unwatch stops tree work; watching again resyncs with the same ids", async () => {
  let setShow = (_: boolean) => {}
  function Toggle() {
    const [show, set] = React.useState(false)
    setShow = set
    return show && h(Child)
  }
  send(UNWATCH)
  await render(h(Toggle))
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(batches()).toEqual([])

  await watching(async (flush, resync) => {
    const toggle = adds(resync).find((op) => op.name === "Toggle")
    send(UNWATCH)
    await React.act(() => setShow(true))
    expect(flush()).toEqual([])

    send(WATCH)
    const [batch] = batches()
    expect(batch?.seq).toBe(1)
    expect(batch?.ops[0]).toEqual({ op: "reset" })
    const again = adds(batch?.ops ?? [])
    expect(again.find((op) => op.name === "Toggle")?.id).toBe(toggle?.id)
    expect(again.map((op) => op.name)).toEqual(["Toggle", "Child", "span"])
  })
})

test("production renderers' roots stay out of the tree", async () => {
  const record = (globalThis as Record<symbol, HookRecord>)[
    Symbol.for("reactdx")
  ] as HookRecord
  const info = record.renderers.get(1)
  if (!info) throw new Error("no renderer")
  let setShow = (_: boolean) => {}
  function Toggle() {
    const [show, set] = React.useState(false)
    setShow = set
    return show && h(Child)
  }
  await render(h(Toggle))
  info.bundleType = 0
  try {
    await watching(async (flush, resync) => {
      expect(resync).toEqual([{ op: "reset" }])
      await React.act(() => setShow(true))
      expect(flush()).toEqual([])
    })
  } finally {
    info.bundleType = 1
  }
  send(WATCH)
  expect(adds(batches()[0]?.ops ?? []).map((op) => op.name)).toEqual([
    "Toggle",
    "Child",
    "span",
  ])
})

let setCount: (count: number) => void = () => {}
function Clicked() {
  return null
}
function Counter() {
  const [count, set] = React.useState(0)
  setCount = set
  return h(
    React.Fragment,
    null,
    h("button", null, h("span", null, "Count")),
    count % 2 === 1 && h(Clicked),
  )
}
function Page() {
  return h(React.Fragment, null, h("p", null, "v"), h(Counter))
}

function fiberRootOf(container: Element) {
  const record = (globalThis as unknown as Record<symbol, HookRecord>)[
    Symbol.for("reactdx")
  ] as HookRecord
  const fiberRoot = [...record.roots.values()]
    .flatMap((set) => [...set])
    .find(
      (r) =>
        (r as unknown as { containerInfo: Element }).containerInfo ===
        container,
    )
  if (!fiberRoot) throw new Error("no fiber root")
  return fiberRoot
}

// Page rendered (Clicked mounted), walked by a fresh tree.
async function mountPage() {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(h(Page)))
  await React.act(() => setCount(1))
  const fiberRoot = fiberRootOf(container)
  const tree = createTree()
  const ops: TreeOp[] = []
  tree.full(fiberRoot, 1, ops)
  const id = (name: string) =>
    adds(ops).find((op) => op.name === name)?.id as number
  return { container, root, fiberRoot, tree, id }
}

test("find gives a node's name and top-level DOM elements", async () => {
  const { container, fiberRoot, tree, id } = await mountPage()
  const button = container.querySelector("button")
  const p = container.querySelector("p")
  expect(tree.find(id("Counter"))).toEqual({
    name: "Counter",
    elements: [button],
  })
  expect(tree.find(id("Page"))?.elements).toEqual([p, button])
  expect(tree.find(id("button"))?.elements).toEqual([button])
  expect(tree.find(id("Clicked"))).toEqual({ name: "Clicked", elements: [] })
  expect(tree.find(9999)).toBeUndefined()

  await React.act(() => setCount(2))
  tree.commit(fiberRoot, 1, [])
  expect(tree.find(id("Clicked"))).toBeUndefined()
  expect(tree.find(id("Counter"))?.elements).toEqual([button])
})

test("owner gives the component that owns a DOM element", async () => {
  const { container, root, fiberRoot, tree, id } = await mountPage()
  const button = container.querySelector("button") as Element
  expect(tree.owner(button)).toBe(id("Counter"))
  expect(tree.owner(container.querySelector("span") as Element)).toBe(
    id("Counter"),
  )
  expect(tree.owner(container.querySelector("p") as Element)).toBe(id("Page"))
  expect(tree.owner(document.createElement("div"))).toBeUndefined()
  await React.act(() => root.unmount())
  roots.splice(roots.indexOf(root), 1)
  tree.commit(fiberRoot, 1, [])
  expect(tree.owner(button)).toBeUndefined()
})

let setVisited: (n: number) => void = () => {}
function VisitInner() {
  return null
}
const VisitMemo = React.memo(function VisitMemo() {
  return h(VisitInner)
})
function VisitPlain() {
  return h("div")
}
function VisitParent() {
  const [n, set] = React.useState(0)
  setVisited = set
  return h(
    React.Fragment,
    null,
    h(VisitMemo),
    h(VisitPlain, { n }),
    n % 2 === 1 && h(VisitAdded),
  )
}
function VisitAddedChild() {
  return null
}
function VisitAdded() {
  return h(VisitAddedChild)
}

test("commit visits the fibers it reconciles, not inside bailed-out subtrees", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(h(VisitParent)))
  const fiberRoot = fiberRootOf(container)
  const tree = createTree()
  const ops: TreeOp[] = []
  tree.full(fiberRoot, 1, ops)
  const id = (name: string) =>
    adds(ops).find((op) => op.name === name)?.id as number

  await React.act(() => setVisited(1))
  const visited: number[] = []
  tree.commit(fiberRoot, 1, [], (fiber, at) => {
    expect(tree.known(fiber)?.id).toBe(at)
    visited.push(at)
  })
  for (const name of ["VisitParent", "VisitMemo", "VisitPlain", "div"])
    expect(visited).toContain(id(name))
  expect(visited).not.toContain(id("VisitInner"))
  expect(new Set(visited).size).toBe(visited.length)
})

test("commit visits newly mounted subtrees", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(h(VisitParent)))
  const fiberRoot = fiberRootOf(container)
  const tree = createTree()
  tree.full(fiberRoot, 1, [])

  await React.act(() => setVisited(1))
  const ops: TreeOp[] = []
  const visited: number[] = []
  tree.commit(fiberRoot, 1, ops, (_, at) => visited.push(at))
  const id = (name: string) =>
    adds(ops).find((op) => op.name === name)?.id as number
  expect(visited).toContain(id("VisitAdded"))
  expect(visited).toContain(id("VisitAddedChild"))
  expect(new Set(visited).size).toBe(visited.length)
})

let setOnly: (show: boolean) => void = () => {}
function OnlyChild() {
  const [show, set] = React.useState(true)
  setOnly = set
  return h("main", null, show && h("p"))
}

test("a node's last child unmounting is removed", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(h(OnlyChild)))
  const fiberRoot = fiberRootOf(container)
  const tree = createTree()
  const ops: TreeOp[] = []
  tree.full(fiberRoot, 1, ops)
  const p = adds(ops).find((op) => op.name === "p")?.id
  await React.act(() => setOnly(false))
  const more: TreeOp[] = []
  tree.commit(fiberRoot, 1, more)
  expect(more).toEqual([{ op: "remove", id: p }])
})

async function serverTree(node: React.ReactNode) {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(node))
  const fiberRoot = fiberRootOf(container)
  const forgot: number[] = []
  const tree = createTree({ onForget: (id) => forgot.push(id) })
  const ops: TreeOp[] = []
  tree.full(fiberRoot, 1, ops)
  const view = mirror()
  view.apply(ops)
  const id = (name: string) =>
    adds(ops).find((op) => op.name === name)?.id as number
  const commit = async (next: React.ReactNode) => {
    await React.act(() => root.render(next))
    const more: TreeOp[] = []
    tree.commit(fiberRoot, 1, more)
    view.apply(more)
    return more
  }
  return { tree, ops, view, id, commit, forgot, fiberRoot, container }
}

test.skipIf(!react19)(
  "a Server Component is a node holding what it rendered",
  async () => {
    const { tree, ops, view, id } = await serverTree(
      server(serverInfo("Shop"), [
        h("p", { key: "a" }),
        h(ServerChild, { key: "b" }),
      ]),
    )
    expect(view.outline()).toEqual([
      "Shop server",
      "  p host key=a",
      "  ServerChild function key=b",
      "    i host",
    ])
    const shop = adds(ops).find((op) => op.name === "Shop")
    expect(shop).toMatchObject({ kind: "server", key: null, parentId: 0 })
    expect(new Set(adds(ops).map((op) => op.id)).size).toBe(adds(ops).length)
    expect(tree.fiber(id("Shop"))).toBeUndefined()
  },
)

test.skipIf(!react19)(
  "nested Server Components nest by their chain and by position",
  async () => {
    const shop = serverInfo("Shop")
    const reviews = serverInfo("Reviews")
    const awaited = { awaited: { name: "getReviews", start: 0, end: 5 } }
    const chained = await serverTree(
      server(shop, server(reviews, h(ServerChild), [awaited])),
    )
    expect(chained.view.outline()).toEqual([
      "Shop server",
      "  Reviews server",
      "    ServerChild function",
      "      i host",
    ])
    const placed = await serverTree(
      server(shop, h("main", null, server(reviews, h("section")))),
    )
    expect(placed.view.outline()).toEqual([
      "Shop server",
      "  main host",
      "    Reviews server",
      "      section host",
    ])
  },
)

test.skipIf(!react19)(
  "a keyed Fragment's Server Component holds the Fragment's children",
  async () => {
    const { view } = await serverTree(
      server(
        serverInfo("Shop"),
        h(React.Fragment, { key: "f" }, h("p"), h(ServerChild)),
      ),
    )
    expect(view.outline()).toEqual([
      "Shop server",
      "  p host",
      "  ServerChild function",
      "    i host",
    ])
  },
)

let setServerCount: (n: number) => void = () => {}
function ServerCounter() {
  const [n, set] = React.useState(0)
  setServerCount = set
  return h("b", null, n)
}

test.skipIf(!react19)(
  "a client re-render under a Server Component keeps its node",
  async () => {
    const { view, fiberRoot, tree } = await serverTree(
      server(serverInfo("Shop"), h(ServerCounter)),
    )
    await React.act(() => setServerCount(1))
    const ops: TreeOp[] = []
    tree.commit(fiberRoot, 1, ops)
    expect(ops).toEqual([])
    view.apply(ops)
    expect(view.outline()).toEqual([
      "Shop server",
      "  ServerCounter function",
      "    b host",
    ])
  },
)

test.skipIf(!react19)(
  "a Server Component leaves with its output and comes back with its id",
  async () => {
    const shop = server(serverInfo("Shop"), h("p"))
    const page = (show: boolean) => h("main", null, show && shop)
    const { id, commit, forgot } = await serverTree(page(true))
    const shopId = id("Shop")
    expect(await commit(page(false))).toEqual([{ op: "remove", id: shopId }])
    expect(forgot).toEqual(expect.arrayContaining([shopId, id("p")]))
    const back = adds(await commit(page(true)))
    expect(back.find((op) => op.name === "Shop")?.id).toBe(shopId)
  },
)

test.skipIf(!react19)(
  "a new server payload for the same component keeps its id",
  async () => {
    const page = (name: string) =>
      h("main", null, server(serverInfo(name), h("p")))
    const { id, commit, view } = await serverTree(page("Shop"))
    const shopId = id("Shop")
    expect(await commit(page("Shop"))).toEqual([])
    expect(view.outline()).toEqual(["main host", "  Shop server", "    p host"])
    expect(view.nodes.get(shopId)?.name).toBe("Shop")

    const ops = await commit(page("Cart"))
    expect(ops).toContainEqual({ op: "remove", id: shopId })
    expect(view.outline()).toEqual(["main host", "  Cart server", "    p host"])
  },
)

test.skipIf(!react19)(
  "one Server Component info never makes two nodes",
  async () => {
    const shop = serverInfo("Shop")
    const { ops, view } = await serverTree(
      h(
        "div",
        null,
        server(shop, h("p")),
        h("hr"),
        server(shop, h("em")),
        h("span", null, server(shop, h("b"))),
      ),
    )
    expect(view.outline()).toEqual([
      "div host",
      "  Shop server",
      "    p host",
      "  hr host",
      "  em host",
      "  span host",
      "    b host",
    ])
    expect(new Set(adds(ops).map((op) => op.id)).size).toBe(adds(ops).length)
  },
)

test.skipIf(!react19)(
  "a Server Component's DOM is its children's top elements",
  async () => {
    const output = server(
      serverInfo("Shop"),
      h(
        "main",
        null,
        server(serverInfo("Reviews"), [
          h("p", { key: "a" }),
          h(ServerChild, { key: "b" }),
        ]),
      ),
    )
    const { tree, id, commit, container } = await serverTree(
      h("div", null, output),
    )
    const main = container.querySelector("main")
    expect(tree.find(id("Shop"))).toEqual({ name: "Shop", elements: [main] })
    expect(tree.find(id("Reviews"))).toEqual({
      name: "Reviews",
      elements: [container.querySelector("p"), container.querySelector("i")],
    })
    await commit(h("div"))
    expect(tree.find(id("Shop"))).toBeUndefined()
  },
)

test.skipIf(!react19)(
  "a Server Component node's info and the debug entries holding it",
  async () => {
    const shop = serverInfo("Shop")
    const { tree, id, commit } = await serverTree(
      h("div", null, server(shop, h("p"))),
    )
    const shopId = id("Shop")
    const p = tree.fiber(id("p")) as { _debugInfo?: unknown }
    expect(tree.server(shopId)?.info).toBe(shop)
    expect(tree.server(shopId)?.entries).toBe(p._debugInfo)
    expect(tree.serverId(shop)).toBe(shopId)

    const cart = serverInfo("Cart")
    await commit(
      h("div", null, server(cart, h(React.Fragment, { key: "f" }, h("b")))),
    )
    const fragment = (
      tree.fiber(id("div")) as { child: { _debugInfo?: unknown } }
    ).child
    expect(tree.server(tree.serverId(cart) as number)?.entries).toBe(
      fragment._debugInfo,
    )
    expect(tree.server(shopId)).toBeUndefined()
    expect(tree.serverId(shop)).toBeUndefined()
  },
)

// Suspends until `release` settles it; `rearm` makes a new pending promise.
let release = () => {}
let pending: Promise<void>
let settled = false
const rearm = () => {
  settled = false
  pending = new Promise<void>((resolve) => (release = resolve))
  pending.then(() => (settled = true))
}
rearm()
function Thrower() {
  if (!settled) throw pending
  return h("p")
}

test("a Suspense boundary that waits is reported after its add", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() =>
    root.render(h(React.Suspense, { fallback: h("i") }, h(Thrower))),
  )
  const tree = createTree({ now: () => 100 })
  const ops: TreeOp[] = []
  tree.full(fiberRootOf(container), 1, ops)
  const boundary = adds(ops).find((op) => op.kind === "suspense")?.id
  const at = ops.findIndex((op) => op.op === "add" && op.id === boundary)
  expect(ops[at + 1]).toEqual({
    op: "suspense",
    id: boundary,
    state: "waiting",
    ms: 0,
  })
  await React.act(async () => release())
})

test("a dehydrated boundary has waited since navigation start", () => {
  const node = (tag: number, memoizedState: unknown, child = null) => ({
    tag,
    key: null,
    type: null,
    elementType: null,
    child,
    sibling: null,
    alternate: null,
    return: null,
    memoizedProps: {},
    memoizedState,
    stateNode: null,
  })
  const boundary = node(13, { dehydrated: {} })
  const root = { current: node(3, null, boundary as never) }
  const ops: TreeOp[] = []
  createTree({ now: () => 500 }).full(root as never, 1, ops)
  expect(ops.filter((op) => op.op === "suspense")).toEqual([
    { op: "suspense", id: 2, state: "waiting", ms: 500 },
  ])
})

test("a boundary showing its content reports no wait", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() =>
    root.render(h(React.Suspense, { fallback: h("i") }, h("p"))),
  )
  const ops: TreeOp[] = []
  createTree().full(fiberRootOf(container), 1, ops)
  expect(ops.filter((op) => op.op === "suspense")).toEqual([])
})

let showThrower = (_: number) => {}
function Rearmed() {
  const [n, set] = React.useState(0)
  showThrower = set
  return h(
    "div",
    null,
    h(React.Suspense, { fallback: h("i") }, h(Thrower, { key: n })),
  )
}

test("a boundary's content arriving reports how long it waited, then waiting again", async () => {
  rearm()
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(h(Rearmed)))
  const times = [100, 940, 1000, 1000]
  const tree = createTree({ now: () => times.shift() ?? 2000 })
  const fiberRoot = fiberRootOf(container)
  const ops: TreeOp[] = []
  tree.full(fiberRoot, 1, ops)
  const boundary = adds(ops).find((op) => op.kind === "suspense")?.id
  const waits = (list: TreeOp[]) => list.filter((op) => op.op === "suspense")

  await React.act(async () => release())
  const arrived: TreeOp[] = []
  tree.commit(fiberRoot, 1, arrived)
  expect(waits(arrived)).toEqual([
    { op: "suspense", id: boundary, state: "arrived", ms: 840 },
  ])

  await React.act(() => root.render(h(Rearmed)))
  const quiet: TreeOp[] = []
  tree.commit(fiberRoot, 1, quiet)
  expect(waits(quiet)).toEqual([])

  rearm()
  await React.act(() => showThrower(1))
  const again: TreeOp[] = []
  tree.commit(fiberRoot, 1, again)
  expect(waits(again)).toEqual([
    { op: "suspense", id: boundary, state: "waiting", ms: 0 },
  ])
  await React.act(async () => release())
})

test("a resync sends a boundary's wait again, counted from its start", async () => {
  rearm()
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() =>
    root.render(h(React.Suspense, { fallback: h("i") }, h(Thrower))),
  )
  const times = [100, 400]
  const tree = createTree({ now: () => times.shift() ?? 0 })
  const fiberRoot = fiberRootOf(container)
  tree.full(fiberRoot, 1, [])
  const again: TreeOp[] = []
  tree.full(fiberRoot, 1, again)
  expect(again.filter((op) => op.op === "suspense")).toEqual([
    { op: "suspense", id: expect.any(Number), state: "waiting", ms: 300 },
  ])
  await React.act(async () => release())
})
