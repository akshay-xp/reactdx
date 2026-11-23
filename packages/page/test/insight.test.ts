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
async function mount(node: React.ReactNode) {
  const container = document.createElement("div")
  const root = createRoot(container)
  roots.push(root)
  await React.act(() => root.render(node))
  const fiberRoot = fiberRootOf(container)
  const tree = createTree()
  const ops: TreeOp[] = []
  tree.full(fiberRoot, 1, ops)
  const recorder = createRecorder()
  const ids = new Map<string, number>()
  const learn = (list: TreeOp[]) => {
    for (const op of list) if (op.op === "add") ids.set(op.name, op.id)
  }
  learn(ops)
  // React clears the updaters once onCommitFiberRoot returns: kept from there.
  let updaters = new Set<unknown>()
  hookRecord().listeners.add((_, root) => {
    if (root === fiberRoot)
      updaters = new Set(
        (root as unknown as { memoizedUpdaters?: Set<unknown> })
          .memoizedUpdaters,
      )
  })
  // Runs `update` in act, then records the commit it made.
  const record = async (update: () => void) => {
    await React.act(() => {
      update()
    })
    const added: TreeOp[] = []
    recorder.commit(1, updaters, (visit) =>
      tree.commit(fiberRoot, 1, added, visit),
    )
    learn(added)
  }
  const id = (name: string) => {
    const found = ids.get(name)
    if (found === undefined) throw new Error(`no ${name}`)
    return found
  }
  const kinds = (name: string) => recorder.latest(id(name))?.kinds
  return { recorder, record, id, kinds, tree }
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

test("records are kept for the last 100 commits, and clear drops them", async () => {
  const { record, recorder, id } = await mount(h(Parent))
  await record(() => setParent(1))
  const late = id("Late")
  // Odd counts keep Late mounted without rendering it again.
  for (let i = 1; i < 100; i++) await record(() => setParent(1 + 2 * i))
  expect(recorder.latest(late)?.seq).toBe(1)
  await record(() => setParent(201))
  expect(recorder.latest(late)).toBeUndefined()
  expect(recorder.latest(id("Child"))).toBeDefined()
  recorder.clear()
  expect(recorder.latest(id("Child"))).toBeUndefined()
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
  return null
}

test("a re-render records the effects it ran, with the deps that changed", async () => {
  const { record, recorder, id } = await mount(h(Effects))
  await record(() => setB(2))
  expect(recorder.latest(id("Effects"))?.effects).toEqual([
    { index: 2, changed: [{ dep: 1, old: 1, new: 2 }] },
  ])
})
