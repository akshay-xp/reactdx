import { UNWATCH } from "@reactdx/messages"
import React from "react"
import { expect, test, vi } from "vitest"
import { waitOf } from "../src/suspense.ts"
import type { Fiber } from "../src/tree.ts"
import { inspecting } from "./inspecting.ts"
import { react19, server, serverInfo } from "./server.ts"
import { KEY } from "./window.ts"

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
const { inspect, send, idOf, replies, mount, posted } = inspecting()
const react18 = React.version.startsWith("18.")
const never = new Promise<never>(() => {})
function Comments(): React.ReactNode {
  throw never
}
const boundary = (children: React.ReactNode) =>
  h(React.Suspense, { fallback: h("i") }, children)
// A fresh boundary each time: the root is shared across tests.
const causeOf = async (children: React.ReactNode) => {
  await mount(null)
  return (await inspect(boundary(children), "Suspense"))?.suspense?.cause
}

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

test.skipIf(!react19)(
  "a boundary waiting inside its child names the child",
  async () => {
    expect(await causeOf(h(Comments))).toEqual({
      kind: "inside",
      name: "Comments",
    })
  },
)

test("a lazy component loading is said as such", async () => {
  expect(await causeOf(h(React.lazy(() => never)))).toEqual({ kind: "lazy" })
})

test.skipIf(!react19)("anything else is a promise", async () => {
  expect(await causeOf([h(Comments, { key: "c" }), "text"])).toEqual({
    kind: "promise",
  })
})

// React 18 says which component suspended, and on which promises.
let second: Promise<void> | undefined
let resolveFirst = () => {}
const first = new Promise<void>((resolve) => (resolveFirst = resolve))
let firstDone = false
first.then(() => (firstDone = true))
function Twice(): React.ReactNode {
  if (!firstDone) throw first
  second ??= new Promise<void>(() => {})
  throw second
}

test.skipIf(!react18)(
  "React 18: the component that suspended, and how many promises",
  async () => {
    expect(await causeOf(h(Comments))).toEqual({
      kind: "thrown",
      name: "Comments",
      count: 1,
    })
    await mount(null)
    await inspect(boundary(h(Twice)), "Suspense")
    await React.act(async () => resolveFirst())
    send({ source: "reactdx-relay", type: "inspect", id: idOf("Suspense") })
    expect(replies().at(-1)?.data?.suspense?.cause).toEqual({
      kind: "thrown",
      name: "Twice",
      count: 2,
    })
  },
)

test.skipIf(!react18)(
  "React 18: unwatching takes the profiling hooks out; another devtools keeps them",
  async () => {
    const hook = (
      globalThis as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
          renderers: Map<
            number,
            { injectProfilingHooks?: (h: unknown) => void }
          >
        }
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__
    const renderer = [...(hook?.renderers.values() ?? [])].find(
      (r) => typeof r.injectProfilingHooks === "function",
    )
    const injected = vi.spyOn(
      renderer as { injectProfilingHooks: (h: unknown) => void },
      "injectProfilingHooks",
    )
    await inspect(boundary(h(Comments)), "Suspense")
    send(UNWATCH)
    expect(injected.mock.calls.at(-1)).toEqual([null])

    Object.defineProperty(globalThis, KEY, {
      value: hook,
      configurable: true,
      writable: true,
    })
    try {
      injected.mockClear()
      expect(await causeOf(h(Comments))).toEqual({
        kind: "inside",
        name: "Comments",
      })
      expect(injected).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as Record<string, unknown>)[KEY]
      injected.mockRestore()
    }
  },
)

test("a boundary showing its content has no cause", async () => {
  expect(await causeOf(h("p"))).toBeUndefined()
})

test.skipIf(!react19)(
  "an arrived boundary lists the awaits of the Server Components inside it",
  async () => {
    const reviews = serverInfo("Reviews")
    const recs = serverInfo("Recommendations", null, { owner: reviews })
    const reviewsAwait = {
      awaited: { name: "sleep", start: 96, end: 1297 },
      owner: reviews,
      stack: [["getReviews", "/x.js", 1, 1]],
    }
    const recsAwait = {
      awaited: { name: "sleep", start: 1300, end: 2102 },
      owner: recs,
      stack: [["getRecommendations", "/x.js", 2, 1]],
    }
    await mount(null)
    const page = h(
      "main",
      null,
      boundary(
        server(
          reviews,
          h(
            "ul",
            null,
            h(
              React.Suspense,
              { fallback: h("b") },
              server(recs, h("i"), [recsAwait]),
            ),
          ),
          [reviewsAwait],
        ),
      ),
    )
    const outer = await inspect(page, "Suspense")
    expect(outer?.suspense?.awaited).toEqual([
      { name: "getReviews", owner: "Reviews", start: 96, end: 1297 },
    ])
    const ids = posted
      .flatMap(
        (m) =>
          (m as { ops?: { op: string; name?: string; id: number }[] }).ops ??
          [],
      )
      .filter((op) => op.op === "add" && op.name === "Suspense")
      .map((op) => op.id)
    send({ source: "reactdx-relay", type: "inspect", id: ids[1] })
    expect(replies().at(-1)?.data?.suspense?.awaited).toEqual([
      {
        name: "getRecommendations",
        owner: "Recommendations",
        start: 1300,
        end: 2102,
      },
    ])
  },
)
