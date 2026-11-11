import {
  GET_SNAPSHOT,
  parseTreeBatch,
  type SnapshotMessage,
  type TreeBatchMessage,
  type TreeOp,
  WATCH,
} from "@reactdx/messages"
import React from "react"
import type { Root } from "react-dom/client"
import { afterEach, beforeAll, expect, test } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { mirror } from "./tree-mirror.ts"
import { windowLike } from "./window.ts"

const h = React.createElement
const posted: unknown[] = []
const roots: Root[] = []
let createRoot: (container: Element) => Root

// One hook and one agent per file: react-dom registers once per module load.
beforeAll(async () => {
  installHook(windowLike())
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import("react-dom/client"))
  startAgent(globalThis, (message) => posted.push(message))
})

afterEach(async () => {
  for (const root of roots.splice(0)) await React.act(() => root.unmount())
  posted.length = 0
})

async function render(node: React.ReactNode) {
  const root = createRoot(document.createElement("div"))
  roots.push(root)
  await React.act(() => root.render(node))
  return root
}

const send = (data: unknown) =>
  globalThis.dispatchEvent(new MessageEvent("message", { data }))

const batches = () =>
  posted.filter(
    (m): m is TreeBatchMessage => (m as { type?: string }).type === "tree",
  )

const adds = (ops: TreeOp[]) =>
  ops.filter((op): op is Extract<TreeOp, { op: "add" }> => op.op === "add")

function Child() {
  return h("span", null, "hi")
}
function App() {
  return h("div", null, h(Child), "x")
}

test("watch posts a reset and the full tree", async () => {
  await render(h(App))
  send(WATCH)

  const [batch] = batches()
  expect(parseTreeBatch(batch)).toEqual(batch)
  expect(batch?.seq).toBe(1)
  expect(batch?.ops[0]).toEqual({ op: "reset" })
  const tree = mirror()
  tree.apply(batch?.ops ?? [])
  expect(tree.outline()).toEqual([
    "App function",
    "  div host",
    "    Child function",
    "      span host",
  ])
  send(GET_SNAPSHOT)
  const snapshot = posted.at(-1) as SnapshotMessage
  const nodes = adds(batch?.ops ?? [])
  expect(nodes.every((n) => n.rootId === snapshot?.roots[0]?.id)).toBe(true)
  expect(nodes[0]?.parentId).toBe(0)
})
