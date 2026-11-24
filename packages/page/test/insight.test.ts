import type { TreeOp } from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterEach, beforeAll, expect, test } from "vitest"
import { type HookRecord, installHook } from "../src/hook.ts"
import { createRecorder } from "../src/insight.ts"
import { createTree } from "../src/tree.ts"
import { windowLike } from "./window.ts"

const h = React.createElement
const roots: Root[] = []
let createRoot: (container: Element) => Root

beforeAll(async () => {
  installHook(windowLike())
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import("react-dom/client"))
})

afterEach(async () => {
  for (const root of roots.splice(0)) await React.act(() => root.unmount())
})

const hookRecord = () =>
  (globalThis as unknown as Record<symbol, HookRecord>)[
    Symbol.for("reactdx")
  ] as HookRecord

function fiberRootOf(container: Element) {
  const fiberRoot = [...hookRecord().roots.values()]
    .flatMap((set) => [...set])
    .find(
      (r) =>
        (r as unknown as { containerInfo: Element }).containerInfo ===
        container,
    )
  if (!fiberRoot) throw new Error("no fiber root")
  return fiberRoot
}

// Renders `node`, walks it with a fresh tree, and records commits on request.
async function mount(
  node: React.ReactNode,
  limits?: Parameters<typeof createRecorder>[0],
) {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(node))
  const fiberRoot = fiberRootOf(container)
  const recorder = createRecorder(limits)
  const tree = createTree({ onForget: recorder.forget })
  const ops: TreeOp[] = []
  tree.full(fiberRoot, 1, ops)
  const ids = new Map<string, number>()
  const learn = (list: TreeOp[]) => {
    for (const op of list) if (op.op === "add") ids.set(op.name, op.id)
  }
  learn(ops)
  // Recorded inside onCommitFiberRoot, as the agent does: React clears the
  // updaters once it returns, and passive effects (after it) detach deleted
  // subtrees.
  hookRecord().listeners.add((_, root) => {
    if (root !== fiberRoot) return
    const added: TreeOp[] = []
    recorder.commit(
      1,
      new Set(
        (root as unknown as { memoizedUpdaters?: Set<unknown> })
          .memoizedUpdaters,
      ),
      (visit) => tree.commit(fiberRoot, 1, added, visit),
    )
    learn(added)
  })
  const record = async (update: () => void) => {
    await React.act(() => {
      update()
    })
  }
  const id = (name: string) => {
    const found = ids.get(name)
    if (found === undefined) throw new Error(`no ${name}`)
    return found
  }
  const kinds = (name: string) => recorder.latest(id(name))?.kinds
  return { recorder, record, id, kinds, tree, root }
}

let setParent: (n: number) => void = () => {}
function Child() {
  return h("div")
}
const Still = React.memo(function Still() {
  return h("div")
})
// Memo: once mounted, it renders again only if its props change (never).
const Late = React.memo(function Late() {
  return null
})
function Parent() {
  const [n, set] = React.useState(0)
  setParent = set
  return h(React.Fragment, null, h(Child), h(Still), n % 2 === 1 && h(Late))
}

test("a commit records mounts and renders caused by the parent", async () => {
  const { record, kinds, recorder, id } = await mount(h(Parent))
  await record(() => setParent(1))
  expect(kinds("Late")).toEqual(["mount"])
  expect(kinds("Child")).toEqual(["parent"])
  expect(recorder.latest(id("Still"))).toBeUndefined()
  expect(recorder.latest(id("div"))).toBeUndefined()
  expect(recorder.latest(id("Late"))?.seq).toBe(1)
})

let setProps: (n: number) => void = () => {}
function Shown(_: { count: number; extra?: string }) {
  return null
}
function Passing() {
  const [n, set] = React.useState(1)
  setProps = set
  return h(
    React.Fragment,
    null,
    h(Shown, n === 1 ? { count: n, extra: "x" } : { count: n }),
    h(Child),
  )
}

test("changed props are recorded with old and new values", async () => {
  const { record, kinds, recorder, id } = await mount(h(Passing))
  await record(() => setProps(2))
  expect(kinds("Shown")).toEqual(["props"])
  expect(recorder.latest(id("Shown"))?.props).toEqual([
    { key: "count", old: 1, new: 2 },
    { key: "extra", old: "x", new: undefined },
  ])
  // A new props object holding the same values: nothing of its own changed.
  expect(kinds("Child")).toEqual(["parent"])
})

