import React from "react"
import { expect, test } from "vitest"
import { stackSource } from "../src/source.ts"
import { parseStack } from "../src/stack.ts"
import { inspecting } from "./inspecting.ts"

const h = React.createElement
const { inspect } = inspecting()
const react18 = React.version.startsWith("18.")
const react19 = React.version.startsWith("19.")

const at = { url: "http://h/src/Counter.jsx?t=1", line: 14, column: 47 }

test.each([
  [
    "a V8 stack",
    "Error: react-stack-top-frame\n    at exports.jsxDEV (http://h/deps/jsx.js:1:2)\n    at Counter (http://h/src/Counter.jsx?t=1:14:47)",
  ],
  [
    "a Firefox stack",
    "exports.jsxDEV@http://h/deps/jsx.js:1:2\nCounter@http://h/src/Counter.jsx?t=1:14:47\n",
  ],
  [
    "an unnamed V8 frame",
    "Error: react-stack-top-frame\n    at exports.jsxDEV (http://h/deps/jsx.js:1:2)\n    at http://h/src/Counter.jsx?t=1:14:47",
  ],
])("reads the call site from %s", (_, stack) => {
  expect(stackSource(stack)).toEqual(at)
})

test.each([
  [
    "a V8 UnknownOwner stack",
    "Error: react-stack-top-frame\n    at UnknownOwner (http://h/deps/jsx.js:1:2)\n    at react_stack_bottom_frame (http://h/deps/jsx.js:3:4)",
  ],
  [
    "a Firefox UnknownOwner stack",
    "UnknownOwner@http://h/deps/jsx.js:1:2\nreact_stack_bottom_frame@http://h/deps/jsx.js:3:4\n",
  ],
  [
    "a one-frame stack",
    "Error: x\n    at exports.jsxDEV (http://h/deps/jsx.js:1:2)",
  ],
])("finds no location in %s", (_, stack) => {
  expect(stackSource(stack)).toBeNull()
})

// React 18's createElement takes the JSX transform's location as __source.
const at18 = (fileName: string, lineNumber: number) =>
  ({
    __source: { fileName, lineNumber, columnNumber: 3 },
  }) as React.Attributes

function Card() {
  return h("p", at18("/a/Card.jsx", 5))
}
function Pass({ children }: { children?: React.ReactNode }) {
  return children
}
function Bare() {
  return h("p")
}

test.skipIf(!react18)("React 18: the first element it renders", async () => {
  const data = await inspect(h(Card, at18("/a/App.jsx", 9)), "Card")
  expect(data?.source).toEqual({ file: "/a/Card.jsx", line: 5, column: 3 })
})

test.skipIf(!react18)(
  "React 18: rendering only its children, where it was rendered",
  async () => {
    const data = await inspect(
      h(Pass, at18("/a/App.jsx", 9), h("p", at18("/a/App.jsx", 10))),
      "Pass",
    )
    expect(data?.source).toEqual({ file: "/a/App.jsx", line: 9, column: 3 })
  },
)

test.skipIf(!react18)("React 18: no location written", async () => {
  const data = await inspect(h(Bare), "Bare")
  expect(data).toBeDefined()
  expect(data && "source" in data).toBe(false)
})

// Where an Error made on the element's line was made: React 19 records that line.
let marker: Error | undefined
const markedAt = () => {
  const [, url, line] =
    /\(?([^ (]+):(\d+):\d+\)?$/.exec(
      parseStack(marker?.stack ?? "")[0]?.source ?? "",
    ) ?? []
  return { url, line: Number(line) }
}

function Located() {
  const [element, here] = [h("p"), new Error()]
  marker = here
  return element
}
function Wrapper() {
  const [element, here] = [h(Pass, null, h("p")), new Error()]
  marker = here
  return element
}

test.skipIf(!react19)("React 19: the first element it renders", async () => {
  const data = await inspect(h(Located), "Located")
  expect(data?.source).toEqual({ ...markedAt(), column: expect.any(Number) })
})

test.skipIf(!react19)(
  "React 19: rendering only its children, where it was rendered",
  async () => {
    const data = await inspect(h(Wrapper), "Pass")
    expect(data?.source).toEqual({ ...markedAt(), column: expect.any(Number) })
  },
)
