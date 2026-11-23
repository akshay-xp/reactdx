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
  return { recorder, record, id, kinds, fiberRoot }
}

let setParent: (n: number) => void = () => {}
function Child() {
  return h("div")
}
const Still = React.memo(function Still() {
  return h("div")
})
function Late() {
  return null
}
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
