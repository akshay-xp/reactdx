import { expect, test } from "vitest"
import {
  CLEAR_HIGHLIGHT,
  highlight,
  MAX_COPY,
  PICK_START,
  PICK_STOP,
  parsePicked,
  parseTreeCommand,
  parseValueStored,
  parseValueText,
  picked,
  valueStored,
  valueText,
} from "../src/index"

test.each([
  { type: "resync" },
  { type: "highlight", id: 3 },
  { type: "clear-highlight" },
  { type: "pick-start" },
  { type: "pick-stop" },
  { type: "inspect", id: 4 },
  { type: "inspect", id: null },
  { type: "expand", objectId: 2, offset: 100 },
  { type: "expand", objectId: 2, offset: 0 },
  { type: "outlines", on: true },
  { type: "outlines", on: false },
])("keeps %o", (command) => {
  expect(parseTreeCommand(command)).toEqual(command)
})

test.each<[string, unknown]>([
  ["a highlight without an id", { type: "highlight" }],
  ["a string id", { type: "highlight", id: "1" }],
  ["id 0", { type: "highlight", id: 0 }],
  ["a fractional id", { type: "highlight", id: 1.5 }],
  ["an unsafe id", { type: "highlight", id: 2 ** 53 }],
  ["an unknown command", { type: "pick" }],
  ["outlines without on", { type: "outlines" }],
  ["outlines with a string on", { type: "outlines", on: "yes" }],
  ["an inspect with a string id", { type: "inspect", id: "4" }],
  ["an inspect with id 0", { type: "inspect", id: 0 }],
  ["an inspect without an id", { type: "inspect" }],
  ["an expand without an offset", { type: "expand", objectId: 2 }],
  [
    "an expand with a negative offset",
    { type: "expand", objectId: 2, offset: -1 },
  ],
  ["an expand with objectId 0", { type: "expand", objectId: 0, offset: 0 }],
  ["null", null],
  ["a string", "highlight"],
])("drops %s", (_, data) => {
  expect(parseTreeCommand(data)).toBeUndefined()
})

test("inspect and expand keep only their fields", () => {
  expect(parseTreeCommand({ type: "inspect", id: 2, extra: 1 })).toEqual({
    type: "inspect",
    id: 2,
  })
  expect(
    parseTreeCommand({ type: "expand", objectId: 2, offset: 0, id: 9 }),
  ).toEqual({ type: "expand", objectId: 2, offset: 0 })
})

test("only the fields it knows are kept", () => {
  expect(parseTreeCommand({ type: "highlight", id: 2, extra: 1 })).toEqual({
    type: "highlight",
    id: 2,
  })
})

test("page messages for the agent", () => {
  expect(highlight(3)).toEqual({
    source: "reactdx-relay",
    type: "highlight",
    id: 3,
  })
  expect(CLEAR_HIGHLIGHT).toEqual({
    source: "reactdx-relay",
    type: "clear-highlight",
  })
})

test.each([4, null])("picked(%o) round-trips", (id) => {
  expect(parsePicked(picked(id))).toEqual({
    source: "reactdx",
    type: "picked",
    id,
  })
})

test.each<[string, unknown]>([
  ["id 0", { source: "reactdx", type: "picked", id: 0 }],
  ["a string id", { source: "reactdx", type: "picked", id: "4" }],
  ["a fractional id", { source: "reactdx", type: "picked", id: 1.5 }],
  ["a missing id", { source: "reactdx", type: "picked" }],
  ["another source", { source: "reactdx-relay", type: "picked", id: 4 }],
  ["another type", { source: "reactdx", type: "pick", id: 4 }],
  ["null", null],
])("parsePicked drops %s", (_, data) => {
  expect(parsePicked(data)).toBeUndefined()
})

test("parsePicked strips extra keys", () => {
  expect(
    parsePicked({ source: "reactdx", type: "picked", id: 4, extra: 1 }),
  ).toEqual(picked(4))
})

test("picker commands for the agent", () => {
  expect(PICK_START).toEqual({ source: "reactdx-relay", type: "pick-start" })
  expect(PICK_STOP).toEqual({ source: "reactdx-relay", type: "pick-stop" })
})

