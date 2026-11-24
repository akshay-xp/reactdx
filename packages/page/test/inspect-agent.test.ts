import {
  type CommitsMessage,
  type CommittedMessage,
  committed,
  type ExpandedMessage,
  type InspectedMessage,
  type ReasonedMessage,
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
// Taken in an effect: an inspection's shadow render gets stub setters.
let setReasoned = (_: number) => {}
function Reasoned() {
  const [value, set] = React.useState(0)
  React.useEffect(() => {
    setReasoned = set
  })
  return h("b", null, value)
}
const StyledChild = React.memo(function StyledChild(_: { style: object }) {
  return null
})
let setStyling = (_: number) => {}
function Styling() {
  const [n, set] = React.useState(0)
  React.useEffect(() => {
    setStyling = set
  })
  return h("p", null, n, h(StyledChild, { style: { color: "red" } }))
}
let setEffecting = (_: number) => {}
function Effecting() {
  const [n, set] = React.useState(0)
  React.useEffect(() => {
    setEffecting = set
  })
  React.useEffect(() => {}, [n])
  return h("dfn", null, n)
}
function Rekeyed() {
  return h("kbd")
}
let setRekey = (_: string) => {}
function Rekeying() {
  const [k, set] = React.useState("a")
  React.useEffect(() => {
    setRekey = set
  })
  return h(Rekeyed, { key: k })
}
function Triggered() {
  return h("abbr")
}
let setTriggering = (_: number) => {}
function useCount() {
  const [n, set] = React.useState(1)
  React.useEffect(() => {
    setTriggering = set
  })
  return n
}
// Hooks rows: State #1, Count #2 (the group), State #3, Effect #4.
function Triggering() {
  React.useState("x")
  const n = useCount()
  return h("q", null, n, h(Triggered))
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
function Counted() {
  const [count] = React.useState(5)
  return h("var", null, count)
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
      h(Reasoned, { key: "why" }),
      h(Styling, { key: "styling" }),
      h(Effecting, { key: "effecting" }),
      h(Rekeying, { key: "rekeying" }),
      h(Triggering, { key: "triggering" }),
      h(Deep, { key: "d", data: { a: { b: { c: 1 } } } }),
      h(Refs, { key: "r" }),
      h(Counted, { key: "k", label: "x" }),
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

const pathCommand = (fields: Record<string, unknown>) =>
  React.act(async () => send({ source: "reactdx-relay", ...fields }))

test("delete and rename write through React; adding is an edit at a new path", async () => {
  const nested = idOf("Nested")
  inspect(nested)
  const at = { id: nested, root: "props" }
  // Refused: renaming an array item or onto a key that's there, and anything
  // through the Map.
  const sent = replies().length
  await pathCommand({ type: "rename-path", ...at, path: ["items", 0], to: "x" })
  await pathCommand({
    type: "rename-path",
    ...at,
    path: ["user", "name"],
    to: "address",
  })
  await pathCommand({ type: "delete-path", ...at, path: ["tags", "k"] })
  await pathCommand({
    type: "rename-path",
    ...at,
    path: ["tags", "k"],
    to: "j",
  })
  await settle()
  expect(replies()).toHaveLength(sent)

  // Earlier tests may have edited these: start from what was sent.
  const items = (lastProps().items as { items: unknown[] }).items
  await pathCommand({ type: "delete-path", ...at, path: ["items", 0] })
  await settle()
  expect(lastProps().items).toMatchObject({ items: items.slice(1) })
  await pathCommand({ type: "delete-path", ...at, path: ["user", "name"] })
  await settle()
  expect(Object.keys(lastProps().user?.props as object)).toEqual(["address"])
  await pathCommand({
    type: "rename-path",
    ...at,
    path: ["user", "address", "city"],
    to: "town",
  })
  expect(text("em")).toBe("undefined 75")
  const hook = { id: nested, root: { hook: [0] } }
  await pathCommand({ type: "delete-path", ...hook, path: ["age"] })
  expect(text("s")).toMatch(/^\w+ undefined$/)
  await pathCommand({
    type: "rename-path",
    ...hook,
    path: ["name"],
    to: "title",
  })
  expect(text("s")).toBe("undefined undefined")
  // Adding: an edit at a path that isn't there yet.
  await edit({ ...at, path: ["user", "newKey"], value: "" })
  await edit({
    ...at,
    path: ["items", items.length - 1],
    value: { type: "undefined" },
  })
  await settle()
  expect(lastProps().user).toMatchObject({ props: { newKey: "" } })
  expect(lastProps().items).toMatchObject({ length: items.length })
})

test("class state: a key added, renamed and deleted (the state replaced)", async () => {
  const clock = idOf("Clock")
  inspect(clock)
  const at = { id: clock, root: "state" }
  const keys = () =>
    Object.keys(
      (
        replies().at(-1)?.data?.state as unknown as
          | { props: object }
          | undefined
      )?.props ?? {},
    )
  await edit({ ...at, path: ["extra"], value: 1 })
  await settle()
  expect(keys()).toEqual(["ticks", "extra"])
  await pathCommand({ type: "rename-path", ...at, path: ["extra"], to: "more" })
  await settle()
  expect(keys()).toEqual(["ticks", "more"])
  await pathCommand({ type: "delete-path", ...at, path: ["more"] })
  await settle()
  expect(keys()).toEqual(["ticks"])
})

test("rerender renders the inspected component once, nothing changed", async () => {
  const counted = idOf("Counted")
  inspect(counted)
  const before = replies().at(-1)?.data
  const commits = () => {
    send({ source: "reactdx-relay", type: "get-snapshot" })
    const snapshot = posted
      .filter((m) => (m as { type?: string }).type === "snapshot")
      .at(-1) as { roots: { commits: number }[] }
    return snapshot.roots[0]?.commits ?? 0
  }
  const committed = commits()
  const rerender = (id: number) =>
    React.act(async () =>
      send({ source: "reactdx-relay", type: "rerender", id }),
    )
  await rerender(counted)
  expect(commits()).toBe(committed + 1)
  await settle()
  const after = replies().at(-1)?.data
  expect(after?.props).toEqual(before?.props)
  expect(after?.hooks).toEqual(before?.hooks)
  // Not for another node, nor a DOM element.
  await rerender(idOf("Other"))
  await rerender(idOf("var"))
  expect(commits()).toBe(committed + 1)
})

test("an inspection carries why its node last rendered, while watched", async () => {
  const reasoned = idOf("Reasoned")
  inspect(reasoned)
  await React.act(() => setReasoned(1))
  await flushed()
  expect(replies().at(-1)?.data?.render).toMatchObject({
    kinds: ["state"],
    hooks: [{ hook: [0], old: 0, new: 1 }],
  })
})

test("renders before watch, or before an unwatch, aren't kept", async () => {
  const reasoned = idOf("Reasoned")
  send(UNWATCH)
  await React.act(() => setReasoned(10))
  send(WATCH)
  inspect(reasoned)
  expect(replies().at(-1)?.data?.render).toBeUndefined()
  await React.act(() => setReasoned(11))
  send(UNWATCH)
  send(WATCH)
  inspect(reasoned)
  expect(replies().at(-1)?.data?.render).toBeUndefined()
})

// A class keeps its state object and props through a forced render, so only
// the newer record says to send again.
test("a forced render re-sends the inspection with its reason", async () => {
  const id = idOf("Clock")
  inspect(id)
  await React.act(() => clock.setState({ ticks: 30 }))
  await flushed()
  const before = replies().at(-1)?.data?.render
  await React.act(async () =>
    send({ source: "reactdx-relay", type: "rerender", id }),
  )
  await flushed()
  const after = replies().at(-1)?.data?.render
  expect(after?.kinds).toEqual(["force"])
  expect(after?.seq).toBeGreaterThan(before?.seq ?? 0)
})

test("a prop change says when it's only a new reference", async () => {
  inspect(idOf("StyledChild"))
  await React.act(() => setStyling(1))
  await flushed()
  expect(replies().at(-1)?.data?.render?.props?.[0]).toMatchObject({
    key: "style",
    reference: "same-value",
  })
})

test("an inspection carries the effects its render ran, by call indexes", async () => {
  inspect(idOf("Effecting"))
  await React.act(() => setEffecting(1))
  await flushed()
  expect(replies().at(-1)?.data?.render?.effects).toContainEqual({
    hook: [2],
    changed: [{ dep: 0, old: 0, new: 1 }],
  })
})

test("an inspection says when its node remounted and why", async () => {
  await React.act(() => setRekey("b"))
  await flushed()
  const adds = posted
    .filter(
      (m): m is TreeBatchMessage => (m as { type?: string }).type === "tree",
    )
    .flatMap((batch) => batch.ops)
    .filter((op) => op.op === "add" && op.name === "Rekeyed")
  inspect((adds.at(-1) as { id: number }).id)
  expect(replies().at(-1)?.data?.render?.remount).toEqual({
    cause: "key",
    from: "a",
    to: "b",
  })
})

test("an inspection names what triggered its render, hooks labeled as in Hooks", async () => {
  const triggering = idOf("Triggering")
  inspect(idOf("Triggered"))
  await React.act(() => setTriggering(2))
  await flushed()
  const expected = [
    { id: triggering, hooks: [{ name: "State #3", old: 1, new: 2 }] },
  ]
  expect(replies().at(-1)?.data?.render?.updaters).toEqual(expected)
  inspect(triggering)
  expect(replies().at(-1)?.data?.render?.updaters).toEqual(expected)
  // The commit's reply labels them the same, whatever is selected.
  const seq = replies().at(-1)?.data?.render?.seq ?? 0
  inspect(null)
  posted.length = 0
  send({ source: "reactdx-relay", type: "commit", seq })
  const [reply] = posted as CommittedMessage[]
  expect(reply?.updaters).toEqual(expected)
  expect(reply?.renders).toContainEqual({ id: triggering, kinds: ["state"] })
})

test("an inspection lists the node's recorded renders, oldest first", async () => {
  const reasoned = idOf("Reasoned")
  inspect(reasoned)
  const before = replies().at(-1)?.data?.history?.length ?? 0
  for (const n of [21, 22, 23]) await React.act(() => setReasoned(n))
  await flushed()
  const { history = [], render } = replies().at(-1)?.data ?? {}
  expect(history).toHaveLength(before + 3)
  expect([...history].sort((a, b) => a - b)).toEqual(history)
  expect(history.at(-1)).toBe(render?.seq)
  inspect(idOf("Greeting"))
  expect(replies().at(-1)?.data).not.toHaveProperty("history")
})

const reasonedReplies = () =>
  posted.filter(
    (m): m is ReasonedMessage => (m as { type?: string }).type === "reasoned",
  )

test("reason loads an older render; one out of the buffer loads as null", async () => {
  const reasoned = idOf("Reasoned")
  inspect(reasoned)
  await React.act(() => setReasoned(0))
  for (const n of [1, 2, 3]) await React.act(() => setReasoned(n))
  await flushed()
  const history = replies().at(-1)?.data?.history ?? []
  const seq = history.at(-3) ?? 0
  send({ source: "reactdx-relay", type: "reason", id: reasoned, seq })
  expect(reasonedReplies().at(-1)).toMatchObject({
    id: reasoned,
    seq,
    render: { seq, kinds: ["state"], hooks: [{ hook: [0], old: 0, new: 1 }] },
  })
  send({ source: "reactdx-relay", type: "reason", id: idOf("Other"), seq })
  expect(reasonedReplies()).toHaveLength(1)
  for (let n = 1; n <= 1001; n++) await React.act(() => setEffecting(100 + n))
  send({ source: "reactdx-relay", type: "reason", id: reasoned, seq })
  expect(reasonedReplies().at(-1)).toMatchObject({ seq, render: null })
})

const commitLists = () =>
  posted
    .filter(
      (m): m is CommitsMessage => (m as { type?: string }).type === "commits",
    )
    .map((m) => m.commits)

test("the flush posts the commits recorded since the last, once each", async () => {
  const reasoned = idOf("Reasoned")
  // Past the setup watch's own list.
  posted.length = 0
  await React.act(() => setReasoned(41))
  await flushed()
  await React.act(() => setReasoned(42))
  await flushed()
  const lists = commitLists()
  expect(lists).toHaveLength(2)
  const seqs = lists.flat().map((commit) => commit.seq)
  expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
  expect(new Set(seqs).size).toBe(seqs.length)
  expect(lists[1]?.at(-1)).toMatchObject({ updaters: [reasoned], renders: 1 })
  // A new watch starts the panel's list over: the buffer is sent again at once,
  // after the tree (this test's two commits at least; the oldest may have
  // dropped since).
  posted.length = 0
  send(WATCH)
  const types = posted.map((m) => (m as { type?: string }).type)
  expect(types.indexOf("commits")).toBeGreaterThan(types.indexOf("tree"))
  expect(
    commitLists()
      .flat()
      .map((commit) => commit.seq),
  ).toEqual(expect.arrayContaining(seqs.slice(-2)))
  // Then only what's new.
  posted.length = 0
  await React.act(() => setReasoned(43))
  await flushed()
  expect(commitLists().flat()).toHaveLength(1)
})

function Cell() {
  return null
}
let setMany = (_: number) => {}
function Many() {
  const [n, set] = React.useState(0)
  React.useEffect(() => {
    setMany = set
  })
  return Array.from({ length: 2001 }, (_, i) => h(Cell, { key: i, n }))
}

test("commit sends a commit's renders in batches of 2,000, triggers first", async () => {
  const { createRoot } = await import("react-dom/client")
  const other = createRoot(document.createElement("div"))
  await React.act(() => other.render(h(Many)))
  try {
    await React.act(() => setMany(1))
    await flushed()
    const last = commitLists().flat().at(-1)
    const seq = last?.seq ?? 0
    posted.length = 0
    send({ source: "reactdx-relay", type: "commit", seq })
    const replies = posted.filter(
      (m): m is CommittedMessage =>
        (m as { type?: string }).type === "committed",
    )
    expect(replies.map((m) => m.renders?.length)).toEqual([2000, 2])
    expect(
      new Set(replies.flatMap((m) => m.renders ?? []).map((r) => r.id)).size,
    ).toBe(2002)
    // Many's own update: it triggered, and only the first batch says so.
    expect(replies[0]?.updaters?.map((u) => u.id)).toEqual(last?.updaters)
    expect(last?.updaters).toHaveLength(1)
    expect(replies[1]).not.toHaveProperty("updaters")
    posted.length = 0
    send({ source: "reactdx-relay", type: "commit", seq: 9999 })
    expect(posted).toEqual([committed(9999, null)])
  } finally {
    await React.act(() => other.unmount())
  }
})
