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
const replies = () =>
  posted.filter(
    (m): m is InspectedMessage => (m as { type?: string }).type === "inspected",
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
async function inspect(element: React.ReactNode, name: string) {
  await mount(element)
  posted.length = 0
  send(WATCH)
  send({ source: "reactdx-relay", type: "inspect", id: idOf(name) })
  return replies().at(-1)?.data
}

const Theme = React.createContext("light")
Theme.displayName = "Theme"
const Plain = React.createContext(1)
const react19 = React.version.startsWith("19.")

function Reader() {
  React.useContext(Theme)
  React.useContext(Theme)
  React.useContext(Plain)
  return null
}
function UseReader() {
  ;(React as unknown as { use: (c: unknown) => unknown }).use(Theme)
  return null
}
class ClassReader extends React.Component {
  static contextType = Theme
  render() {
    return null
  }
}
function Nothing() {
  return null
}

const dark = (child: React.ReactNode) =>
  h(Theme.Provider, { value: "dark" }, child)

test("the contexts a function component reads, once each, in order", async () => {
  const data = await inspect(dark(h(Reader)), "Reader")
  expect(data?.contexts).toEqual([
    { name: "Theme", value: "dark" },
    { name: "Context", value: 1 },
  ])
})

test.skipIf(!react19)("use() reads count too", async () => {
  const data = await inspect(dark(h(UseReader)), "UseReader")
  expect(data?.contexts).toEqual([{ name: "Theme", value: "dark" }])
})

test("a class's contextType", async () => {
  const data = await inspect(dark(h(ClassReader)), "ClassReader")
  expect(data?.contexts).toEqual([{ name: "Theme", value: "dark" }])
})

test("a component reading none has no contexts", async () => {
  const data = await inspect(dark(h(Nothing)), "Nothing")
  expect(data?.contexts).toBeUndefined()
})