test.each([
  { type: "copy-value", target: { objectId: 2 } },
  { type: "copy-value", target: { objectId: 2, key: "name" } },
  { type: "store-value", target: { objectId: 2, key: 0 } },
  { type: "copy-value", target: { hook: [1, 0] } },
  { type: "store-value", target: { context: 0 } },
])("keeps the value command %o", (command) => {
  expect(parseTreeCommand(command)).toEqual(command)
})

test.each<[string, unknown]>([
  ["no target", { type: "copy-value" }],
  ["objectId 0", { type: "copy-value", target: { objectId: 0 } }],
  ["a key object", { type: "copy-value", target: { objectId: 1, key: {} } }],
  [
    "a fractional index",
    { type: "copy-value", target: { objectId: 1, key: 1.5 } },
  ],
  [
    "a long key",
    { type: "copy-value", target: { objectId: 1, key: "k".repeat(1001) } },
  ],
  ["an empty hook path", { type: "store-value", target: { hook: [] } }],
  [
    "a deep hook path",
    { type: "store-value", target: { hook: Array(9).fill(0) } },
  ],
  ["a negative context", { type: "store-value", target: { context: -1 } }],
])("drops a value command with %s", (_, data) => {
  expect(parseTreeCommand(data)).toBeUndefined()
})

test("a value command's target keeps only its fields", () => {
  expect(
    parseTreeCommand({
      type: "copy-value",
      target: { objectId: 2, key: "a", hook: [0], extra: 1 },
    }),
  ).toEqual({ type: "copy-value", target: { objectId: 2, key: "a" } })
})

test("valueText round-trips, and only text within MAX_COPY passes", () => {
  expect(parseValueText(valueText("{}"))).toEqual(valueText("{}"))
  expect(parseValueText(valueText("x".repeat(MAX_COPY + 1)))).toBeUndefined()
  expect(
    parseValueText({ source: "reactdx", type: "value-text", text: 1 }),
  ).toBeUndefined()
})

test("valueStored round-trips; only a $reactdx<n> name passes", () => {
  expect(parseValueStored(valueStored("$reactdx12"))).toEqual(
    valueStored("$reactdx12"),
  )
  for (const name of ["$reactdx0", "$reactdx", "x", "$reactdx1;alert(1)", 1])
    expect(
      parseValueStored({ source: "reactdx", type: "value-stored", name }),
    ).toBeUndefined()
})

const edit = (fields: Record<string, unknown>) => ({
  type: "edit",
  id: 3,
  root: "props",
  path: ["label"],
  value: "Total",
  ...fields,
})
const nested = (depth: number): unknown =>
  depth === 0 ? 1 : [nested(depth - 1)]

test.each([
  edit({}),
  edit({ root: { hook: [1, 0] }, path: [], value: 7 }),
  edit({ root: "state", path: ["a", 0], value: null }),
  edit({ root: { context: 0 }, value: false }),
  edit({ value: { type: "undefined" } }),
  edit({ value: { type: "number", value: "NaN" } }),
  edit({ value: [1, { type: "object", props: { a: true } }] }),
  edit({ value: nested(16) }),
])("keeps the edit %j", (command) => {
  expect(parseTreeCommand(command)).toEqual(command)
})

test.each<[string, unknown]>([
  ["id 0", edit({ id: 0 })],
  ["an unknown root", edit({ root: "refs" })],
  ["a hook path of 9 indexes", edit({ root: { hook: Array(9).fill(0) } })],
  ["a negative context", edit({ root: { context: -1 } })],
  ["a path of 33 keys", edit({ path: Array(33).fill("a") })],
  ["a 1,001-char key", edit({ path: ["k".repeat(1001)] })],
  ["a fractional index", edit({ path: [1.5] })],
  ["no path", edit({ path: undefined })],
  ["a 100,001-char string", edit({ value: "x".repeat(100_001) })],
  ["a value nested 17 deep", edit({ value: nested(17) })],
  ["10,001 values", edit({ value: Array(10_001).fill(1) })],
  ["a raw Infinity", edit({ value: Number.POSITIVE_INFINITY })],
  ["an untagged object", edit({ value: { a: 1 } })],
  ["an unknown marker", edit({ value: { type: "symbol" } })],
  ["an unknown number marker", edit({ value: { type: "number", value: "1" } })],
  ["no value", edit({ value: undefined })],
])("drops an edit with %s", (_, command) => {
  expect(parseTreeCommand(command)).toBeUndefined()
})