let setStateful: (n: number) => void = () => {}
let refOf: { current: number } = { current: 0 }
function Stateful() {
  const ref = React.useRef(0)
  refOf = ref
  const [n, set] = React.useState(0)
  setStateful = set
  React.useMemo(() => n * 2, [n])
  return null
}
let renderAll: () => void = () => {}
function StatefulParent() {
  const [, set] = React.useState(0)
  renderAll = () => set((n) => n + 1)
  return h(Stateful)
}

test("changed state hooks are recorded by hook list index", async () => {
  const { record, kinds, recorder, id } = await mount(h(StatefulParent))
  await record(() => setStateful(1))
  expect(kinds("Stateful")).toEqual(["state"])
  expect(recorder.latest(id("Stateful"))?.hooks).toEqual([
    { index: 1, old: 0, new: 1 },
  ])
  // A ref has no update queue: changing it isn't a state change.
  await record(() => {
    refOf.current = 5
    renderAll()
  })
  expect(kinds("Stateful")).toEqual(["parent"])
})

let ticker: React.Component<object, { ticks: number; label: string }> | null =
  null
class Ticker extends React.Component<object, { ticks: number; label: string }> {
  state = { ticks: 0, label: "t" }
  componentDidMount() {
    ticker = this
  }
  render() {
    return null
  }
}

test("a class component's changed state keys are recorded", async () => {
  const { record, kinds, recorder, id } = await mount(h(Ticker))
  await record(() => ticker?.setState({ ticks: 1 }))
  expect(kinds("Ticker")).toEqual(["state"])
  expect(recorder.latest(id("Ticker"))?.state).toEqual([
    { key: "ticks", old: 0, new: 1 },
  ])
})

const Theme = React.createContext("light")
Theme.displayName = "Theme"
let setTheme: (theme: string) => void = () => {}
function Reader() {
  React.useContext(Theme)
  return null
}
const Memoed = React.memo(Reader)
function Themed() {
  const [theme, set] = React.useState("dark")
  setTheme = set
  return h(Theme.Provider, { value: theme }, h(Memoed))
}

test("changed contexts are recorded by read order", async () => {
  const { record, kinds, recorder, id } = await mount(h(Themed))
  await record(() => setTheme("light"))
  expect(kinds("Reader")).toEqual(["context"])
  expect(recorder.latest(id("Reader"))?.contexts).toEqual([
    { read: 0, old: "dark", new: "light" },
  ])
})

test("a render by its own update with nothing changed is forced", async () => {
  const { record, kinds, tree, id } = await mount(h(Parent))
  const fiber = tree.fiber(id("Child"))
  const renderer = [
    ...(
      globalThis as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          renderers: Map<number, { scheduleUpdate(fiber: unknown): void }>
        }
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values(),
  ][0]
  await record(() => renderer?.scheduleUpdate(fiber))
  expect(kinds("Child")).toEqual(["force"])
})

test("past the commit cap the oldest commit drops, and clear drops them all", async () => {
  const { record, recorder, id } = await mount(h(Parent), { maxCommits: 5 })
  await record(() => setParent(1))
  // Odd counts keep Late mounted without rendering it again.
  for (let i = 1; i < 5; i++) await record(() => setParent(1 + 2 * i))
  expect(recorder.rendered(1)).toBeDefined()
  expect(recorder.dropped()).toBe(false)
  await record(() => setParent(11))
  expect(recorder.rendered(1)).toBeUndefined()
  expect(recorder.summaries(0)).toHaveLength(5)
  expect(recorder.latest(id("Child"))).toBeDefined()
  recorder.clear()
  expect(recorder.latest(id("Child"))).toBeUndefined()
  expect(recorder.dropped()).toBe(false)
})

function Cell() {
  return null
}
let setCells: (n: number) => void = () => {}
function Cells() {
  const [n, set] = React.useState(0)
  setCells = set
  return [0, 1, 2].map((key) => h(Cell, { key, n }))
}

test("past the record budget whole commits drop, oldest first", async () => {
  const { record, recorder } = await mount(h(Cells), { maxRecords: 8 })
  for (let n = 1; n <= 4; n++) await record(() => setCells(n))
  const kept = recorder.summaries(0)
  expect(kept.map((commit) => commit.renders)).toEqual([4, 4])
  expect(recorder.rendered(1)).toBeUndefined()
  expect(recorder.dropped()).toBe(true)
  expect(recorder.oldest()).toBe(kept[0]?.seq)
})

