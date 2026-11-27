import type { SuspenseCause } from "@reactdx/messages"
import { afterEach, expect, test, vi } from "vitest"
import {
  boxOf,
  createIslandOutlines,
  createOutlineLayer,
  createRenderOutlines,
  createScheduler,
  createSuspenseOutlines,
  type Island,
  type Outline,
} from "../src/outlines.ts"

const roots: ShadowRoot[] = []
const attach = Element.prototype.attachShadow
const spy = vi
  .spyOn(Element.prototype, "attachShadow")
  .mockImplementation(function (this: Element, init) {
    const root = attach.call(this, init)
    roots.push(root)
    return root
  })

afterEach(() => {
  roots.length = 0
  spy.mockClear()
})

const children = () => document.documentElement.children.length

const outline = (style: Outline["style"]): Outline => ({
  left: 1,
  top: 2,
  width: 30,
  height: 40,
  label: "waiting 1.2s",
  style,
})

test("the layer draws each outline at its rectangle, labeled, with a count of the rest", () => {
  const before = children()
  const layer = createOutlineLayer(document)
  layer.draw([outline("waiting"), outline("arrived")], 3)
  expect(children()).toBe(before + 1)
  const host = document.documentElement.lastElementChild as HTMLElement
  expect(host.style.position).toBe("fixed")
  expect(host.style.pointerEvents).toBe("none")
  expect(host.style.zIndex).toBe("2147483647")
  expect(spy).toHaveBeenCalledWith({ mode: "closed" })

  const root = roots[0] as ShadowRoot
  const drawn = [...root.querySelectorAll<HTMLElement>("[data-outline]")]
  expect(
    drawn.map(({ style, dataset, textContent }) => [
      style.left,
      style.top,
      style.width,
      style.height,
      dataset.style,
      textContent,
    ]),
  ).toEqual([
    ["1px", "2px", "30px", "40px", "waiting", "waiting 1.2s"],
    ["1px", "2px", "30px", "40px", "arrived", "waiting 1.2s"],
  ])
  expect(root.querySelector("[data-more]")?.textContent).toBe("3 more outlines")

  layer.draw([outline("waiting")], 0)
  expect(children()).toBe(before + 1)
  expect(root.querySelector("[data-more]")).toBeNull()
  expect(root.querySelectorAll("[data-outline]").length).toBe(1)

  layer.draw([], 0)
  expect(host.isConnected).toBe(false)
  expect(children()).toBe(before)
})

const element = (left: number, top: number, width: number, height: number) => {
  const el = document.createElement("div")
  el.getBoundingClientRect = () =>
    ({ left, top, width, height }) as unknown as DOMRect
  return el
}

test("a component's box is the union of its elements' rectangles, empty ones skipped", () => {
  expect(
    boxOf([element(10, 20, 30, 40), element(0, 50, 5, 5), element(0, 0, 0, 0)]),
  ).toEqual({ left: 0, top: 20, width: 40, height: 40 })
  expect(boxOf([])).toBeUndefined()
  expect(boxOf([element(3, 3, 0, 0)])).toBeUndefined()
})

// A controller over a fake layer: frames run when `run` says, the clock is
// `clock.now`, and each boundary id finds one 10x10 element.
const controller = (causes: Record<number, SuspenseCause> = {}) => {
  const draws: { outlines: Outline[]; more: number }[] = []
  const frames: (() => void)[] = []
  const waits = new Map<number, { since: number }>()
  const clock = { now: 0 }
  const found: number[] = []
  const missing = new Set<number>()
  const target = new EventTarget()
  const outlines = createSuspenseOutlines({
    layer: { draw: (outlines, more) => draws.push({ outlines, more }) },
    target,
    waits: () => waits,
    find: (id) => {
      found.push(id)
      return missing.has(id)
        ? undefined
        : { elements: [element(id, 0, 10, 10)] }
    },
    causeFor: (id) => causes[id],
    now: () => clock.now,
    frame: (callback) => frames.push(callback),
  })
  const run = () => {
    for (const callback of frames.splice(0)) callback()
  }
  const last = () => draws.at(-1)
  return {
    outlines,
    draws,
    frames,
    waits,
    clock,
    found,
    missing,
    target,
    run,
    last,
  }
}

