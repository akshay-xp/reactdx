import { parseValue } from "@reactdx/messages"
import React from "react"
import { expect, test } from "vitest"
import { createInspector } from "../src/inspect.ts"

const roundTrips = (value: unknown) =>
  expect(JSON.parse(JSON.stringify(value))).toEqual(value)

// Reads a dotted path out of a descriptor: at(d, "props.a.id").
const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (v, key) => (v as Record<string, unknown> | undefined)?.[key],
      value,
    )

test("JSON-safe primitives pass through unchanged", () => {
  const { serialize } = createInspector()
  for (const value of [1, "a", true, null]) expect(serialize(value)).toBe(value)
})

test("primitives JSON cannot carry become descriptors", () => {
  const { serialize } = createInspector()
  const cases: [unknown, unknown][] = [
    [undefined, { type: "undefined" }],
    [Number.NaN, { type: "number", value: "NaN" }],
    [Number.POSITIVE_INFINITY, { type: "number", value: "Infinity" }],
    [Number.NEGATIVE_INFINITY, { type: "number", value: "-Infinity" }],
    [-0, { type: "number", value: "-0" }],
    [10n, { type: "bigint", value: "10" }],
    [
      "x".repeat(5000),
      { type: "string", preview: "x".repeat(1000), length: 5000 },
    ],
  ]
  for (const [value, descriptor] of cases) {
    const result = serialize(value)
    expect(result).toEqual(descriptor)
    roundTrips(result)
  }
})

class User {
  name = "ada"
}

test("functions, symbols, and objects are described", () => {
  const { serialize } = createInspector()
  expect(serialize(function onClick() {})).toEqual({
    type: "function",
    name: "onClick",
  })
  expect(serialize(Symbol("x"))).toEqual({ type: "symbol", description: "x" })
  expect(serialize({ a: 1 })).toEqual({
    type: "object",
    className: "Object",
    id: expect.any(Number),
    size: 1,
    props: { a: 1 },
  })
  expect(serialize(new User())).toMatchObject({
    type: "object",
    className: "User",
    props: { name: "ada" },
  })
  expect(serialize(Object.create(null))).toMatchObject({
    type: "object",
    className: null,
    size: 0,
  })
  roundTrips(serialize({ a: 1, f() {} }))
})

test("getters are reported, never invoked", () => {
  const { serialize } = createInspector()
  const value = {
    get boom() {
      throw new Error("getter ran")
    },
  }
  expect(serialize(value)).toMatchObject({
    props: { boom: { type: "getter" } },
  })
})

test("objects past the depth limit become refs that expand on demand", () => {
  const { serialize, expand } = createInspector()
  const value = { a: { b: { c: { d: 1 } } } }
  const result = serialize(value)
  const ref = at(result, "props.a.props.b") as { id: number }
  expect(ref).toEqual({
    type: "ref",
    id: expect.any(Number),
    preview: { type: "object", className: "Object", size: 1 },
  })
  expect(expand(ref.id)).toMatchObject({
    type: "object",
    props: { c: { type: "object", props: { d: 1 } } },
  })
  expect(at(serialize(value), "props.a.props.b.id")).toBe(ref.id)
  roundTrips(result)
})

test("circular references become refs marked circular", () => {
  const { serialize } = createInspector()
  const o: Record<string, unknown> = { name: "o" }
  o.self = o
  const result = serialize(o)
  expect(at(result, "props.self")).toEqual({
    type: "ref",
    id: at(result, "id"),
    circular: true,
  })

  const parent: { children: unknown[] } = { children: [] }
  parent.children.push({ parent })
  roundTrips(serialize(parent))
})

test("large arrays, maps, and sets are sent one page at a time", () => {
  const { serialize, expand } = createInspector()
  const list = Array.from({ length: 10000 }, (_, i) => ({ i }))

  const start = performance.now()
  const array = serialize(list)
  const elapsed = performance.now() - start
  expect(array).toMatchObject({
    type: "array",
    id: expect.any(Number),
    length: 10000,
    nextOffset: 100,
  })
  expect(at(array, "items")).toHaveLength(100)
  expect(JSON.stringify(array).length).toBeLessThan(20000)
  expect(elapsed).toBeLessThan(5)
  roundTrips(array)

  const next = expand(at(array, "id") as number, 100)
  expect(at(next, "items.0")).toMatchObject({ props: { i: 100 } })
  expect(at(next, "items")).toHaveLength(100)
  expect(at(next, "nextOffset")).toBe(200)

  const map = serialize(new Map(list.map((item) => [item.i, item])))
  expect(map).toMatchObject({ type: "map", size: 10000, nextOffset: 100 })
  expect(at(map, "entries")).toHaveLength(100)
  expect(at(map, "entries.0")).toEqual([
    0,
    expect.objectContaining({ props: { i: 0 } }),
  ])

  const set = serialize(new Set(list))
  expect(set).toMatchObject({ type: "set", size: 10000, nextOffset: 100 })
  expect(at(set, "values")).toHaveLength(100)
})

test("built-ins get short descriptors", () => {
  const { serialize } = createInspector()
  expect(serialize(new Date(0))).toEqual({
    type: "date",
    iso: "1970-01-01T00:00:00.000Z",
  })
  expect(serialize(/a/g)).toEqual({ type: "regexp", source: "a", flags: "g" })
  expect(serialize(new TypeError("x"))).toEqual({
    type: "error",
    name: "TypeError",
    message: "x",
  })
  expect(serialize(Promise.resolve())).toEqual({ type: "promise" })
})