test("the newest commit is kept whole even over the budget", async () => {
  const { record, recorder } = await mount(h(Cells), { maxRecords: 2 })
  await record(() => setCells(1))
  await record(() => setCells(2))
  const kept = recorder.summaries(0)
  expect(kept).toHaveLength(1)
  expect(recorder.rendered(kept[0]?.seq ?? 0)).toHaveLength(4)
})

let setStyle: (n: number) => void = () => {}
const Styled = React.memo(function Styled(_: Record<string, unknown>) {
  return null
})
function StyleParent() {
  const [n, set] = React.useState(1)
  setStyle = set
  return h(Styled, {
    style: { color: "red" },
    list: [1, [2]],
    data: { n },
    onPick: () => {},
    handler: n === 1 ? () => {} : 1,
    big: Array.from({ length: 1001 }, () => 0),
    small: Array.from({ length: 999 }, () => 0),
  })
}
const changeOf = (
  recorder: ReturnType<typeof createRecorder>,
  id: number,
  key: string,
) => recorder.latest(id)?.props?.find((change) => change.key === key)

test("a prop that's a new object or array equal to the old is a new reference", async () => {
  const { record, kinds, recorder, id } = await mount(h(StyleParent))
  await record(() => setStyle(2))
  expect(kinds("Styled")).toEqual(["props"])
  expect(changeOf(recorder, id("Styled"), "style")?.reference).toBe(
    "same-value",
  )
  expect(changeOf(recorder, id("Styled"), "list")?.reference).toBe("same-value")
  expect(changeOf(recorder, id("Styled"), "data")).not.toHaveProperty(
    "reference",
  )
})

test("a prop that's a different function is a new function", async () => {
  const { record, recorder, id } = await mount(h(StyleParent))
  await record(() => setStyle(2))
  expect(changeOf(recorder, id("Styled"), "onPick")?.reference).toBe(
    "new-function",
  )
  expect(changeOf(recorder, id("Styled"), "style")?.reference).toBe(
    "same-value",
  )
  expect(changeOf(recorder, id("Styled"), "handler")).not.toHaveProperty(
    "reference",
  )
})

test("a new reference past 1,000 values counts as changed", async () => {
  const { record, recorder, id } = await mount(h(StyleParent))
  await record(() => setStyle(2))
  expect(changeOf(recorder, id("Styled"), "big")).not.toHaveProperty(
    "reference",
  )
  expect(changeOf(recorder, id("Styled"), "small")?.reference).toBe(
    "same-value",
  )
})

let setB: (b: number) => void = () => {}
const noop = () => {}
function Effects() {
  const [a] = React.useState(1)
  const [b, set] = React.useState(1)
  setB = set
  React.useEffect(noop, [a, b])
  React.useEffect(noop, [a])
  React.useEffect(noop)
  return null
}

test("a re-render records the effects it ran, with the deps that changed", async () => {
  const { record, recorder, id } = await mount(h(Effects))
  await record(() => setB(2))
  const effects = recorder.latest(id("Effects"))?.effects
  expect(effects).toContainEqual({
    index: 2,
    changed: [{ dep: 1, old: 1, new: 2 }],
  })
  // [a] didn't change: it doesn't run.
  expect(effects?.map((run) => run.index)).not.toContain(3)
})

test("an effect with no deps array runs on every render, with nothing changed", async () => {
  const { record, recorder, id } = await mount(h(Effects))
  await record(() => setB(2))
  const effects = recorder.latest(id("Effects"))?.effects
  expect(effects).toContainEqual({ index: 4 })
  expect(effects?.find((run) => run.index === 4)).not.toHaveProperty("changed")
})

let setLayout: (a: number) => void = () => {}
function LayoutEffects() {
  const [a, set] = React.useState(1)
  setLayout = set
  React.useLayoutEffect(noop, [a])
  React.useInsertionEffect(noop, [a])
  return null
}

test("layout and insertion effects are listed like effects", async () => {
  const { record, recorder, id } = await mount(h(LayoutEffects))
  await record(() => setLayout(2))
  expect(recorder.latest(id("LayoutEffects"))?.effects).toEqual([
    { index: 1, changed: [{ dep: 0, old: 1, new: 2 }] },
    { index: 2, changed: [{ dep: 0, old: 1, new: 2 }] },
  ])
})

