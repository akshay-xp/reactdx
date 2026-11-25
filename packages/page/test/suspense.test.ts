import React from "react"
import { expect, test } from "vitest"
import { waitOf } from "../src/suspense.ts"
import type { Fiber } from "../src/tree.ts"
import { inspecting } from "./inspecting.ts"
import { react19, serverInfo } from "./server.ts"

const fiber = (tag: number, memoizedState: unknown) =>
  ({ tag, memoizedState }) as unknown as Fiber

test("a Suspense boundary waits while it shows its fallback or dehydrated HTML", () => {
  expect(waitOf(fiber(13, null))).toBe(null)
  expect(waitOf(fiber(13, { dehydrated: {} }))).toBe("dehydrated")
  expect(waitOf(fiber(13, { dehydrated: null, retryLane: 0 }))).toBe("fallback")
  expect(waitOf(fiber(13, {}))).toBe("fallback")
  expect(waitOf(fiber(0, {}))).toBe(null)
})

const h = React.createElement
const { inspect } = inspecting()
const never = new Promise<never>(() => {})
function Comments(): React.ReactNode {
  throw never
}
const boundary = (children: React.ReactNode) =>
  h(React.Suspense, { fallback: h("i") }, children)
const causeOf = async (children: React.ReactNode) =>
  (await inspect(boundary(children), "Suspense"))?.suspense?.cause

test.skipIf(!react19)(
  "a boundary waiting on a Server Component names it",
  async () => {
    const pending = {
      $$typeof: Symbol.for("react.lazy"),
      _payload: { status: "pending", _debugInfo: [serverInfo("Reviews")] },
      _init: () => {
        throw never
      },
    } as unknown as React.ReactNode
    expect(await causeOf(pending)).toEqual({ kind: "server", name: "Reviews" })
  },
)

test("a boundary waiting inside its child names the child", async () => {
  expect(await causeOf(h(Comments))).toEqual({
    kind: "inside",
    name: "Comments",
  })
})

test("a lazy component loading, or anything else, is said as such", async () => {
  expect(await causeOf(h(React.lazy(() => never)))).toEqual({ kind: "lazy" })
  expect(await causeOf([h(Comments, { key: "c" }), "text"])).toEqual({
    kind: "promise",
  })
})

test("a boundary showing its content has no cause", async () => {
  expect(await causeOf(h("p"))).toBeUndefined()
})
