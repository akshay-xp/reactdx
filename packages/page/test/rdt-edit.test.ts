import {
  type InspectedMessage,
  type TreeBatchMessage,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import { beforeAll, expect, test } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { fakeHook } from "./fake-hook.ts"
import { KEY, windowLike } from "./window.ts"

// Editing and forcing with RDT's hook installed first (M5, milestone checks):
// React reaches the renderer through RDT's hook, and so must the agent.
const h = React.createElement
const posted: unknown[] = []

function Label(props: { text: string }) {
  return h("span", null, props.text)
}
const Inside = () => h("i", null, "Inside")

beforeAll(async () => {
  const fake = fakeHook()
  // As RDT 8 defines it: a getter, not a value.
  Object.defineProperty(windowLike(), KEY, {
    configurable: false,
    enumerable: false,
    get: () => fake,
  })
  installHook(globalThis)
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  startAgent(globalThis, (message) => posted.push(message))
  const { createRoot } = await import("react-dom/client")
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await React.act(() =>
    root.render([
      h(Label, { key: "l", text: "Ada" }),
      h(
        React.Suspense,
        { key: "s", fallback: h("b", null, "Loading") },
        h(Inside),
      ),
    ]),
  )
})

// React 18's act holds the commit until its callback ends: the agent's
// re-send after an edit (the next task) runs in a second act, after it.
const send = async (data: unknown) => {
  await React.act(async () => {
    globalThis.dispatchEvent(new MessageEvent("message", { data }))
  })
  await React.act(() => new Promise((resolve) => setTimeout(resolve, 10)))
}
const idOf = (name: string) => {
  for (const message of posted)
    if ((message as { type?: string }).type === "tree")
      for (const op of (message as TreeBatchMessage).ops)
        if (op.op === "add" && op.name === name) return op.id
  throw new Error(`no ${name}`)
}
const last = () =>
  posted
    .filter(
      (m): m is InspectedMessage =>
        (m as { type?: string }).type === "inspected",
    )
    .at(-1)?.data

test("an edit and a force land with RDT's hook first", async () => {
  await send(WATCH)
  const label = idOf("Label")
  await send({ source: "reactdx-relay", type: "inspect", id: label })
  await send({
    source: "reactdx-relay",
    type: "edit",
    id: label,
    root: "props",
    path: ["text"],
    value: "Grace",
  })
  expect(last()?.props).toMatchObject({ props: { text: "Grace" } })
  const inside = idOf("Inside")
  await send({ source: "reactdx-relay", type: "inspect", id: inside })
  await send({
    source: "reactdx-relay",
    type: "force",
    id: inside,
    kind: "fallback",
    on: true,
  })
  const suspense = idOf("Suspense")
  await send({ source: "reactdx-relay", type: "inspect", id: suspense })
  expect(last()?.boundaries?.fallback).toEqual({ id: suspense, on: true })
})
