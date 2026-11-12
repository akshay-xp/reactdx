import {
  type HookValue,
  type InspectedMessage,
  type TreeBatchMessage,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { lineOf } from "./marker.ts"
import { windowLike } from "./window.ts"

const h = React.createElement
const posted: unknown[] = []
let root: Root
let mount: (element: React.ReactNode) => Promise<void>
// Loaded after the hook, like react-dom/client: React registers as it loads.
let ReactDOM: { useFormStatus?: () => unknown }

// One hook and one agent per file: react-dom registers once per module load.
beforeAll(async () => {
  installHook(windowLike())
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import("react-dom/client")
  ReactDOM = await import("react-dom")
  startAgent(globalThis, (message) => posted.push(message))
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  mount = async (element) => {
    await React.act(() => root.render(element))
  }
})
afterAll(() => React.act(() => root.unmount()))
beforeEach(() => {
  posted.length = 0
})

const send = (data: unknown) =>
  globalThis.dispatchEvent(new MessageEvent("message", { data }))
// Past the agent's 100 ms flush.
const flushed = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 150)))

const idOf = (name: string) => {
  for (const message of posted) {
    if ((message as { type?: string }).type !== "tree") continue
    const add = (message as TreeBatchMessage).ops.find(
      (op) => op.op === "add" && op.name === name,
    )
    if (add) return (add as { id: number }).id
  }
  throw new Error(`no ${name}`)
}

// Mounts, watches, inspects the named component; returns its last inspection.
async function inspect(element: React.ReactNode, name: string) {
  await mount(element)
  posted.length = 0
  send(WATCH)
  send({ source: "reactdx-relay", type: "inspect", id: idOf(name) })
  return last()
}
const lastRaw = () =>
  posted
    .filter(
      (m): m is InspectedMessage =>
        (m as { type?: string }).type === "inspected",
    )
    .at(-1)?.data
// Call sites are tested on their own; the rest compares hooks without them.
const unsited = (hooks: HookValue[]): HookValue[] =>
  hooks.map(({ site: _, hooks: inner, ...hook }) =>
    inner ? { ...hook, hooks: unsited(inner) } : hook,
  )
const last = () => {
  const data = lastRaw()
  return data?.hooks ? { ...data, hooks: unsited(data.hooks) } : data
}

const names = (hooks: HookValue[] = []) => hooks.map((hook) => hook.name)

const Theme = React.createContext("light")
Theme.displayName = "Theme"
const store = { subscribe: () => () => {}, get: () => "s" }

function Builtins() {
  const [first] = React.useState(1)
  React.useReducer((s: string) => s, "r")
  const ref = React.useRef({ a: 1 })
  React.useMemo(() => 3, [])
  React.useCallback(() => {}, [])
  React.useEffect(() => {}, [1])
  React.useLayoutEffect(() => {})
  React.useInsertionEffect(() => {}, [])
  React.useImperativeHandle(ref, () => ({ a: 1 }), [])
  React.useDeferredValue("d")
  React.useTransition()
  React.useSyncExternalStore(store.subscribe, store.get)
  React.useId()
  React.useContext(Theme)
  React.useDebugValue("dbg")
  return h("i", null, first)
}

