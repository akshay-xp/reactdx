import {
  CLEAR_HIGHLIGHT,
  highlight,
  PICK_START,
  picked,
  type TreeBatchMessage,
  UNWATCH,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterAll, beforeAll, expect, test } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { windowLike } from "./window.ts"

const h = React.createElement
const posted: unknown[] = []
let root: Root

// One hook and one agent per file: react-dom registers once per module load.
beforeAll(async () => {
  installHook(windowLike())
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import("react-dom/client")
  startAgent(globalThis, (message) => posted.push(message))
  function Counter() {
    return h("button", null, "Count")
  }
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await React.act(() => root.render(h(Counter)))
})
afterAll(() => React.act(() => root.unmount()))

const send = (data: unknown) =>
  globalThis.dispatchEvent(new MessageEvent("message", { data }))
const children = () => document.documentElement.children.length

const counterId = () => {
  const batch = posted.find(
    (m): m is TreeBatchMessage => (m as { type?: string }).type === "tree",
  )
  const add = batch?.ops.find((op) => op.op === "add" && op.name === "Counter")
  return (add as { id: number }).id
}

test("highlight shows the overlay; clear and unwatch remove it", () => {
  send(WATCH)
  const id = counterId()
  const before = children()
  send(highlight(id))
  expect(children()).toBe(before + 1)
  send(CLEAR_HIGHLIGHT)
  expect(children()).toBe(before)
  send(highlight(id))
  expect(children()).toBe(before + 1)
  send(UNWATCH)
  expect(children()).toBe(before)
})

test("unknown and malformed ids show nothing", () => {
  send(WATCH)
  const before = children()
  send(highlight(9999))
  send({ source: "reactdx-relay", type: "highlight", id: "x" })
  expect(children()).toBe(before)
})

const button = () => document.querySelector("button") as HTMLButtonElement
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

test("a pick swallows the click and posts the owner's id", () => {
  send(WATCH)
  const id = counterId()
  const before = children()
  let reached = 0
  const listener = () => reached++
  document.addEventListener("click", listener)
  try {
    send(PICK_START)
    button().dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))
    expect(children()).toBe(before + 1)
    expect(click(button())).toBe(false)
    expect(reached).toBe(0)
    expect(posted.at(-1)).toEqual(picked(id))
    expect(children()).toBe(before)
    expect(click(button())).toBe(true)
    expect(reached).toBe(1)

    send(PICK_START)
    const outside = document.createElement("div")
    document.body.append(outside)
    click(outside)
    outside.remove()
    expect(posted.at(-1)).toEqual(picked(null))
  } finally {
    document.removeEventListener("click", listener)
  }
})
