import {
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

function Greeting(props: { name: string }) {
  return h("span", null, props.name)
}
class Clock extends React.Component {
  state = { ticks: 2 }
  render() {
    return null
  }
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
    ]),
  )
})
afterAll(() => React.act(() => root.unmount()))
beforeEach(() => {
  posted.length = 0
  send(WATCH)
})

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
