import { expect, test } from "vitest"
import {
  expanded,
  inspected,
  parseExpanded,
  parseInspected,
  parseValue,
  type Value,
} from "../src/index"

const object = (props: Record<string, Value>, extra = {}): Value => ({
  type: "object",
  className: "Object",
  id: 1,
  size: Object.keys(props).length,
  props,
  ...extra,
})

const every: Value[] = [
  1,
  "a",
  true,
  null,
  { type: "undefined" },
  { type: "number", value: "NaN" },
  { type: "bigint", value: "10" },
  { type: "string", preview: "x", length: 5000 },
  { type: "function", name: "onClick" },
  { type: "symbol", description: "s" },
  { type: "symbol", description: null },
  { type: "getter" },
  { type: "hole" },
  { type: "promise" },
  { type: "weak-map" },
  { type: "weak-set" },
  { type: "unreadable", message: "trap" },
  { type: "react-element", name: "Counter", key: "k" },
  { type: "react-element", name: "div", key: null },
  { type: "date", iso: "1970-01-01T00:00:00.000Z" },
  { type: "regexp", source: "a", flags: "g" },
  { type: "error", name: "TypeError", message: "x" },
  { type: "element", tag: "button", id: "b", className: "x y" },
  { type: "node", nodeName: "#text" },
  { type: "array-buffer", byteLength: 8 },
  { type: "data-view", byteLength: 4 },
  { type: "ref", id: 2, circular: true },
  { type: "ref", id: 2, preview: { type: "object", className: null, size: 1 } },
  { type: "ref", id: 2, preview: { type: "array", length: 3 } },
  {
    type: "ref",
    id: 2,
    preview: { type: "typed-array", className: "Uint8Array", length: 3 },
  },
  { type: "ref", id: 2, preview: { type: "map", size: 3 } },
  { type: "ref", id: 2, preview: { type: "set", size: 3 } },
  object({ a: 1 }, { nextOffset: 100 }),
  { type: "array", id: 3, length: 2, items: [1, { type: "hole" }] },
  {
    type: "array",
    id: 3,
    length: 1,
    items: [1],
    props: { extra: "x" },
    nextOffset: 100,
  },
  {
    type: "typed-array",
    className: "Uint8Array",
    id: 4,
    length: 1,
    items: [0],
  },
  { type: "map", id: 5, size: 1, entries: [["k", object({ a: 1 })]] },
  { type: "set", id: 6, size: 1, values: [1] },
]

test.each(every)("keeps %o", (value) => {
  expect(parseValue(value)).toEqual(value)
})

const nest = (depth: number): Value =>
  depth === 0 ? 1 : object({ a: nest(depth - 1) })

test.each<[string, unknown]>([
  ["an unknown type", { type: "weird" }],
  ["a 1,001-char string", "x".repeat(1001)],
  ["a 257-char name", { type: "function", name: "f".repeat(257) }],
  [
    "a 101-key page",
    object(
      Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i])),
    ),
  ],
  [
    "a 101-item page",
    { type: "array", id: 3, length: 101, items: Array(101).fill(1) },
  ],
  [
    "a 101-entry map page",
    { type: "map", id: 3, size: 101, entries: Array(101).fill([1, 1]) },
  ],
  [
    "a 101-value set page",
    { type: "set", id: 3, size: 101, values: Array(101).fill(1) },
  ],
  ["five nested containers", nest(5)],
  ["a non-id id", { type: "ref", id: 0, circular: true }],
  ["a negative nextOffset", object({}, { nextOffset: -1 })],
  ["a non-finite number", Number.POSITIVE_INFINITY],
  ["a malformed map entry", { type: "map", id: 5, size: 1, entries: [[1]] }],
])("drops %s", (_, value) => {
  expect(parseValue(value)).toBeUndefined()
})

test("four nested containers are kept", () => {
  expect(parseValue(nest(4))).toEqual(nest(4))
})

test("unknown fields are stripped", () => {
  expect(parseValue({ type: "getter", extra: 1 })).toEqual({ type: "getter" })
})

test("inspected replies carry props and state, or null", () => {
  const data = { props: object({ a: 1 }), state: object({ b: 2 }) }
  expect(parseInspected(inspected(3, data))).toEqual(inspected(3, data))
  expect(parseInspected(inspected(3, null))).toEqual(inspected(3, null))
  expect(parseInspected({ ...inspected(3, null), id: 0 })).toBeUndefined()
  expect(
    parseInspected({ ...inspected(3, null), data: { props: { type: "x" } } }),
  ).toBeUndefined()
  expect(
    parseInspected({ source: "x", type: "inspected", id: 3, data: null }),
  ).toBeUndefined()
})

test("expanded replies carry the object's page", () => {
  const value = object({ a: 1 })
  expect(parseExpanded(expanded(2, 100, value))).toEqual(
    expanded(2, 100, value),
  )
  expect(
    parseExpanded({ ...expanded(2, 0, value), offset: -1 }),
  ).toBeUndefined()
  expect(
    parseExpanded({ ...expanded(2, 0, value), objectId: 0 }),
  ).toBeUndefined()
})

