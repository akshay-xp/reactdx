import {
  type ExpandedMessage,
  type InspectedMessage,
  type TreeBatchMessage,
  UNWATCH,
  valueStored,
  valueText,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { windowLike } from "./window.ts"

const h = React.createElement
const posted: unknown[] = []
let root: Root

function Greeting(props: { name: string }) {
  return h("span", null, props.name)
}
let clock: Clock
class Clock extends React.Component {
  state = { ticks: 2 }
  componentDidMount() {
    clock = this
  }
  render() {
    return null
  }
}

let setOther = (_: number) => {}
function Other() {
  const [value, set] = React.useState(0)
  setOther = set
  return h("i", null, value)
}
function Deep(_: { data: unknown }) {
  return null
}
type User = { name: string; address: { city: string; zip: string } }
const Child = React.memo(function Child(props: { user: User }) {
  return h("em", null, `${props.user.address.city} ${props.user.address.zip}`)
})
class Point {
  constructor(public x: number) {}
}
function Nested(props: {
  user: User
  items: number[]
  tags: Map<string, number>
  point: Point
}) {
  const [form] = React.useState({ name: "a", age: 1 })
  return [
    h(Child, { key: "c", user: props.user }),
    h("s", { key: "s" }, `${form.name} ${form.age}`),
  ]
}
function Reducing() {
  const [state] = React.useReducer((s: { count: number; label: string }) => s, {
    count: 1,
    label: "x",
  })
  return h("del", null, state.count)
}
function Refs() {
  React.useRef(1)
  const [count] = React.useState(2)
  return h("u", null, count)
}

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
  await React.act(() =>
    root.render([
      h(Greeting, { key: "g", name: "Ada" }),
      h(Clock, { key: "c" }),
      h(Other, { key: "o" }),
      h(Deep, { key: "d", data: { a: { b: { c: 1 } } } }),
      h(Refs, { key: "r" }),
      h(Reducing, { key: "red" }),
      h(Nested, {
        key: "n",
        user: { name: "Ada", address: { city: "Paris", zip: "75" } },
        items: [1, 2, 3],
        tags: new Map([["k", 1]]),
        point: new Point(1),
      }),
    ]),
  )
})
afterAll(() => React.act(() => root.unmount()))
beforeEach(() => {
  posted.length = 0
  send(WATCH)
})

// Past the agent's 100 ms flush.
const flushed = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 150)))
const send = (data: unknown) =>
  globalThis.dispatchEvent(new MessageEvent("message", { data }))
const inspect = (id: unknown) =>
  send({ source: "reactdx-relay", type: "inspect", id })

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
const replies = () =>
  posted.filter(
    (m): m is InspectedMessage => (m as { type?: string }).type === "inspected",
  )

test("inspect posts a function component's props", () => {
  const id = idOf("Greeting")
  inspect(id)
  const [reply] = replies()
  expect(reply?.id).toBe(id)
  expect(reply?.data?.props).toMatchObject({
    type: "object",
    props: { name: "Ada" },
  })
  expect(reply?.data?.state).toBeUndefined()
})

test("inspect posts a class component's state", () => {
  inspect(idOf("Clock"))
  expect(replies()[0]?.data?.state).toMatchObject({ props: { ticks: 2 } })
})

test("an unknown id gets null; a malformed inspect gets nothing", () => {
  inspect(9999)
  expect(replies()).toEqual([
    { source: "reactdx", type: "inspected", id: 9999, data: null },
  ])
  inspect("x")
  expect(replies()).toHaveLength(1)
})

test("a commit that renders the inspected node sends it again on the flush", async () => {
  inspect(idOf("Clock"))
  await React.act(() => clock.setState({ ticks: 3 }))
  await flushed()
  const sent = replies()
  expect(sent).toHaveLength(2)
  expect(sent[1]?.data?.state).toMatchObject({ props: { ticks: 3 } })
})