test("React elements get a react-element descriptor", () => {
  const { serialize } = createInspector()
  function Counter() {
    return null
  }
  expect(serialize(React.createElement(Counter, { key: "k" }))).toEqual({
    type: "react-element",
    name: "Counter",
    key: "k",
  })
  expect(serialize(React.createElement("div"))).toEqual({
    type: "react-element",
    name: "div",
    key: null,
  })
})

test("DOM nodes are described, not walked", () => {
  document.body.innerHTML =
    '<button id="b" class="x y">Go</button><svg id="s" class="icon"></svg>'
  const { serialize } = createInspector()
  const button = document.getElementById("b")
  const start = performance.now()
  const withRef = serialize({ ref: { current: button } })
  expect(performance.now() - start).toBeLessThan(5)
  expect(JSON.stringify(withRef).length).toBeLessThan(1000)
  expect(serialize(button)).toEqual({
    type: "element",
    tag: "button",
    id: "b",
    className: "x y",
  })
  expect(serialize(document)).toEqual({ type: "node", nodeName: "#document" })
  expect(serialize(document.getElementById("s"))).toEqual({
    type: "element",
    tag: "svg",
    id: "s",
    className: "icon",
  })
})

test("object keys are paged like collections", () => {
  const { serialize, expand } = createInspector()
  const value = Object.fromEntries(
    Array.from({ length: 250 }, (_, i) => [`k${i}`, i]),
  )
  const result = serialize(value)
  expect(Object.keys(at(result, "props") as object)).toHaveLength(100)
  expect(at(result, "nextOffset")).toBe(100)
  expect(at(result, "size")).toBe(250)
  const last = expand(at(result, "id") as number, 200)
  expect(Object.keys(at(last, "props") as object)).toEqual(
    Array.from({ length: 50 }, (_, i) => `k${200 + i}`),
  )
  expect(at(last, "nextOffset")).toBeUndefined()
})

test("symbol keys, array extras and holes are kept", () => {
  const { serialize } = createInspector()
  expect(at(serialize({ [Symbol("s")]: 1 }), "props")).toEqual({
    "Symbol(s)": 1,
  })
  const list = Object.assign([1, 2], { extra: "x" })
  expect(serialize(list)).toMatchObject({
    items: [1, 2],
    props: { extra: "x" },
  })
  // biome-ignore lint/suspicious/noSparseArray: the hole is the point
  expect(at(serialize([1, , 3]), "items")).toEqual([1, { type: "hole" }, 3])
})

test("typed arrays are paged, buffers and weak collections summarized", () => {
  const { serialize, expand } = createInspector()
  const bytes = new Uint8Array(1_000_000).map((_, i) => i % 256)
  const start = performance.now()
  const result = serialize(bytes)
  expect(performance.now() - start).toBeLessThan(5)
  expect(result).toEqual({
    type: "typed-array",
    className: "Uint8Array",
    id: expect.any(Number),
    length: 1_000_000,
    items: Array.from({ length: 100 }, (_, i) => i),
    nextOffset: 100,
  })
  expect(at(expand(at(result, "id") as number, 100), "items.0")).toBe(100)
  expect(at(serialize(new BigInt64Array([1n])), "items")).toEqual([
    { type: "bigint", value: "1" },
  ])
  expect(serialize(new ArrayBuffer(8))).toEqual({
    type: "array-buffer",
    byteLength: 8,
  })
  expect(serialize(new DataView(new ArrayBuffer(4)))).toEqual({
    type: "data-view",
    byteLength: 4,
  })
  expect(serialize(new WeakMap())).toEqual({ type: "weak-map" })
  expect(serialize(new WeakSet())).toEqual({ type: "weak-set" })
})

test("a value that throws while read is unreadable, not fatal", () => {
  const { serialize } = createInspector()
  const trap = () => {
    throw new Error("trap")
  }
  const result = serialize({
    ok: 1,
    bad: new Proxy({}, { get: trap }),
    keys: new Proxy({}, { ownKeys: trap }),
  })
  expect(at(result, "props")).toEqual({
    ok: 1,
    bad: { type: "unreadable", message: "trap" },
    keys: { type: "unreadable", message: "trap" },
  })
})

test("names and messages are bounded", () => {
  const { serialize } = createInspector()
  const named = { [`f${"x".repeat(299)}`]: () => {} }
  const fn = Object.values(named)[0]
  expect(at(serialize(fn), "name")).toHaveLength(256)
  expect(at(serialize(new Error("m".repeat(2000))), "message")).toHaveLength(
    1000,
  )
})

test("release() drops every described object", () => {
  const inspector = createInspector()
  const ref = at(
    inspector.serialize({ a: { b: { c: 1 } } }),
    "props.a.props.b.id",
  ) as number
  inspector.release()
  expect(inspector.expand(ref)).toBeUndefined()
  expect(at(inspector.serialize({ x: 1 }), "id")).toBe(1)
})

test("everything it sends passes the panel's checks", () => {
  const { serialize } = createInspector()
  const list = Object.assign(
    [1],
    Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`x${i}`, i])),
  )
  const value = {
    ["k".repeat(2000)]: 1,
    list,
    deep: { a: { b: { c: 1 } } },
    map: new Map([[{ k: 1 }, new Set([1])]]),
    bytes: new Uint8Array(3),
    fn() {},
    when: new Date(0),
    [Symbol("s".repeat(300))]: /x/g,
  }
  const result = serialize(value)
  expect(parseValue(result)).toEqual(result)
})