test("a message over 50,000 values is dropped", () => {
  const page = (inner: () => Value): Value =>
    object(
      Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, inner()])),
    )
  // 100 x 100 x 100 leaves.
  const huge = page(() => page(() => page(() => 1)))
  expect(parseValue(huge)).toBeUndefined()
})

test("inspected replies carry hooks, nested, or the error reading them", () => {
  const props = object({})
  const hooks = [
    { name: "State", value: 0 },
    {
      name: "useCart",
      value: "2 items",
      hooks: [{ name: "State", value: 2 }],
    },
    { name: "Effect" },
  ]
  expect(parseInspected(inspected(3, { props, hooks }))).toEqual(
    inspected(3, { props, hooks }),
  )
  const failed = { props, hooks: [], hooksError: "boom" }
  expect(parseInspected(inspected(3, failed))).toEqual(inspected(3, failed))
})

const nestHooks = (depth: number): unknown[] =>
  depth === 0 ? [] : [{ name: "useX", hooks: nestHooks(depth - 1) }]

test.each<[string, unknown]>([
  [
    "201 hooks",
    [
      ...Array(150).fill({ name: "State", value: 1 }),
      { name: "useX", hooks: Array(50).fill({ name: "State", value: 1 }) },
    ],
  ],
  ["groups nested 9 deep", nestHooks(9)],
  ["a 257-char name", [{ name: "x".repeat(257) }]],
  ["a bad value", [{ name: "State", value: { type: "weird" } }]],
  ["a non-array", { name: "State" }],
])("drops hooks with %s", (_, hooks) => {
  expect(
    parseInspected({
      ...inspected(3, { props: object({}) }),
      data: { props: object({}), hooks },
    }),
  ).toBeUndefined()
})

test("drops a 1,001-char hooks error", () => {
  expect(
    parseInspected(
      inspected(3, {
        props: object({}),
        hooks: [],
        hooksError: "x".repeat(1001),
      }),
    ),
  ).toBeUndefined()
})

test("groups nested 8 deep are kept", () => {
  const data = { props: object({}), hooks: nestHooks(8) }
  expect(parseInspected({ ...inspected(3, null), data })?.data).toEqual(data)
})

test("inspected replies carry contexts and owners", () => {
  const data = {
    props: object({}),
    contexts: [{ name: "Theme", value: "dark" }],
    owners: [
      { id: 2, name: "App" },
      { id: null, name: "Page" },
    ],
  }
  expect(parseInspected(inspected(3, data))).toEqual(inspected(3, data))
})

test.each<[string, Record<string, unknown>]>([
  ["51 contexts", { contexts: Array(51).fill({ name: "C", value: 1 }) }],
  ["51 owners", { owners: Array(51).fill({ id: 1, name: "A" }) }],
  [
    "a 257-char context name",
    { contexts: [{ name: "x".repeat(257), value: 1 }] },
  ],
  ["a 257-char owner name", { owners: [{ id: 1, name: "x".repeat(257) }] }],
  ["owner id 0", { owners: [{ id: 0, name: "A" }] }],
  ["a string owner id", { owners: [{ id: "2", name: "A" }] }],
  [
    "a bad context value",
    { contexts: [{ name: "C", value: { type: "weird" } }] },
  ],
])("drops %s", (_, extra) => {
  expect(
    parseInspected({
      ...inspected(3, null),
      data: { props: object({}), ...extra },
    }),
  ).toBeUndefined()
})

test.each([
  { file: "/a/Counter.jsx", line: 13, column: 7 },
  { url: "http://localhost:5219/src/Counter.jsx", line: 14, column: 47 },
])("inspected replies carry a source %o", (source) => {
  const data = { props: object({}), source }
  expect(parseInspected(inspected(3, data))).toEqual(inspected(3, data))
})

test.each<[string, Record<string, unknown>]>([
  ["file and url", { file: "/a", url: "http://h/a", line: 1, column: 1 }],
  ["no file or url", { line: 1, column: 1 }],
  ["an empty file", { file: "", line: 1, column: 1 }],
  ["a 1,001-char file", { file: "x".repeat(1001), line: 1, column: 1 }],
  ["a 1,001-char url", { url: "x".repeat(1001), line: 1, column: 1 }],
  ["line 0", { file: "/a", line: 0, column: 1 }],
  ["a negative column", { file: "/a", line: 1, column: -1 }],
  ["a fractional line", { file: "/a", line: 1.5, column: 1 }],
  ["a string column", { file: "/a", line: 1, column: "1" }],
])("drops a source with %s", (_, source) => {
  expect(
    parseInspected({
      ...inspected(3, null),
      data: { props: object({}), source },
    }),
  ).toBeUndefined()
})