let setKey: (k: string) => void = () => {}
function Item() {
  return null
}
function KeyParent() {
  const [k, set] = React.useState("a")
  setKey = set
  return h(Item, { key: k })
}

test("a key change remounts the keyed child", async () => {
  const { record, kinds, recorder, id } = await mount(h(KeyParent))
  await record(() => setKey("b"))
  expect(kinds("Item")).toEqual(["mount"])
  expect(recorder.latest(id("Item"))?.remount).toEqual({
    cause: "key",
    from: "a",
    to: "b",
  })
})

let setWrap: (on: boolean) => void = () => {}
function Inner() {
  return null
}
function Wrapper() {
  const [on, set] = React.useState(false)
  setWrap = set
  return on ? h("section", null, h(Inner)) : h("div", null, h(Inner))
}

test("an ancestor's type change remounts the components inside it", async () => {
  const { record, recorder, id } = await mount(h(Wrapper))
  await record(() => setWrap(true))
  expect(recorder.latest(id("Inner"))?.remount).toEqual({
    cause: "ancestor",
    ancestor: id("section"),
  })
})

let setShown: (on: boolean) => void = () => {}
function Toggle() {
  const [on, set] = React.useState(true)
  setShown = set
  return on ? h(Item) : null
}
let setList: (keys: string[]) => void = () => {}
function List() {
  const [keys, set] = React.useState(["a"])
  setList = set
  return keys.map((key) => h(Item, { key }))
}

test("a mount in a later commit, or a moved sibling, isn't a remount", async () => {
  const toggled = await mount(h(Toggle))
  await toggled.record(() => setShown(false))
  await toggled.record(() => setShown(true))
  expect(toggled.kinds("Item")).toEqual(["mount"])
  expect(toggled.recorder.latest(toggled.id("Item"))).not.toHaveProperty(
    "remount",
  )
  const listed = await mount(h(List))
  const first = listed.id("Item")
  await listed.record(() => setList(["b", "a"]))
  const added = listed.id("Item")
  expect(added).not.toBe(first)
  expect(listed.recorder.latest(added)).not.toHaveProperty("remount")
  expect(listed.kinds("Item")).toEqual(["mount"])
})

let setCounting: (n: number) => void = () => {}
function Counting() {
  const [n, set] = React.useState(3)
  setCounting = set
  return n
}
let setTwinA: (n: number) => void = () => {}
let setTwinB: (n: number) => void = () => {}
function TwinA() {
  const [n, set] = React.useState(0)
  setTwinA = set
  return n
}
function TwinB() {
  const [n, set] = React.useState(0)
  setTwinB = set
  return n
}

test("a commit lists its updaters with the state they changed", async () => {
  const { record, recorder, id, root } = await mount(
    h(React.Fragment, null, h(Counting), h(TwinA), h(TwinB)),
  )
  await record(() => setCounting(4))
  const counted = recorder.latest(id("Counting"))?.seq ?? 0
  expect(recorder.updatersOf(counted)).toEqual([
    { id: id("Counting"), hooks: [{ index: 0, old: 3, new: 4 }] },
  ])
  // One event, two updates: both are updaters of the one commit.
  await record(() => {
    setTwinA(1)
    setTwinB(2)
  })
  const twins = recorder.latest(id("TwinA"))?.seq ?? 0
  expect(recorder.latest(id("TwinB"))?.seq).toBe(twins)
  expect(recorder.updatersOf(twins)).toEqual([
    { id: id("TwinA"), hooks: [{ index: 0, old: 0, new: 1 }] },
    { id: id("TwinB"), hooks: [{ index: 0, old: 0, new: 2 }] },
  ])
  // A root render: React lists the root, which isn't a component.
  await record(() => root.render(h(React.Fragment, null, h(Counting))))
  const rendered = recorder.latest(id("Counting"))?.seq ?? 0
  expect(rendered).toBeGreaterThan(twins)
  expect(recorder.updatersOf(rendered)).toEqual([])
  expect(recorder.updatersOf(9999)).toEqual([])
})

