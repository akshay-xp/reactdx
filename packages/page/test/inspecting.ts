import {
  type InspectedMessage,
  type TreeBatchMessage,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterAll, beforeAll, beforeEach } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { windowLike } from "./window.ts"

// One hook, agent and root per test file (react-dom registers once per module
// load): mounts elements, watches, and inspects nodes by name.
export function inspecting() {
  const posted: unknown[] = []
  let root: Root
  const mount = async (element: React.ReactNode) => {
    await React.act(() => root.render(element))
  }
  beforeAll(async () => {
    installHook(windowLike())
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    // Imported after the hook, so react-dom finds it.
    const { createRoot } = await import("react-dom/client")
    startAgent(globalThis, (message) => posted.push(message))
    const container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterAll(() => React.act(() => root.unmount()))
  beforeEach(() => {
    posted.length = 0
  })

  const send = (data: unknown) =>
    globalThis.dispatchEvent(new MessageEvent("message", { data }))
  const replies = () =>
    posted.filter(
      (m): m is InspectedMessage =>
        (m as { type?: string }).type === "inspected",
    )
  // Ids from the tree ops posted since the last watch.
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
  // Mounts, watches, inspects the named component; returns its inspection.
  const inspect = async (element: React.ReactNode, name: string) => {
    await mount(element)
    posted.length = 0
    send(WATCH)
    send({ source: "reactdx-relay", type: "inspect", id: idOf(name) })
    return replies().at(-1)?.data
  }
  return { posted, mount, send, replies, idOf, inspect }
}