test("built-in hooks in call order, with their values", async () => {
  const data = await inspect(
    h(Theme.Provider, { value: "dark" }, h(Builtins)),
    "Builtins",
  )
  const hooks = data?.hooks ?? []
  expect(names(hooks)).toEqual([
    "State",
    "Reducer",
    "Ref",
    "Memo",
    "Callback",
    "Effect",
    "LayoutEffect",
    "InsertionEffect",
    "ImperativeHandle",
    "DeferredValue",
    "Transition",
    "SyncExternalStore",
    "Id",
    "Context(Theme)",
    "DebugValue",
  ])
  const value = (name: string) => hooks.find((hook) => hook.name === name)
  expect(value("State")?.value).toBe(1)
  expect(value("Reducer")?.value).toBe("r")
  expect(value("Ref")?.value).toMatchObject({ props: { a: 1 } })
  expect(value("Memo")?.value).toBe(3)
  expect(value("Callback")?.value).toMatchObject({ type: "function" })
  expect(value("Effect")?.value).toMatchObject({ type: "array", items: [1] })
  expect(value("LayoutEffect")).toEqual({ name: "LayoutEffect" })
  expect(value("InsertionEffect")?.value).toMatchObject({ items: [] })
  expect(value("DeferredValue")?.value).toBe("d")
  expect(value("Transition")?.value).toBe(false)
  expect(value("SyncExternalStore")?.value).toBe("s")
  expect(typeof value("Id")?.value).toBe("string")
  expect(value("Context(Theme)")?.value).toBe("dark")
  expect(value("DebugValue")?.value).toBe("dbg")
})

// Taken in an effect: the shadow render's setters are stubs.
let setCount = (_: number) => {}
function Count() {
  const [count, set] = React.useState(1)
  React.useEffect(() => {
    setCount = set
  })
  return h("b", null, count)
}

test("a commit sends the new values", async () => {
  await inspect(h(Count), "Count")
  await React.act(() => setCount(7))
  await flushed()
  expect(last()?.hooks?.[0]).toEqual({ name: "State", value: 7 })
})

function useCount() {
  return React.useState(2)
}
function useCart() {
  useCount()
  React.useDebugValue("2 items")
}
function useLabel() {
  React.useDebugValue(3, (n: number) => `${n} items`)
}
function Shop() {
  useCart()
  useCount()
  React.useState(0)
  return null
}
function Twice() {
  useCount()
  useCount()
  useLabel()
  return null
}

test("custom hooks are groups of the hooks they call", async () => {
  const data = await inspect(h(Shop), "Shop")
  expect(data?.hooks).toEqual([
    {
      name: "useCart",
      value: "2 items",
      hooks: [{ name: "useCount", hooks: [{ name: "State", value: 2 }] }],
    },
    { name: "useCount", hooks: [{ name: "State", value: 2 }] },
    { name: "State", value: 0 },
  ])
})

test("each call of a custom hook is its own group; formatters apply", async () => {
  const data = await inspect(h(Twice), "Twice")
  expect(data?.hooks).toEqual([
    { name: "useCount", hooks: [{ name: "State", value: 2 }] },
    { name: "useCount", hooks: [{ name: "State", value: 2 }] },
    { name: "useLabel", value: "3 items", hooks: [] },
  ])
})

const react19 = React.version.startsWith("19.")
const fulfilled = Object.assign(Promise.resolve(5), {
  status: "fulfilled",
  value: 5,
})

function Modern() {
  const R = React as unknown as Record<string, (...args: unknown[]) => unknown>
  R.use?.(Theme)
  R.use?.(fulfilled)
  R.useActionState?.((s: unknown) => s, "a")
  R.useOptimistic?.("o")
  ReactDOM.useFormStatus?.()
  R.useEffectEvent?.(() => {})
  React.useState("last")
  return null
}

test.skipIf(!react19)("React 19 hooks", async () => {
  const data = await inspect(
    h(Theme.Provider, { value: "dark" }, h(Modern)),
    "Modern",
  )
  expect(data?.hooksError).toBeUndefined()
  const hooks = data?.hooks ?? []
  expect(names(hooks)).toEqual([
    "Context(Theme)",
    "Use",
    "ActionState",
    "Optimistic",
    "FormStatus",
    "EffectEvent",
    "State",
  ])
  expect(hooks.map((hook) => hook.value)).toEqual([
    "dark",
    5,
    "a",
    "o",
    expect.objectContaining({
      props: expect.objectContaining({ pending: false }),
    }),
    expect.objectContaining({ type: "function" }),
    "last",
  ])
})

let effects = 0
let shadowSetter = (_: number) => {}
let inShadow = false
function Effectful() {
  const [n, set] = React.useState(0)
  if (inShadow) shadowSetter = set
  console.log("rendering Effectful")
  React.useEffect(() => {
    effects++
  })
  return h("u", null, n)
}

