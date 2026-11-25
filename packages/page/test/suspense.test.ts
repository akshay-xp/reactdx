import { expect, test } from "vitest"
import { waitOf } from "../src/suspense.ts"
import type { Fiber } from "../src/tree.ts"

const fiber = (tag: number, memoizedState: unknown) =>
  ({ tag, memoizedState }) as unknown as Fiber

test("a Suspense boundary waits while it shows its fallback or dehydrated HTML", () => {
  expect(waitOf(fiber(13, null))).toBe(null)
  expect(waitOf(fiber(13, { dehydrated: {} }))).toBe("dehydrated")
  expect(waitOf(fiber(13, { dehydrated: null, retryLane: 0 }))).toBe("fallback")
  expect(waitOf(fiber(13, {}))).toBe("fallback")
  expect(waitOf(fiber(0, {}))).toBe(null)
})
