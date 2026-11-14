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