test("an edit keeps only its fields, in its root and values too", () => {
  expect(
    parseTreeCommand(
      edit({
        extra: 1,
        root: { hook: [0], context: 2 },
        value: { type: "object", props: { a: 1 }, extra: 2 },
      }),
    ),
  ).toEqual(
    edit({ root: { hook: [0] }, value: { type: "object", props: { a: 1 } } }),
  )
})

const pathCommand = (fields: Record<string, unknown>) => ({
  type: "delete-path",
  id: 3,
  root: "props",
  path: ["a"],
  ...fields,
})

test.each([
  pathCommand({}),
  pathCommand({ type: "rename-path", root: { hook: [0] }, to: "b" }),
  pathCommand({
    type: "rename-path",
    root: "state",
    path: ["a", 0, "c"],
    to: "d",
  }),
])("keeps the path command %j", (command) => {
  expect(parseTreeCommand(command)).toEqual(command)
})

test.each<[string, unknown]>([
  ["a delete with an empty path", pathCommand({ path: [] })],
  [
    "a rename with an empty path",
    pathCommand({ type: "rename-path", path: [], to: "b" }),
  ],
  ["a rename to nothing", pathCommand({ type: "rename-path", to: "" })],
  [
    "a rename to 1,001 chars",
    pathCommand({ type: "rename-path", to: "k".repeat(1001) }),
  ],
  ["a rename to a number", pathCommand({ type: "rename-path", to: 1 })],
  ["a rename without a name", pathCommand({ type: "rename-path" })],
  ["an unknown root", pathCommand({ root: "refs" })],
  ["a path of 33 keys", pathCommand({ path: Array(33).fill("a") })],
  ["id 0", pathCommand({ id: 0 })],
])("drops %s", (_, command) => {
  expect(parseTreeCommand(command)).toBeUndefined()
})

test("path commands keep only their fields", () => {
  expect(
    parseTreeCommand(pathCommand({ extra: 1, value: 2, to: "x" })),
  ).toEqual(pathCommand({}))
  expect(
    parseTreeCommand(
      pathCommand({ type: "rename-path", to: "b", value: 2, extra: 1 }),
    ),
  ).toEqual(pathCommand({ type: "rename-path", to: "b" }))
})

test("rerender keeps a valid id and only it", () => {
  expect(parseTreeCommand({ type: "rerender", id: 3, extra: 1 })).toEqual({
    type: "rerender",
    id: 3,
  })
  for (const id of [0, "3", undefined])
    expect(parseTreeCommand({ type: "rerender", id })).toBeUndefined()
})

test("force keeps a kind and a boolean for a valid id", () => {
  const force = { type: "force", id: 3, kind: "fallback", on: true }
  expect(parseTreeCommand({ ...force, extra: 1 })).toEqual(force)
  expect(parseTreeCommand({ ...force, kind: "error", on: false })).toEqual({
    ...force,
    kind: "error",
    on: false,
  })
  for (const bad of [
    { kind: "suspend" },
    { on: "yes" },
    { id: 0 },
    { on: undefined },
  ])
    expect(parseTreeCommand({ ...force, ...bad })).toBeUndefined()
})

test("reason asks for one recorded render of a node", () => {
  expect(parseTreeCommand({ type: "reason", id: 3, seq: 2, x: 1 })).toEqual({
    type: "reason",
    id: 3,
    seq: 2,
  })
  expect(parseTreeCommand({ type: "reason", id: 3, seq: 0 })).toBeUndefined()
  expect(parseTreeCommand({ type: "reason", seq: 2 })).toBeUndefined()
})

test("commit asks for the ids a commit rendered", () => {
  expect(parseTreeCommand({ type: "commit", seq: 4, x: 1 })).toEqual({
    type: "commit",
    seq: 4,
  })
  expect(parseTreeCommand({ type: "commit", seq: 0 })).toBeUndefined()
})

test("clear-updates carries nothing: extra fields go", () => {
  expect(parseTreeCommand({ type: "clear-updates", x: 1 })).toEqual({
    type: "clear-updates",
  })
  expect(parseTreeCommand("clear-updates")).toBeUndefined()
})
