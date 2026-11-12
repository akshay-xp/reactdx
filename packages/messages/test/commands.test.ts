import { expect, test } from "vitest"
import {
  CLEAR_HIGHLIGHT,
  highlight,
  PICK_START,
  PICK_STOP,
  parsePicked,
  parseTreeCommand,
  picked,
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
