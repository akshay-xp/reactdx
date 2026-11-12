import {
  type HookValue,
  type InspectedMessage,
  type TreeBatchMessage,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { windowLike } from "./window.ts"

const h = React.createElement
const posted: unknown[] = []
let root: Root
let mount: (element: React.ReactNode) => Promise<void>

// One hook and one agent per file: react-dom registers once per module load.
beforeAll(async () => {
  installHook(windowLike())
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import("react-dom/client")
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
const last = () =>
  posted
    .filter(
      (m): m is InspectedMessage =>
        (m as { type?: string }).type === "inspected",
    )
    .at(-1)?.data

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