test("on, each waiting boundary is outlined on the next frame with its wait and cause", () => {
  const c = controller({
    1: { kind: "server", name: "Reviews" },
    2: { kind: "thrown", name: "Comments", count: 1 },
    3: { kind: "inside", name: "Comments" },
    4: { kind: "lazy" },
    5: { kind: "promise" },
  })
  for (const id of [1, 2, 3, 4, 5, 6]) c.waits.set(id, { since: 0 })
  c.missing.add(6)
  c.clock.now = 1234
  c.outlines.on()
  expect(c.draws).toEqual([])
  c.run()
  expect(c.last()?.more).toBe(0)
  expect(c.last()?.outlines).toEqual([
    {
      left: 1,
      top: 0,
      width: 10,
      height: 10,
      style: "waiting",
      label: "waiting 1.2s · Reviews (server)",
    },
    {
      left: 2,
      top: 0,
      width: 10,
      height: 10,
      style: "waiting",
      label: "waiting 1.2s · thrown by Comments",
    },
    {
      left: 3,
      top: 0,
      width: 10,
      height: 10,
      style: "waiting",
      label: "waiting 1.2s · in Comments",
    },
    {
      left: 4,
      top: 0,
      width: 10,
      height: 10,
      style: "waiting",
      label: "waiting 1.2s",
    },
    {
      left: 5,
      top: 0,
      width: 10,
      height: 10,
      style: "waiting",
      label: "waiting 1.2s",
    },
  ])

  c.outlines.changed()
  c.outlines.changed()
  expect(c.frames).toHaveLength(1)
  c.run()
  c.outlines.off()
  expect(c.last()).toEqual({ outlines: [], more: 0 })
  const drawn = c.draws.length
  c.outlines.changed()
  expect(c.frames).toHaveLength(0)
  expect(c.draws).toHaveLength(drawn)
})

test("at most 100 boundaries are measured and outlined, with a count of the rest", () => {
  const c = controller()
  for (let id = 1; id <= 101; id++) c.waits.set(id, { since: 0 })
  c.outlines.on()
  c.run()
  expect(c.last()?.outlines).toHaveLength(100)
  expect(c.last()?.more).toBe(1)
  expect(c.found).toHaveLength(100)
})

