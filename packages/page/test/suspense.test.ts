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

// Suspends until `arrive` settles it, then shows `shows`.
let arrive = () => {}
let arrived = false
const later = new Promise<void>((resolve) => {
  arrive = () => {
    arrived = true
    resolve()
  }
})
function Arrives({ shows }: { shows: React.ReactNode }): React.ReactNode {
  if (!arrived) throw later
  return shows
}
function Waits() {
  return h(Arrives, { shows: h("p") })
}
const flushed = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 150)))
const lastArrived = () =>
  posted
    .flatMap((m) =>
      (m as { type?: string; commits?: { arrived?: unknown }[] }).type ===
      "commits"
        ? (m as { commits: { arrived?: unknown }[] }).commits
        : [],
    )
    .flatMap((commit) => (commit.arrived as unknown[] | undefined) ?? [])

test.skipIf(!react19)(
  "a commit records the boundaries whose data arrived, named and with their awaits",
  async () => {
    const reviews = serverInfo("Reviews")
    const reviewsAwait = {
      awaited: { name: "sleep", start: 96, end: 1297 },
      owner: reviews,
      stack: [["getReviews", "/x.js", 1, 1]],
    }
    await mount(null)
    await mount(
      h(
        "main",
        null,
        boundary(
          h(Arrives, { shows: server(reviews, h("ul"), [reviewsAwait]) }),
        ),
        boundary(h(Waits)),
      ),
    )
    send({ source: "reactdx-relay", type: "watch" })
    await React.act(async () => arrive())
    await flushed()
    const ids = posted
      .flatMap(
        (m) =>
          (m as { ops?: { op: string; kind?: string; id: number }[] }).ops ??
          [],
      )
      .filter((op) => op.op === "add" && op.kind === "suspense")
      .map((op) => op.id)
    expect(lastArrived()).toEqual([
      {
        boundary: ids[0],
        name: "Reviews",
        waited: expect.any(Number),
        awaits: [
          { name: "getReviews", owner: "Reviews", start: 96, end: 1297 },
        ],
      },
      {
        boundary: ids[1],
        name: "Waits",
        waited: expect.any(Number),
        awaits: [],
      },
    ])
  },
)

test.skipIf(!react19)(
  "an arrived lazy child is named by the component it resolved to",
  async () => {
    let load = (_: { default: React.ComponentType }) => {}
    function CartCount() {
      return h("p")
    }
    const Lazy = React.lazy(
      () => new Promise<{ default: React.ComponentType }>((r) => (load = r)),
    )
    await mount(null)
    await mount(h("main", null, boundary(h(Lazy))))
    send({ source: "reactdx-relay", type: "watch" })
    await React.act(async () => load({ default: CartCount }))
    await flushed()
    expect(lastArrived().at(-1)).toMatchObject({ name: "CartCount" })
  },
)

test("the outlines command outlines a waiting boundary, then its arrival, until unwatched", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
    setTimeout(callback),
  )
  const rect = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue({ left: 1, top: 2, width: 3, height: 4 } as DOMRect)
  const roots: ShadowRoot[] = []
  const attach = Element.prototype.attachShadow
  const shadow = vi
    .spyOn(Element.prototype, "attachShadow")
    .mockImplementation(function (this: Element, init) {
      const root = attach.call(this, init)
      roots.push(root)
      return root
    })
  const labels = () =>
    roots
      .filter((root) => root.host.isConnected)
      .flatMap((root) => [...root.querySelectorAll("[data-outline]")])
      .map((outline) => outline.textContent)
  try {
    let settle = () => {}
    let done = false
    const promise = new Promise<void>((resolve) => (settle = resolve))
    function Later() {
      if (!done) throw promise
      return h("p")
    }
    await mount(null)
    await mount(boundary(h(Later)))
    send({ source: "reactdx-relay", type: "watch" })
    await flushed()
    expect(labels()).toEqual([])

    send({ source: "reactdx-relay", type: "outlines", on: true })
    await flushed()
    expect(labels()).toHaveLength(1)
    expect(labels()[0]).toMatch(/^waiting \d+ ms/)

    done = true
    await React.act(async () => settle())
    await flushed()
    expect(labels()).toEqual([expect.stringMatching(/^arrived in \d+ ms$/)])

    send(UNWATCH)
    expect(labels()).toEqual([])
  } finally {
    vi.unstubAllGlobals()
    rect.mockRestore()
    shadow.mockRestore()
  }
})
