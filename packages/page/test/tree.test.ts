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

afterEach(async () => {
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
    expect(summary(flush()[0])).toEqual(["remove", "add Spinner at 0"])
    expect(tree.outline()).toEqual([
      "Page function",
      "  Suspense suspense",
      "    Spinner function",
    ])
    await React.act(async () => resolve())
    expect(summary(flush()[0])).toEqual([
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