test("commits elsewhere send nothing", async () => {
  inspect(idOf("Clock"))
  await React.act(() => setOther(Math.random()))
  await flushed()
  expect(replies()).toHaveLength(1)
})

test("inspect null and unwatch stop the re-sends", async () => {
  inspect(idOf("Clock"))
  inspect(null)
  await React.act(() => clock.setState({ ticks: 4 }))
  await flushed()
  expect(replies()).toHaveLength(1)
  inspect(idOf("Clock"))
  send(UNWATCH)
  send(WATCH)
  await React.act(() => clock.setState({ ticks: 5 }))
  await flushed()
  expect(replies()).toHaveLength(2)
})

const expand = (objectId: number, offset = 0) =>
  send({ source: "reactdx-relay", type: "expand", objectId, offset })
const expansions = () =>
  posted.filter(
    (m): m is ExpandedMessage => (m as { type?: string }).type === "expanded",
  )

test("expand sends a page of an object the inspection described", () => {
  inspect(idOf("Deep"))
  const reply = replies()[0] as unknown as {
    data: { props: { props: { data: { props: { a: { id: number } } } } } }
  }
  const ref = reply.data.props.props.data.props.a
  expand(ref.id)
  expect(expansions()).toEqual([
    {
      source: "reactdx",
      type: "expanded",
      objectId: ref.id,
      offset: 0,
      value: expect.objectContaining({
        type: "object",
        props: { b: expect.objectContaining({ props: { c: 1 } }) },
      }),
    },
  ])
  inspect(idOf("Clock"))
  expand(ref.id)
  expect(expansions()).toHaveLength(1)
})

const valueCommand = (type: "copy-value" | "store-value", target: unknown) =>
  send({ source: "reactdx-relay", type, target })
const texts = () =>
  posted.filter((m) => (m as { type?: string }).type === "value-text")
const propsId = () =>
  (replies()[0]?.data?.props as unknown as { id: number } | undefined)?.id

test("copy-value posts a prop's or a hook's value as text", () => {
  inspect(idOf("Greeting"))
  valueCommand("copy-value", { objectId: propsId(), key: "name" })
  valueCommand("copy-value", { objectId: propsId() })
  inspect(idOf("Other"))
  valueCommand("copy-value", { hook: [0] })
  // Earlier tests set Other's state to a random number.
  const state = replies()[1]?.data?.hooks?.[0]?.value
  expect(texts()).toEqual([
    valueText("Ada"),
    valueText('{\n  "name": "Ada"\n}'),
    valueText(String(state)),
  ])
})

test("a value command for nothing the inspection holds does nothing", () => {
  inspect(idOf("Greeting"))
  valueCommand("copy-value", { objectId: propsId(), key: "missing" })
  valueCommand("copy-value", { hook: [5] })
  valueCommand("copy-value", { context: 0 })
  valueCommand("store-value", { objectId: 999 })
  expect(texts()).toEqual([])
  expect("$reactdx1" in globalThis).toBe(false)
})

test("store-value keeps the value in the next free $reactdx<n> and logs it", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  const scope = globalThis as Record<string, unknown>
  try {
    inspect(idOf("Greeting"))
    valueCommand("store-value", { objectId: propsId(), key: "name" })
    valueCommand("store-value", { objectId: propsId() })
    expect(scope.$reactdx1).toBe("Ada")
    expect(scope.$reactdx2).toEqual({ name: "Ada" })
    expect(log.mock.calls).toEqual([
      ["$reactdx1", "Ada"],
      ["$reactdx2", { name: "Ada" }],
    ])
    // The panel says where each went.
    expect(
      posted.filter((m) => (m as { type?: string }).type === "value-stored"),
    ).toEqual([valueStored("$reactdx1"), valueStored("$reactdx2")])
  } finally {
    log.mockRestore()
    delete scope.$reactdx1
    delete scope.$reactdx2
  }
})

const edit = (fields: Record<string, unknown>) =>
  React.act(async () =>
    send({ source: "reactdx-relay", type: "edit", path: [], ...fields }),
  )