test("a boundary that arrives while on is outlined as arrived for 2 s", () => {
  vi.useFakeTimers()
  try {
    const c = controller()
    c.outlines.arrived(9, 500)
    c.outlines.on()
    c.outlines.arrived(7, 840)
    c.run()
    expect(c.last()?.outlines).toEqual([
      {
        left: 7,
        top: 0,
        width: 10,
        height: 10,
        style: "arrived",
        label: "arrived in 840 ms",
      },
    ])
    vi.advanceTimersByTime(1999)
    c.run()
    expect(c.last()?.outlines).toHaveLength(1)
    vi.advanceTimersByTime(1)
    c.run()
    expect(c.last()?.outlines).toEqual([])

    c.outlines.arrived(8, 100)
    c.outlines.off()
    c.outlines.on()
    c.run()
    expect(c.last()?.outlines).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

test("scrolls and resizes measure again once per frame; labels count up without measuring", () => {
  vi.useFakeTimers()
  try {
    const c = controller()
    // A capture listener on the window hears a scroll in any scroller (scroll
    // doesn't bubble); a plain target stands in, the event sent to it.
    c.outlines.on()
    c.run()
    c.target.dispatchEvent(new Event("scroll"))
    c.target.dispatchEvent(new Event("resize"))
    expect(c.frames).toHaveLength(1)
    c.run()

    c.waits.set(1, { since: 0 })
    c.clock.now = 1200
    c.outlines.changed()
    c.run()
    expect(c.last()?.outlines[0]?.label).toBe("waiting 1.2s")
    const found = c.found.length
    c.clock.now = 1300
    vi.advanceTimersByTime(100)
    expect(c.last()?.outlines[0]?.label).toBe("waiting 1.3s")
    expect(c.found).toHaveLength(found)

    // Nothing waiting: the tick stops.
    c.waits.clear()
    c.outlines.changed()
    c.run()
    const draws = c.draws.length
    vi.advanceTimersByTime(500)
    expect(c.draws).toHaveLength(draws)

    c.waits.set(1, { since: 0 })
    c.outlines.changed()
    c.run()
    c.outlines.off()
    const after = c.draws.length
    vi.advanceTimersByTime(500)
    c.target.dispatchEvent(new Event("scroll"))
    expect(c.frames).toHaveLength(0)
    expect(c.draws).toHaveLength(after)
  } finally {
    vi.useRealTimers()
  }
})

test("the scheduler measures once per frame after changes, scrolls and resizes, while started", () => {
  const frames: (() => void)[] = []
  const target = new EventTarget()
  let measured = 0
  const scheduler = createScheduler({
    target,
    frame: (callback) => frames.push(callback),
    measure: () => measured++,
  })
  const run = () => {
    for (const callback of frames.splice(0)) callback()
  }
  scheduler.changed()
  expect(frames).toHaveLength(0)
  scheduler.start()
  scheduler.changed()
  scheduler.changed()
  target.dispatchEvent(new Event("scroll"))
  target.dispatchEvent(new Event("resize"))
  expect(frames).toHaveLength(1)
  run()
  expect(measured).toBe(1)
  scheduler.changed()
  scheduler.stop()
  run()
  expect(measured).toBe(1)
  scheduler.changed()
  target.dispatchEvent(new Event("scroll"))
  expect(frames).toHaveLength(0)
})

test("the layer lights islands, dashes wrappers, dims the rest and shows a summary", () => {
  const layer = createOutlineLayer(document)
  const island: Outline = { ...outline("waiting"), style: "island" }
  const wrapper: Outline = {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    label: "ThemeProvider",
    style: "wrapper",
  }
  layer.draw([island, wrapper], 0, {
    dim: true,
    summary: "2 client islands · 1.0 KB of props",
  })
  const root = roots.at(-1) as ShadowRoot
  const drawn = [...root.querySelectorAll<HTMLElement>("[data-outline]")]
  expect(drawn.map((el) => el.dataset.style)).toEqual(["island", "wrapper"])
  expect(drawn[1]?.style.outline).toContain("dashed")
  const path = root.querySelector("[data-dim] path")
  expect(path).not.toBeNull()
  expect(path?.getAttribute("fill-rule")).toBe("evenodd")
  expect(path?.getAttribute("d")?.match(/M/g)).toHaveLength(2)
  expect(root.querySelector("[data-summary]")?.textContent).toBe(
    "2 client islands · 1.0 KB of props",
  )
  layer.draw([island], 0)
  expect(root.querySelector("[data-dim]")).toBeNull()
  expect(root.querySelector("[data-summary]")).toBeNull()
  layer.draw([], 0)
})

// Islands over a fake layer: boundary-like ids find one 10x10 element at
// left = id (a wrapper, 100x100 at the origin); `missing` ids find none.
const islandController = (list: Island[]) => {
  const draws: {
    outlines: Outline[]
    more: number
    extra?: { dim?: boolean; summary?: string }
  }[] = []
  const frames: (() => void)[] = []
  const missing = new Set<number>()
  const picks: number[] = []
  const target = new EventTarget()
  const outlines = createIslandOutlines({
    layer: {
      draw: (outlines, more, extra) => draws.push({ outlines, more, extra }),
    },
    target,
    islands: () => list,
    find: (id) => {
      if (missing.has(id)) return { elements: [] }
      const wraps = list.find((island) => island.id === id)?.wraps
      return {
        elements: [wraps ? element(0, 0, 100, 100) : element(id, 0, 10, 10)],
      }
    },
    frame: (callback) => frames.push(callback),
    onPick: (id) => picks.push(id),
  })
  const run = () => {
    for (const callback of frames.splice(0)) callback()
  }
  return {
    outlines,
    draws,
    frames,
    missing,
    picks,
    target,
    run,
    last: () => draws.at(-1),
  }
}

const addToCart: Island = {
  id: 20,
  name: "AddToCart",
  server: "ProductDetails",
  wraps: false,
  size: { bytes: 14643 },
}
const theme: Island = {
  id: 30,
  name: "ThemeProvider",
  server: "Shop",
  wraps: true,
  size: { bytes: 12 },
}

test("islands are lit, wrappers dashed, the rest dimmed, and all of them summed", () => {
  const c = islandController([addToCart, theme])
  c.outlines.on()
  expect(c.draws).toEqual([])
  c.run()
  expect(c.last()?.outlines).toEqual([
    {
      left: 20,
      top: 0,
      width: 10,
      height: 10,
      style: "island",
      label: "AddToCart · 14.3 KB",
    },
    {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      style: "wrapper",
      label: "ThemeProvider · 12 B · wraps server content",
    },
  ])
  expect(c.last()?.extra).toEqual({
    dim: true,
    summary: "2 client islands · 14.3 KB of props",
  })
  c.outlines.off()
  expect(c.last()?.outlines).toEqual([])
})

test("one island reads singular; one without a box is summed, not drawn; at most 100 drawn", () => {
  const one = islandController([addToCart, { ...theme, id: 31, wraps: false }])
  one.missing.add(31)
  one.outlines.on()
  one.run()
  expect(one.last()?.outlines.map((o) => o.label)).toEqual([
    "AddToCart · 14.3 KB",
  ])
  expect(one.last()?.extra?.summary).toBe("2 client islands · 14.3 KB of props")
  const single = islandController([addToCart])
  single.outlines.on()
  single.run()
  expect(single.last()?.extra?.summary).toBe(
    "1 client island · 14.3 KB of props",
  )
  const many = islandController(
    Array.from({ length: 101 }, (_, i) => ({
      ...addToCart,
      id: i + 1,
      size: { bytes: 10 },
    })),
  )
  many.outlines.on()
  many.run()
  expect(many.last()?.outlines).toHaveLength(100)
  expect(many.last()?.more).toBe(1)
  expect(many.last()?.extra?.summary).toBe(
    "101 client islands · 1.0 KB of props",
  )
})

test("hovering an island names its Server Component; a click on one picks it, others pass", () => {
  const c = islandController([addToCart, theme])
  c.outlines.on()
  c.run()
  const at = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      cancelable: true,
    })
    c.target.dispatchEvent(event)
    return event
  }
  const labels = () => c.last()?.outlines.map((o) => o.label)
  at("pointermove", 25, 5)
  expect(labels()).toEqual([
    "AddToCart · 14.3 KB · from ProductDetails",
    "ThemeProvider · 12 B · wraps server content",
  ])
  at("pointermove", 50, 50)
  expect(labels()).toEqual([
    "AddToCart · 14.3 KB",
    "ThemeProvider · 12 B · wraps server content · from Shop",
  ])
  at("pointermove", 500, 500)
  expect(labels()).toEqual([
    "AddToCart · 14.3 KB",
    "ThemeProvider · 12 B · wraps server content",
  ])
  expect(at("pointerdown", 25, 5).defaultPrevented).toBe(true)
  expect(at("click", 25, 5).defaultPrevented).toBe(true)
  expect(c.picks).toEqual([20])
  expect(at("click", 500, 500).defaultPrevented).toBe(false)
  expect(c.picks).toEqual([20])
  c.outlines.off()
  expect(at("click", 25, 5).defaultPrevented).toBe(false)
  expect(c.picks).toEqual([20])
})

