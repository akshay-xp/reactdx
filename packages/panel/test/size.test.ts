import { expect, test } from "vitest"
import { sizeText } from "../src/size"

test.each([
  [{ bytes: 2 }, "2 B"],
  [{ bytes: 999 }, "999 B"],
  [{ bytes: 1024 }, "1.0 KB"],
  [{ bytes: 14643 }, "14.3 KB"],
  [{ bytes: 1048576, over: true as const }, "over 1,024 KB"],
])("%o reads %s", (size, text) => {
  expect(sizeText(size)).toBe(text)
})