const text = (selector: string) => document.querySelector(selector)?.textContent

test("an edit of the inspected node's prop or state hook writes through React", async () => {
  const greeting = idOf("Greeting")
  inspect(greeting)
  await edit({ id: greeting, root: "props", path: ["name"], value: "Grace" })
  expect(text("span")).toBe("Grace")
  await flushed()
  expect(replies().at(-1)?.data?.props).toMatchObject({
    props: { name: "Grace" },
  })
  const other = idOf("Other")
  inspect(other)
  await edit({ id: other, root: { hook: [0] }, value: 9 })
  expect(text("i")).toBe("9")
})

test("an edit of another node, a hook that holds no state, or with nothing inspected does nothing", async () => {
  const refs = idOf("Refs")
  inspect(refs)
  const sent = replies().length
  await edit({ id: refs, root: { hook: [0] }, value: 5 })
  await edit({ id: idOf("Other"), root: { hook: [0] }, value: 3 })
  inspect(null)
  await edit({ id: refs, root: { hook: [1] }, value: 7 })
  await flushed()
  expect(text("u")).toBe("2")
  expect(text("i")).not.toBe("3")
  expect(replies()).toHaveLength(sent)
})

test("an edit's result is sent as soon as React commits it, before the flush", async () => {
  const other = idOf("Other")
  inspect(other)
  const sent = replies().length
  await edit({ id: other, root: { hook: [0] }, value: 11 })
  // Well before the 100 ms flush.
  await React.act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  expect(replies()).toHaveLength(sent + 1)
  expect(replies().at(-1)?.data?.hooks?.[0]?.value).toBe(11)
  // The flush finds nothing new to send.
  await flushed()
  expect(replies()).toHaveLength(sent + 1)
})

const settle = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 10)))
const lastProps = () =>
  (
    replies().at(-1)?.data?.props as unknown as
      | { props: Record<string, Record<string, unknown>> }
      | undefined
  )?.props ?? {}

test("edits reach any depth, copying the path, through plain objects and arrays only", async () => {
  const nested = idOf("Nested")
  inspect(nested)
  await edit({
    id: nested,
    root: "props",
    path: ["user", "address", "city"],
    value: "Lyon",
  })
  await settle()
  // The memo child re-rendered: its prop is a new object.
  expect(text("em")).toBe("Lyon 75")
  expect(lastProps().user).toMatchObject({ props: { name: "Ada" } })
  await edit({ id: nested, root: "props", path: ["items", 2], value: 9 })
  await settle()
  expect(lastProps().items).toMatchObject({ items: [1, 2, 9] })
  await edit({ id: nested, root: { hook: [0] }, path: ["name"], value: "b" })
  expect(text("s")).toBe("b 1")
  await settle()
  const sent = replies().length
  await edit({ id: nested, root: "props", path: ["tags", "k"], value: 2 })
  await edit({ id: nested, root: "props", path: ["point", "x"], value: 5 })
  await settle()
  expect(replies()).toHaveLength(sent)
  expect(lastProps().tags?.type).toBe("map")
  expect(lastProps().point?.className).toBe("Point")
})

test("class state and useReducer values edit and come back", async () => {
  const clock = idOf("Clock")
  inspect(clock)
  await edit({ id: clock, root: "state", path: ["ticks"], value: 9 })
  await settle()
  expect(replies().at(-1)?.data?.state).toMatchObject({ props: { ticks: 9 } })
  const reducing = idOf("Reducing")
  inspect(reducing)
  await edit({ id: reducing, root: { hook: [0] }, path: ["count"], value: 4 })
  await settle()
  expect(text("del")).toBe("4")
  expect(replies().at(-1)?.data?.hooks?.[0]?.value).toMatchObject({
    props: { count: 4, label: "x" },
  })
  // A function component has no class state.
  const sent = replies().length
  await edit({ id: reducing, root: "state", path: ["count"], value: 5 })
  await settle()
  expect(replies()).toHaveLength(sent)
})
