import { expect, test } from "vitest"
import { matches, matchRanges } from "../src/search"

test.each<[string, string, [number, number][]]>([
  ['Theme: "dark"', "DARK", [[8, 12]]],
  [
    "aaaa",
    "aa",
    [
      [0, 2],
      [2, 4],
    ],
  ],
  ["x", "", []],
])("matchRanges(%j, %j)", (text, query, expected) => {
  expect(matchRanges(text, query)).toEqual(expected)
})

test("matches is true for an empty query or any case-insensitive occurrence", () => {
  expect(matches("Count", "")).toBe(true)
  expect(matches("Count", "OUN")).toBe(true)
  expect(matches("Count", "z")).toBe(false)
})