test("the layer draws a render outline in the accent color at its opacity", () => {
  const layer = createOutlineLayer(document)
  layer.draw([{ ...outline("render"), label: "Counter", opacity: 0.5 }], 0)
  const box = roots[0]?.querySelector<HTMLElement>("[data-outline]")
  expect(box?.dataset.style).toBe("render")
  expect(box?.style.opacity).toBe("0.5")
  expect(box?.style.outline).toBe("2px solid rgb(11, 87, 208)")
  layer.draw([], 0)
})

// Render outlines over a fake layer: frames run when `run` says, the clock is
// the fake timers' Date.now, and each id finds one 10x10 element named Cn.
const renders = () => {
  const draws: { outlines: Outline[]; more: number }[] = []
  const frames: (() => void)[] = []
  const missing = new Set<number>()
  const target = new EventTarget()
  const outlines = createRenderOutlines({
    layer: { draw: (outlines, more) => draws.push({ outlines, more }) },
    target,
    find: (id) =>
      missing.has(id)
        ? { elements: [], name: `C${id}` }
        : { elements: [element(id, 0, 10, 10)], name: `C${id}` },
    now: () => Date.now(),
    frame: (callback) => frames.push(callback),
  })
  const run = () => {
    for (const callback of frames.splice(0)) callback()
  }
  return {
    outlines,
    draws,
    frames,
    missing,
    target,
    run,
    last: () => draws.at(-1),
  }
}

