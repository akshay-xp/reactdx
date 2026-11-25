import { expect, test } from "vitest"
import { durationText, sizeText } from "../src/index"

test.each([
  [840, "840 ms"],
  [999.6, "1000 ms"],
  [1234, "1.2s"],
])("%d ms reads %s", (ms, text) => {
  expect(durationText(ms)).toBe(text)
})

test.each([
  [{ bytes: 2 }, "2 B"],
  [{ bytes: 999 }, "999 B"],
  [{ bytes: 1024 }, "1.0 KB"],
  [{ bytes: 14643 }, "14.3 KB"],
  [{ bytes: 1048576, over: true as const }, "over 1,024 KB"],
])("%o reads %s", (size, text) => {
  expect(sizeText(size)).toBe(text)
})
