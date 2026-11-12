import { expect, test } from "vitest"
import { stackSource } from "../src/source.ts"

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