test("a rendered component is outlined on the next frame, fades, and is gone after 1 s", () => {
  vi.useFakeTimers()
  try {
    const r = renders()
    r.outlines.rendered([1])
    r.run()
    expect(r.draws).toEqual([])

    r.outlines.on()
    r.outlines.rendered([1])
    expect(r.draws).toEqual([])
    r.run()
    expect(r.last()).toEqual({
      outlines: [
        {
          left: 1,
          top: 0,
          width: 10,
          height: 10,
          style: "render",
          label: "C1",
          opacity: 1,
        },
      ],
      more: 0,
    })
    vi.advanceTimersByTime(500)
    expect(r.last()?.outlines[0]?.opacity).toBeCloseTo(0.5)
    vi.advanceTimersByTime(500)
    expect(r.last()).toEqual({ outlines: [], more: 0 })
    const draws = r.draws.length
    vi.advanceTimersByTime(500)
    expect(r.draws).toHaveLength(draws)
  } finally {
    vi.useRealTimers()
  }
})

test("a render while outlined restarts its 1 s and counts; no box, no outline", () => {
  vi.useFakeTimers()
  try {
    const r = renders()
    r.missing.add(2)
    r.outlines.on()
    r.outlines.rendered([1, 2])
    r.run()
    vi.advanceTimersByTime(600)
    r.outlines.rendered([1])
    r.run()
    expect(r.last()?.outlines).toEqual([
      {
        left: 1,
        top: 0,
        width: 10,
        height: 10,
        style: "render",
        label: "C1 ×2",
        opacity: 1,
      },
    ])
    vi.advanceTimersByTime(800)
    expect(r.last()?.outlines).toHaveLength(1)
    vi.advanceTimersByTime(200)
    expect(r.last()?.outlines).toEqual([])

    // Gone means counted afresh.
    r.outlines.rendered([1])
    r.run()
    expect(r.last()?.outlines[0]?.label).toBe("C1")
  } finally {
    vi.useRealTimers()
  }
})

test("the newest 100 renders are outlined with a count of the rest; scrolls measure again; off clears", () => {
  vi.useFakeTimers()
  try {
    const r = renders()
    r.outlines.on()
    r.outlines.rendered(Array.from({ length: 101 }, (_, i) => i + 1))
    r.run()
    expect(r.last()?.outlines).toHaveLength(100)
    expect(r.last()?.outlines[0]?.label).toBe("C2")
    expect(r.last()?.more).toBe(1)

    r.target.dispatchEvent(new Event("scroll"))
    expect(r.frames).toHaveLength(1)
    r.run()

    r.outlines.off()
    expect(r.last()).toEqual({ outlines: [], more: 0 })
    const draws = r.draws.length
    vi.advanceTimersByTime(500)
    r.outlines.rendered([1])
    expect(r.frames).toHaveLength(0)
    r.outlines.on()
    r.run()
    expect(r.last()?.outlines).toEqual([])
    expect(r.draws.length).toBeGreaterThan(draws)
  } finally {
    vi.useRealTimers()
  }
})