test("history lists a node's records in the buffer, oldest first", async () => {
  const { record, recorder, id } = await mount(h(StatefulParent))
  for (const n of [1, 2, 3]) await record(() => setStateful(n))
  const stateful = id("Stateful")
  const seqs = recorder.history(stateful)
  expect(seqs).toHaveLength(3)
  expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
  expect(seqs.at(-1)).toBe(recorder.latest(stateful)?.seq)
  expect(recorder.record(stateful, seqs[0] ?? 0)?.hooks).toEqual([
    { index: 1, old: 0, new: 1 },
  ])
})

test("a component's latest render outlives its commit; older ones drop", async () => {
  const { record, recorder, id } = await mount(h(Parent), { maxCommits: 5 })
  await record(() => setParent(1))
  const late = id("Late")
  const mounted = recorder.latest(late)
  for (let i = 1; i <= 6; i++) await record(() => setParent(1 + 2 * i))
  expect(recorder.rendered(1)).toBeUndefined()
  expect(recorder.latest(late)?.seq).toBe(1)
  expect(recorder.record(late, 1)).toBe(mounted)
  expect(recorder.history(late)).toEqual([1])
  const child = id("Child")
  expect(recorder.history(child)).toHaveLength(5)
  expect(recorder.history(child).at(-1)).toBe(recorder.latest(child)?.seq)
  expect(recorder.record(child, 2)).toBeUndefined()
})

test("an unmount releases a component's kept render", async () => {
  const { record, recorder, id } = await mount(h(Parent), { maxCommits: 2 })
  await record(() => setParent(1))
  const late = id("Late")
  await record(() => setParent(3))
  await record(() => setParent(4))
  expect(recorder.latest(late)).toBeUndefined()
  expect(recorder.history(late)).toEqual([])
  expect(recorder.latest(id("Child"))).toBeDefined()
})

function Nested() {
  return null
}
function Wrap() {
  return h(Nested)
}
let setWrapped: (on: boolean) => void = () => {}
function Wrapped() {
  const [on, set] = React.useState(true)
  setWrapped = set
  return on && h(Wrap)
}

test("an unmount releases the kept renders of everything under it", async () => {
  const { record, recorder, id } = await mount(h(Wrapped))
  await record(() => setWrapped(false))
  await record(() => setWrapped(true))
  const nested = id("Nested")
  expect(recorder.latest(nested)?.kinds).toEqual(["mount"])
  await record(() => setWrapped(false))
  expect(recorder.latest(nested)).toBeUndefined()
})

test("history lists a component's last 100 renders", async () => {
  const { record, recorder, id } = await mount(h(Parent), { maxCommits: 200 })
  for (let i = 1; i <= 150; i++) await record(() => setParent(2 * i))
  const child = id("Child")
  expect(recorder.history(child)).toHaveLength(100)
  expect(recorder.history(child).at(-1)).toBe(recorder.latest(child)?.seq)
})

test("commits are summarized in clock time, with what each rendered and why", async () => {
  const { record, recorder, id } = await mount(h(Counting))
  await record(() => setCounting(4))
  const summary = recorder.summaries(0).at(-1)
  expect(summary).toMatchObject({
    rootId: 1,
    updaters: [id("Counting")],
    renders: 1,
  })
  expect(Math.abs((summary?.time ?? 0) - Date.now())).toBeLessThan(1000)
  const seq = summary?.seq ?? 0
  expect(recorder.summaries(seq)).toEqual([])
  expect(recorder.rendered(seq)).toEqual([
    { id: id("Counting"), kinds: ["state"] },
  ])
  expect(recorder.rendered(9999)).toBeUndefined()
})

function BenchCell(_: { index: number }) {
  return null
}
const benchCells = [0, 1, 2].map((index) => h(BenchCell, { key: index, index }))
let setBenchExtra: (on: boolean) => void = () => {}
function BenchExtra() {
  return null
}
function BenchParent() {
  const [extra, set] = React.useState(false)
  setBenchExtra = set
  return h(React.Fragment, null, extra && h(BenchExtra), benchCells)
}

// A constant children array is a Fragment React bails out of without cloning
// its children: the parent's new Fragment holds the same fibers, which keep no
// alternate and their mount's flags.
test("children under a wrapper that bailed out aren't recorded", async () => {
  const { record, recorder, id } = await mount(h(BenchParent))
  await record(() => setBenchExtra(true))
  expect(recorder.latest(id("BenchCell"))).toBeUndefined()
  expect(recorder.summaries(0).at(-1)?.renders).toBe(2)
})
