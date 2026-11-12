import { expect, test } from "vitest"
import { ROW_HEIGHT, windowOf } from "../src/virtual"

test.each([
  [0, 200, 10000, { start: 0, end: 20 }],
  [2000, 200, 10000, { start: 90, end: 120 }],
  [199990, 200, 10000, { start: 9989, end: 10000 }],
  [0, 0, 5, { start: 0, end: 5 }],
  [0, 200, 0, { start: 0, end: 0 }],
])("windowOf(%i, %i, %i)", (scrollTop, height, count, expected) => {
  expect(ROW_HEIGHT).toBe(20)
  expect(windowOf(scrollTop, height, count)).toEqual(expected)
})
