import { expect, test } from "vitest"
import { CLEAR_HIGHLIGHT, highlight, parseTreeCommand } from "../src/index"

test.each([
  { type: "resync" },
  { type: "highlight", id: 3 },
  { type: "clear-highlight" },
])("keeps %o", (command) => {
  expect(parseTreeCommand(command)).toEqual(command)
})

test.each<[string, unknown]>([
  ["a highlight without an id", { type: "highlight" }],
  ["a string id", { type: "highlight", id: "1" }],
  ["id 0", { type: "highlight", id: 0 }],
  ["a fractional id", { type: "highlight", id: 1.5 }],
  ["an unsafe id", { type: "highlight", id: 2 ** 53 }],
  ["an unknown command", { type: "pick-start" }],
  ["null", null],
  ["a string", "highlight"],
])("drops %s", (_, data) => {
  expect(parseTreeCommand(data)).toBeUndefined()
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
