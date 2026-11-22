import type { Value } from "@reactdx/messages"
import { expect, test } from "vitest"
import { editText, parseTyped } from "../src/typed"

test.each<[string, unknown]>([
  ["5", 5],
  ['"5"', "5"],
  ["null", null],
  ["true", true],
  ["undefined", { type: "undefined" }],
  ["NaN", { type: "number", value: "NaN" }],
  ["Infinity", { type: "number", value: "Infinity" }],
  ["-Infinity", { type: "number", value: "-Infinity" }],
  ["-0", { type: "number", value: "-0" }],
  [
    '{"a": 1, "b": [2, {"c": null}]}',
    {
      type: "object",
      props: { a: 1, b: [2, { type: "object", props: { c: null } }] },
    },
  ],
  ["  7  ", 7],
])("parseTyped(%j)", (text, value) => {
  expect(parseTyped(text)).toEqual(value)
})

test.each(["abc", "{a: 1}", "", "1e999", "[1e999]"])(
  "parseTyped(%j) is undefined",
  (text) => {
    expect(parseTyped(text)).toBeUndefined()
  },
)

const obj = (props: Record<string, Value>, extra = {}): Value => ({
  type: "object",
  className: "Object",
  id: 1,
  size: Object.keys(props).length,
  props,
  ...extra,
})
const arr = (items: Value[]): Value => ({
  type: "array",
  id: 2,
  length: items.length,
  items,
})

test.each<[Value, string, unknown]>([
  ["Count", '"Count"', "Count"],
  ['say "hi"', '"say \\"hi\\""', 'say "hi"'],
  [5, "5", 5],
  [null, "null", null],
  [true, "true", true],
  [{ type: "undefined" }, "undefined", { type: "undefined" }],
  [{ type: "number", value: "-0" }, "-0", { type: "number", value: "-0" }],
  [{ type: "number", value: "NaN" }, "NaN", { type: "number", value: "NaN" }],
  [
    obj({ a: 1, b: arr([2]) }),
    '{"a":1,"b":[2]}',
    { type: "object", props: { a: 1, b: [2] } },
  ],
])("editText(%j) reads back as its value", (value, text, typed) => {
  expect(editText(value)).toBe(text)
  expect(parseTyped(text)).toEqual(typed)
})

test.each<[string, Value]>([
  ["a paged object", obj({ a: 1 }, { size: 200, nextOffset: 100 })],
  [
    "an object holding a ref",
    obj({ a: { type: "ref", id: 4, preview: { type: "array", length: 1 } } }),
  ],
  ["an object holding undefined", obj({ a: { type: "undefined" } })],
  ["a map", { type: "map", id: 3, size: 0, entries: [] }],
  ["a date", { type: "date", iso: "2026-01-01T00:00:00.000Z" }],
  ["a function", { type: "function", name: "f" }],
  ["a class instance", obj({ x: 1 }, { className: "Point" })],
  ["a cut string", { type: "string", preview: "abc", length: 5000 }],
])("%s opens empty: replace only", (_, value) => {
  expect(editText(value)).toBe("")
})
