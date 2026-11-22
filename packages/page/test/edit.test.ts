import { expect, test } from "vitest"
import { fromEditValue } from "../src/edit.ts"

test("fromEditValue turns markers and tagged objects into values", () => {
  expect(fromEditValue({ type: "undefined" })).toBeUndefined()
  expect(fromEditValue({ type: "number", value: "NaN" })).toBeNaN()
  expect(fromEditValue({ type: "number", value: "Infinity" })).toBe(
    Number.POSITIVE_INFINITY,
  )
  expect(fromEditValue({ type: "number", value: "-Infinity" })).toBe(
    Number.NEGATIVE_INFINITY,
  )
  expect(Object.is(fromEditValue({ type: "number", value: "-0" }), -0)).toBe(
    true,
  )
  expect(
    fromEditValue([
      "a",
      1,
      null,
      { type: "object", props: { b: [{ type: "undefined" }], c: true } },
    ]),
  ).toEqual(["a", 1, null, { b: [undefined], c: true }])
})
