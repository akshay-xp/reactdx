import assert from "node:assert/strict"
import { test } from "node:test"
import { median, p95 } from "./stats.ts"

test("median of odd and even counts", () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
})

test("p95 uses nearest rank", () => {
  assert.equal(p95(Array.from({ length: 100 }, (_, i) => i + 1)), 95)
  assert.equal(p95([5]), 5)
})

test("inputs are not reordered", () => {
  const values = [3, 1, 2]
  median(values)
  p95(values)
  assert.deepEqual(values, [3, 1, 2])
})
