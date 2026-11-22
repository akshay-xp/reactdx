import { expect, test } from "vitest"
import { copyWithDelete, copyWithRename, fromEditValue } from "../src/edit.ts"

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

test("copyWithDelete and copyWithRename copy along the path, leaving the original", () => {
  const value = { a: 1, b: { c: [1, 2, 3] } }
  expect(copyWithDelete(value, ["a"])).toEqual({ b: { c: [1, 2, 3] } })
  expect(copyWithDelete(value, ["b", "c", 0])).toEqual({
    a: 1,
    b: { c: [2, 3] },
  })
  expect(copyWithRename(value, ["a"], "z")).toEqual({
    b: { c: [1, 2, 3] },
    z: 1,
  })
  expect(value).toEqual({ a: 1, b: { c: [1, 2, 3] } })
})
