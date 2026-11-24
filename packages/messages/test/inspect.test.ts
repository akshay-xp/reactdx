import { expect, test } from "vitest"
import {
  commitsMessage,
  committed,
  countsMessage,
  expanded,
  inspected,
  parseCommits,
  parseCommitted,
  parseCounts,
  parseExpanded,
  parseInspected,
  parseReasoned,
  parseValue,
  reasoned,
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

const site = { url: "http://h/src/A.jsx", line: 3, column: 9 }

test("hooks carry their call sites", () => {
  const data = {
    props: object({}),
    hooks: [
      { name: "State", value: 1, site },
      { name: "useCart", site, hooks: [{ name: "State", value: 2, site }] },
    ],
  }
  expect(parseInspected(inspected(3, data))).toEqual(inspected(3, data))
})

test.each<[string, Record<string, unknown>]>([
  ["a file", { file: "/a", line: 1, column: 1 }],
  ["an empty url", { url: "", line: 1, column: 1 }],
  ["a 1,001-char url", { url: "x".repeat(1001), line: 1, column: 1 }],
  ["line 0", { url: "http://h/a", line: 0, column: 1 }],
  ["a string column", { url: "http://h/a", line: 1, column: "1" }],
])("drops a hook site with %s", (_, bad) => {
  expect(
    parseInspected({
      ...inspected(3, null),
      data: { props: object({}), hooks: [{ name: "State", site: bad }] },
    }),
  ).toBeUndefined()
})

test("a context hook names its context by read index; only a count passes", () => {
  const data = { props: object({}), hooks: [{ name: "Context", context: 1 }] }
  expect(parseInspected(inspected(3, data))).toEqual(inspected(3, data))
  for (const context of [-1, 1.5, "1"])
    expect(
      parseInspected({
        ...inspected(3, null),
        data: { props: object({}), hooks: [{ name: "Context", context }] },
      }),
    ).toBeUndefined()
})

test("a context read can say it's the default value; nothing else passes there", () => {
  const data = {
    props: 1,
    contexts: [
      { name: "Theme", value: "dark" },
      { name: "Context", value: null, default: true },
    ],
  }
  expect(parseInspected(inspected(3, data as never))?.data).toEqual(data)
  for (const bad of ["yes", false])
    expect(
      parseInspected(
        inspected(3, {
          props: 1,
          contexts: [{ name: "C", value: 1, default: bad }],
        } as never),
      ),
    ).toBeUndefined()
})

test("inspected boundaries: the nearest of each kind, by id, and whether forced", () => {
  const boundaries = {
    fallback: { id: 5, on: false },
    error: { id: 6, on: true },
  }
  expect(
    parseInspected(inspected(3, { props: 1, boundaries } as never))?.data,
  ).toEqual({ props: 1, boundaries })
  expect(
    parseInspected(
      inspected(3, {
        props: 1,
        boundaries: { error: { id: 6, on: true } },
      } as never),
    )?.data,
  ).toEqual({ props: 1, boundaries: { error: { id: 6, on: true } } })
  for (const bad of [
    { fallback: { id: 0, on: true } },
    { error: { id: 6, on: 1 } },
  ])
    expect(
      parseInspected(inspected(3, { props: 1, boundaries: bad } as never)),
    ).toBeUndefined()
})

test("an inspection carries its node's latest render reasons", () => {
  const render = {
    seq: 4,
    kinds: ["props", "state", "context"],
    props: [{ key: "count", old: 1, new: 2 }],
    state: [{ key: "ticks", old: 0, new: object({ a: 1 }) }],
    hooks: [{ hook: [1, 0], old: 0, new: 1 }],
    contexts: [{ context: 0, old: "dark", new: "light" }],
  }
  const parse = (value: unknown) =>
    parseInspected(inspected(3, { props: 1, render: value } as never))?.data
  expect(parse(render)).toEqual({ props: 1, render })
  expect(parse({ seq: 1, kinds: ["mount"], extra: 1 })).toEqual({
    props: 1,
    render: { seq: 1, kinds: ["mount"] },
  })
  expect(
    parse({
      seq: 1,
      kinds: ["props"],
      props: [{ key: "a", old: 1, new: 2, extra: 3 }],
    }),
  ).toEqual({
    props: 1,
    render: { seq: 1, kinds: ["props"], props: [{ key: "a", old: 1, new: 2 }] },
  })
  const change = { key: "a", old: 1, new: 2 }
  for (const bad of [
    { seq: 1, kinds: ["hacked"] },
    { seq: 1, kinds: [] },
    { seq: 1, kinds: ["mount", "mount"] },
    { seq: 0, kinds: ["mount"] },
    { seq: 1, kinds: ["props"], props: Array(1001).fill(change) },
    { seq: 1, kinds: ["props"], props: [{ ...change, key: "k".repeat(257) }] },
    {
      seq: 1,
      kinds: ["props"],
      props: [{ key: "a", old: { type: "x" }, new: 1 }],
    },
    { seq: 1, kinds: ["state"], hooks: [{ hook: [-1], old: 0, new: 1 }] },
    {
      seq: 1,
      kinds: ["context"],
      contexts: [{ context: 1.5, old: 0, new: 1 }],
    },
    "mount",
  ])
    expect(
      parseInspected(inspected(3, { props: 1, render: bad } as never)),
    ).toBeUndefined()
})

test("a prop change can say it's only a new reference; nothing else passes there", () => {
  const parse = (reference: unknown) =>
    parseInspected(
      inspected(3, {
        props: 1,
        render: {
          seq: 1,
          kinds: ["props"],
          props: [{ key: "style", old: 1, new: 2, reference }],
        },
      } as never),
    )?.data?.render?.props
  for (const reference of ["same-value", "new-function"])
    expect(parse(reference)).toEqual([
      { key: "style", old: 1, new: 2, reference },
    ])
  expect(parse("x")).toBeUndefined()
  expect(parse(1)).toBeUndefined()
})

test("a render's effects: by call indexes, with their changed deps", () => {
  const parse = (effects: unknown) =>
    parseInspected(
      inspected(3, {
        props: 1,
        render: { seq: 1, kinds: ["parent"], effects },
      } as never),
    )?.data?.render
  const effects = [
    { hook: [2], changed: [{ dep: 1, old: 1, new: 2 }] },
    { hook: [4] },
  ]
  expect(parse(effects)?.effects).toEqual(effects)
  expect(
    parse([
      { hook: [2], extra: 1, changed: [{ dep: 0, old: 1, new: 2, x: 1 }] },
    ])?.effects,
  ).toEqual([{ hook: [2], changed: [{ dep: 0, old: 1, new: 2 }] }])
  for (const bad of [
    [{ hook: [] }],
    [{ hook: [2], changed: [{ dep: -1, old: 1, new: 2 }] }],
    [{ hook: [2], changed: "x" }],
    Array(1001).fill({ hook: [2] }),
  ])
    expect(parse(bad)).toBeUndefined()
})

test("a render's remount is a key change or an ancestor, exactly", () => {
  const parse = (remount: unknown) =>
    parseInspected(
      inspected(3, {
        props: 1,
        render: { seq: 1, kinds: ["mount"], remount },
      } as never),
    )?.data?.render
  for (const remount of [
    { cause: "key", from: "a", to: "b" },
    { cause: "key", from: null, to: "b" },
    { cause: "ancestor", ancestor: 4 },
  ])
    expect(parse(remount)?.remount).toEqual(remount)
  expect(parse({ cause: "ancestor", ancestor: 4, from: "a" })?.remount).toEqual(
    { cause: "ancestor", ancestor: 4 },
  )
  for (const bad of [
    { cause: "x", from: "a", to: "b" },
    { cause: "ancestor", ancestor: 0 },
    { cause: "key", from: 1, to: "b" },
    { cause: "key", from: "a", to: "k".repeat(257) },
    { cause: "key", to: "b", ancestor: 4 },
    "key",
  ])
    expect(parse(bad)).toBeUndefined()
})

test("a render's updaters are ids with their labeled hook changes", () => {
  const parse = (updaters: unknown) =>
    parseInspected(
      inspected(3, {
        props: 1,
        render: { seq: 1, kinds: ["parent"], updaters },
      } as never),
    )?.data?.render
  for (const updaters of [
    [{ id: 3, hooks: [{ name: "State #1", old: 3, new: 4 }] }],
    [],
    [{ id: 3, hooks: [] }],
  ])
    expect(parse(updaters)?.updaters).toEqual(updaters)
  expect(
    parse([
      { id: 3, x: 1, hooks: [{ name: "State #1", old: 3, new: 4, y: 2 }] },
    ])?.updaters,
  ).toEqual([{ id: 3, hooks: [{ name: "State #1", old: 3, new: 4 }] }])
  const hook = { name: "State #1", old: 3, new: 4 }
  for (const bad of [
    [{ id: 0, hooks: [] }],
    [{ id: 3, hooks: [{ ...hook, name: "s".repeat(257) }] }],
    Array(1001).fill({ id: 3, hooks: [] }),
    [{ id: 3, hooks: Array(1001).fill(hook) }],
    [{ id: 3 }],
    { id: 3, hooks: [] },
    [{ id: 3, hooks: [{ ...hook, old: Symbol() }] }],
  ])
    expect(parse(bad)).toBeUndefined()
})

test("an inspection's history is at most 100 increasing commit ids", () => {
  const parse = (history: unknown) =>
    parseInspected(inspected(3, { props: 1, history } as never))?.data
  for (const history of [[1, 4, 9], []])
    expect(parse(history)).toEqual({ props: 1, history })
  const long = Array.from({ length: 101 }, (_, i) => i + 1)
  expect(parse(long.slice(0, 100))?.history).toHaveLength(100)
  for (const bad of [[4, 1], [1, 1], [0], long, "1"])
    expect(parse(bad)).toBeUndefined()
})

test("a reasoned reply carries one render, or null once it's released", () => {
  const render = { seq: 2, kinds: ["state" as const] }
  expect(parseReasoned(reasoned(3, 2, render))).toEqual(reasoned(3, 2, render))
  expect(parseReasoned(reasoned(3, 2, null))).toEqual(reasoned(3, 2, null))
  const message = reasoned(3, 2, render) as Record<string, unknown>
  for (const bad of [
    { ...message, render: { seq: 2, kinds: ["DROPPED"] } },
    { ...message, seq: "2" },
    { ...message, render: undefined },
    { ...message, render: { ...render, seq: 4 } },
    { ...message, id: 0 },
  ])
    expect(parseReasoned(bad)).toBeUndefined()
})

test("commit summaries are at most 100 increasing commits, each bounded", () => {
  const summary = { seq: 3, time: 12.5, rootId: 1, updaters: [4], renders: 2 }
  const list = (commits: unknown[]) =>
    commitsMessage(commits as never, 1, false)
  expect(parseCommits(list([summary]))).toEqual(list([summary]))
  expect(parseCommits(list([{ ...summary, extra: 1 }]))).toEqual(
    list([summary]),
  )
  const many = Array.from({ length: 101 }, (_, i) => ({
    ...summary,
    seq: i + 1,
  }))
  expect(parseCommits(list(many.slice(0, 100)))).toBeDefined()
  for (const bad of [
    many,
    [summary, { ...summary, seq: 3 }],
    [{ ...summary, seq: 0 }],
    [{ ...summary, time: -1 }],
    [{ ...summary, time: Number.NaN }],
    [{ ...summary, rootId: "1" }],
    [{ ...summary, updaters: Array(1001).fill(4) }],
    [{ ...summary, updaters: [0] }],
    [{ ...summary, renders: 1.5 }],
  ])
    expect(parseCommits(list(bad))).toBeUndefined()
})

test("commits say the oldest seq the page holds and whether any dropped", () => {
  const message = commitsMessage([], 3, true)
  expect(message).toMatchObject({ oldest: 3, dropped: true })
  expect(parseCommits({ ...message, extra: 1 })).toEqual(message)
  for (const bad of [
    { ...message, oldest: 0 },
    { ...message, oldest: 1.5 },
    { ...message, dropped: "yes" },
    { ...message, dropped: undefined },
  ])
    expect(parseCommits(bad)).toBeUndefined()
})

test("committed carries each render's kinds and the triggers, or null once released", () => {
  const triggers = [{ id: 1, hooks: [{ name: "State #1", old: 1, new: 2 }] }]
  const full = committed(5, [{ id: 1, kinds: ["state"] }], triggers)
  expect(parseCommitted(full)).toEqual(full)
  const batch = committed(5, [{ id: 2, kinds: ["parent"] }])
  expect(parseCommitted(batch)).toEqual(batch)
  expect(batch).not.toHaveProperty("updaters")
  expect(parseCommitted(committed(5, null))).toEqual(committed(5, null))
  const message = full as Record<string, unknown>
  for (const bad of [
    { ...message, renders: [{ id: 1, kinds: ["nope"] }] },
    { ...message, renders: [{ id: 1, kinds: [] }] },
    { ...message, renders: Array(2001).fill({ id: 1, kinds: ["state"] }) },
    { ...message, renders: [{ id: 0, kinds: ["state"] }] },
    { ...message, renders: undefined },
    { ...message, seq: "5" },
    { ...message, updaters: Array(1001).fill({ id: 1, hooks: [] }) },
    { ...message, updaters: [{ id: 1, hooks: [{ name: 1, old: 1, new: 2 }] }] },
  ])
    expect(parseCommitted(bad)).toBeUndefined()
})

test("render counts are at most 2,000, each a positive id with wasted at most renders", () => {
  const count = { id: 3, renders: 4, wasted: 3 }
  expect(parseCounts(countsMessage([count]))).toEqual(countsMessage([count]))
  expect(parseCounts(countsMessage([]))).toEqual(countsMessage([]))
  expect(parseCounts(countsMessage([{ ...count, extra: 1 } as never]))).toEqual(
    countsMessage([count]),
  )
  for (const bad of [
    Array(2001).fill(count),
    [{ ...count, id: 0 }],
    [{ ...count, renders: 0, wasted: 0 }],
    [{ ...count, renders: 1.5 }],
    [{ ...count, wasted: 5 }],
    [{ ...count, wasted: -1 }],
  ])
    expect(parseCounts(countsMessage(bad as never))).toBeUndefined()
  expect(
    parseCounts({ source: "reactdx", type: "counts", counts: {} }),
  ).toBeUndefined()
})

test("a render says when it happened: a finite time, or none", () => {
  const render = { seq: 2, kinds: ["state" as const], time: 12.5 }
  expect(parseReasoned(reasoned(3, 2, render))).toEqual(reasoned(3, 2, render))
  expect(
    parseInspected(inspected(3, { props: 1, render }))?.data?.render?.time,
  ).toBe(12.5)
  const { time: _, ...timeless } = render
  expect(parseReasoned(reasoned(3, 2, timeless))).toEqual(
    reasoned(3, 2, timeless),
  )
  for (const time of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1"])
    expect(
      parseReasoned(reasoned(3, 2, { ...render, time } as never)),
    ).toBeUndefined()
})