const snapshots = () =>
  posted.filter((m) => (m as { type?: string }).type === "snapshot").length
// Inspects again what's mounted, with `flag` on only for the shadow render.
const reinspect = (name: string, flag: (on: boolean) => void) => {
  flag(true)
  try {
    send({ source: "reactdx-relay", type: "inspect", id: idOf(name) })
  } finally {
    flag(false)
  }
  return last()
}

test("inspecting runs no effects, commits nothing and logs nothing", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  try {
    await inspect(h(Effectful), "Effectful")
    await flushed()
    const [calls, ran, commits] = [log.mock.calls.length, effects, snapshots()]
    const data = reinspect("Effectful", (on) => {
      inShadow = on
    })
    expect(names(data?.hooks)).toEqual(["State", "Effect"])
    expect(log.mock.calls.length).toBe(calls)
    shadowSetter(5)
    await flushed()
    expect(effects).toBe(ran)
    expect(snapshots()).toBe(commits)
  } finally {
    log.mockRestore()
  }
})

let explode = false
function Fragile(_: { label: string }) {
  if (explode) throw new Error("boom")
  React.useState(1)
  return null
}

test("a component that throws in the shadow render keeps its props", async () => {
  await inspect(h(Fragile, { label: "x" }), "Fragile")
  const data = reinspect("Fragile", (on) => {
    explode = on
  })
  expect(data?.hooksError).toBe("Error: boom")
  expect(data?.hooks).toEqual([])
  expect(data?.props).toMatchObject({ props: { label: "x" } })
})

let suspend = false
const pending = new Promise(() => {})
function Waiting() {
  React.useState("before")
  const R = React as unknown as { use: (v: unknown) => unknown }
  R.use(fulfilled)
  // Past the thenables React recorded, so the stub sees this one as passed.
  if (suspend) R.use(pending)
  React.useState("after")
  return null
}

test.skipIf(!react19)(
  "a suspending use() keeps the hooks before it",
  async () => {
    await inspect(h(Waiting), "Waiting")
    const data = reinspect("Waiting", (on) => {
      suspend = on
    })
    expect(data?.hooksError).toBeUndefined()
    expect(data?.hooks).toEqual([
      { name: "State", value: "before" },
      { name: "Use", value: 5 },
    ])
  },
)

const Fwd = React.forwardRef(function Fwd(_, __) {
  React.useState("f")
  return null
})
const Memo = React.memo(function Memo() {
  React.useState("m")
  return null
})
class Klass extends React.Component {
  render() {
    return null
  }
}

test("forwardRef and memo components have hooks; classes have none", async () => {
  expect((await inspect(h(Fwd), "Fwd"))?.hooks).toEqual([
    { name: "State", value: "f" },
  ])
  expect((await inspect(h(Memo), "Memo"))?.hooks).toEqual([
    { name: "State", value: "m" },
  ])
  expect((await inspect(h(Klass), "Klass"))?.hooks).toBeUndefined()
})

const marks: Record<string, Error> = {}
function useSited() {
  const [value, here] = [React.useState(2), new Error()]
  marks.inner = here
  return value
}
function Sited() {
  const [, here] = [React.useState(1), new Error()]
  marks.state = here
  const [, there] = [useSited(), new Error()]
  marks.custom = there
  return null
}

test("each hook and custom hook carries where it was called", async () => {
  await inspect(h(Sited), "Sited")
  const [state, custom] = lastRaw()?.hooks ?? []
  expect(state?.site).toEqual({
    ...lineOf(marks.state),
    column: expect.any(Number),
  })
  expect(custom?.site).toEqual({
    ...lineOf(marks.custom),
    column: expect.any(Number),
  })
  expect(custom?.hooks?.[0]?.site).toEqual({
    ...lineOf(marks.inner),
    column: expect.any(Number),
  })
})
