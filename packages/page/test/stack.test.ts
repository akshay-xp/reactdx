import { expect, test } from "vitest"
import { parseStack } from "../src/stack.ts"

test("V8 stacks", () => {
  const stack = [
    "Error: x",
    "    at useCart (http://h/src/a.js:3:9)",
    "    at http://h/src/a.js:9:1",
    "    at new Foo (http://h/b.js:1:2)",
    "",
  ].join("\n")
  expect(parseStack(stack)).toEqual([
    { functionName: "useCart", source: "at useCart (http://h/src/a.js:3:9)" },
    { functionName: "", source: "at http://h/src/a.js:9:1" },
    { functionName: "new Foo", source: "at new Foo (http://h/b.js:1:2)" },
  ])
})

test("Firefox stacks", () => {
  const stack = "useCart@http://h/src/a.js:3:9\n@http://h/src/a.js:9:1\n"
  expect(parseStack(stack)).toEqual([
    { functionName: "useCart", source: "useCart@http://h/src/a.js:3:9" },
    { functionName: "", source: "@http://h/src/a.js:9:1" },
  ])
})

test("a message alone has no frames", () => {
  expect(parseStack("Error: boom\nwith a second line")).toEqual([])
})
