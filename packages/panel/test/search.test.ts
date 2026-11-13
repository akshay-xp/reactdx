import { expect, test } from "vitest"
import { matches, matchRanges, searchRanges } from "../src/search"

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

test("searchRanges covers matches in marked text only, leaving the DOM alone", () => {
  const root = document.createElement("div")
  root.innerHTML =
    '<span data-search-text>Theme:</span> <span data-search-text>"dark"</span><span>dark</span>'
  const before = root.innerHTML
  const ranges = searchRanges(root, "DARK")
  expect(ranges.map((range) => range.toString())).toEqual(["dark"])
  expect(ranges[0]?.startContainer.parentElement).toBe(root.children[1])
  expect(root.innerHTML).toBe(before)
  expect(searchRanges(root, "")).toEqual([])
})
