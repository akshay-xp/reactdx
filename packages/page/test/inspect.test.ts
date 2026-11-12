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
