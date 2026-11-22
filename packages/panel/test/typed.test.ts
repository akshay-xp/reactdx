import { expect, test } from "vitest"
import { parseTyped } from "../src/typed"

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
