import { expect, test } from "vitest"
import { durationText } from "../src/index"

test.each([
  [840, "840 ms"],
  [999.6, "1000 ms"],
  [1234, "1.2s"],
])("%d ms reads %s", (ms, text) => {
  expect(durationText(ms)).toBe(text)
})
