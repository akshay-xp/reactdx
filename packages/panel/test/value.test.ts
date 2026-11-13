import type { Value } from "@reactdx/messages"
import { expect, test } from "vitest"
import { previewText } from "../src/value"

const object = (props: Record<string, Value>, size?: number): Value => ({
  type: "object",
  className: "Object",
  id: 1,
  size: size ?? Object.keys(props).length,
  props,
})
const array = (items: Value[], length = items.length): Value => ({
  type: "array",
  id: 2,
  length,
  items,
})

test.each<[Value, string]>([
  ["hi", '"hi"'],
  [3, "3"],
  [true, "true"],
  [null, "null"],
  [{ type: "undefined" }, "undefined"],
  [{ type: "number", value: "NaN" }, "NaN"],
  [{ type: "bigint", value: "10" }, "10n"],
  [
    { type: "string", preview: "x".repeat(1000), length: 5000 },
    `"${"x".repeat(50)}..." (5000 chars)`,
  ],
  ["y".repeat(60), `"${"y".repeat(50)}..." (60 chars)`],
  [{ type: "function", name: "onClick" }, "ƒ onClick()"],
  [{ type: "function", name: "" }, "ƒ ()"],
  [{ type: "symbol", description: "x" }, "Symbol(x)"],
  [{ type: "symbol", description: null }, "Symbol()"],
  [object({ a: 1, b: "x" }), '{a: 1, b: "x"}'],
  [object({}), "{}"],
  // Keys read alphabetically, ignoring case, numbers in order.
  [object({ b: 1, B2: 2, a10: 3, a2: 4 }), "{a2: 4, a10: 3, b: 1, B2: 2}"],
  [object({ a: 1, b: object({}) }), "{a: 1, b: {...}}"],
  [
    object({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }),
    "{a: 1, b: 2, c: 3, d: 4, e: 5, ...}",
  ],
  [object({ a: 1 }, 300), "{a: 1, ...}"],
  [
    { ...(object({ a: 1 }) as object), className: "User" } as Value,
    "User {a: 1}",
  ],
  [array([1, 2]), "[1, 2]"],
  [array([1, array([])]), "[1, Array(0)]"],
  [array([1, 2], 10000), "Array(10000)"],
  [array([{ type: "hole" }, 1]), "[empty, 1]"],
  [{ type: "map", id: 3, size: 3, entries: [] }, "Map(3)"],
  [{ type: "set", id: 3, size: 2, values: [] }, "Set(2)"],
  [
    {
      type: "typed-array",
      className: "Uint8Array",
      id: 3,
      length: 1000000,
      items: [],
    },
    "Uint8Array(1000000)",
  ],
  [{ type: "array-buffer", byteLength: 8 }, "ArrayBuffer(8)"],
  [{ type: "data-view", byteLength: 4 }, "DataView(4)"],
  [{ type: "weak-map" }, "WeakMap"],
  [{ type: "weak-set" }, "WeakSet"],
  [
    {
      type: "ref",
      id: 4,
      preview: { type: "object", className: "Object", size: 2 },
    },
    "{...}",
  ],
  [
    {
      type: "ref",
      id: 4,
      preview: { type: "object", className: "User", size: 2 },
    },
    "User {...}",
  ],
  [{ type: "ref", id: 4, preview: { type: "array", length: 3 } }, "Array(3)"],
  [{ type: "ref", id: 4, preview: { type: "map", size: 3 } }, "Map(3)"],
  [{ type: "ref", id: 4, circular: true }, "[circular]"],
  [{ type: "react-element", name: "Counter", key: "k" }, '<Counter key="k" />'],
  [{ type: "react-element", name: "div", key: null }, "<div />"],
  [
    { type: "date", iso: "1970-01-01T00:00:00.000Z" },
    "1970-01-01T00:00:00.000Z",
  ],
  [{ type: "regexp", source: "a", flags: "g" }, "/a/g"],
  [{ type: "error", name: "TypeError", message: "x" }, "TypeError: x"],
  [{ type: "promise" }, "Promise"],
  [
    { type: "element", tag: "button", id: "b", className: "x y" },
    "<button#b.x.y>",
  ],
  [{ type: "element", tag: "p", id: "", className: "" }, "<p>"],
  [{ type: "node", nodeName: "#text" }, "#text"],
  [{ type: "getter" }, "(getter)"],
  [{ type: "hole" }, "empty"],
  [{ type: "unreadable", message: "trap" }, "(unreadable: trap)"],
])("%o reads %s", (value, text) => {
  expect(previewText(value)).toBe(text)
})
