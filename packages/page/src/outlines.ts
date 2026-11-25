import {
  durationText,
  type Size,
  type SuspenseCause,
  sizeText,
} from "@reactdx/messages"

// Suspense outlines on the page (docs/page.md, Outlines).

export type Outline = Box & {
  label: string
  style: "waiting" | "arrived" | "island" | "wrapper"
}

type Box = { left: number; top: number; width: number; height: number }

// One rectangle per component: the union of its top elements' (docs/m7-findings.md,
// spike 2), leaving out empty ones (display: none).
export function boxOf(elements: Element[]): Box | undefined {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const el of elements) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.left + rect.width)
    bottom = Math.max(bottom, rect.top + rect.height)
  }
  if (left === Infinity) return
  return { left, top, width: right - left, height: bottom - top }
}

// The panel theme's light values (waiting, success, client): the page doesn't
// know the panel's theme.
const COLORS = {
  waiting: "#8a5a00",
  arrived: "#188038",
  island: "#a04f00",
  wrapper: "#a04f00",
}
const SVG = "http://www.w3.org/2000/svg"

type Layer = Pick<ReturnType<typeof createOutlineLayer>, "draw">

// Its own host beside the hover overlay's, so a hover doesn't wipe them; the
// same closed shadow root and click-through host.
export function createOutlineLayer(doc: Document) {
  let host: HTMLElement | undefined
  let root: ShadowRoot | undefined
  const label = (text: string, color: string) => {
    const el = doc.createElement("div")
    el.style.cssText = `position: absolute; left: -2px; bottom: 100%; padding: 1px 4px; background: ${color}; color: #ffffff; font: 11px monospace; white-space: nowrap`
    el.textContent = text
    return el
  }

  // The viewport with a hole per island (evenodd), shaded.
  const dim = (outlines: Outline[]) => {
    const svg = doc.createElementNS(SVG, "svg")
    svg.dataset.dim = ""
    svg.setAttribute(
      "style",
      "position: absolute; inset: 0; width: 100%; height: 100%",
    )
    const path = doc.createElementNS(SVG, "path")
    const rect = ({ left, top, width, height }: Box) =>
      `M${left} ${top}h${width}v${height}h${-width}z`
    const view = doc.defaultView
    path.setAttribute(
      "d",
      [
        rect({
          left: 0,
          top: 0,
          width: view?.innerWidth ?? 0,
          height: view?.innerHeight ?? 0,
        }),
        ...outlines.filter((o) => o.style === "island").map(rect),
      ].join(""),
    )
    path.setAttribute("fill-rule", "evenodd")
    path.setAttribute("fill", "rgba(0, 0, 0, 0.4)")
    svg.append(path)
    return svg
  }

  return {
    // `dim`: shade the page but the islands; `summary`: a note at the top right.
    draw(
      outlines: Outline[],
      more: number,
      extra: { dim?: boolean; summary?: string } = {},
    ) {
      if (outlines.length === 0) return host?.remove()
      if (!host || !root) {
        host = doc.createElement("div")
        host.style.cssText =
          "position: fixed; inset: 0; pointer-events: none; z-index: 2147483647"
        root = host.attachShadow({ mode: "closed" })
      }
      const boxes: Element[] = outlines.map(
        ({ left, top, width, height, ...rest }) => {
          const color = COLORS[rest.style]
          const box = doc.createElement("div")
          box.dataset.outline = ""
          box.dataset.style = rest.style
          // An outline, not a border: the box's rectangle stays the element's.
          const line = rest.style === "wrapper" ? "dashed" : "solid"
          box.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; outline: 2px ${line} ${color}`
          box.append(label(rest.label, color))
          return box
        },
      )
      if (more > 0) {
        const note = label(`${more} more outlines`, COLORS.waiting)
        note.dataset.more = ""
        note.style.inset = "auto 0 0 auto"
        boxes.push(note)
      }
      if (extra.summary) {
        const note = label(extra.summary, COLORS.island)
        note.dataset.summary = ""
        note.style.inset = "0 0 auto auto"
        boxes.push(note)
      }
      if (extra.dim) boxes.unshift(dim(outlines))
      root.replaceChildren(...boxes)
      if (!host.isConnected) doc.documentElement.append(host)
    },
  }
}

const MAX_OUTLINES = 100
const ARRIVED_MS = 2000
const TICK_MS = 100
// Scroll doesn't bubble: capturing on the window hears every scroller.
const LISTEN = { capture: true, passive: true }

// When to measure: on the next frame after a change (one frame per burst), a
// scroll or a resize, never inside React's commit (docs/m7-findings.md, spike
// 2), and only while started.
export function createScheduler({
  target,
  frame,
  measure,
}: {
  target: EventTarget
  frame: (callback: () => void) => void
  measure: () => void
}) {
  let active = false
  let scheduled = false
  const run = () => {
    scheduled = false
    if (active) measure()
  }
  const changed = () => {
    if (!active || scheduled) return
    scheduled = true
    frame(run)
  }
  return {
    active: () => active,
    start() {
      active = true
      target.addEventListener("scroll", changed, LISTEN)
      target.addEventListener("resize", changed)
    },
    stop() {
      active = false
      target.removeEventListener("scroll", changed, LISTEN)
      target.removeEventListener("resize", changed)
    },
    changed,
  }
}

// What a waiting boundary's label says it waits on, when that's known.
const causeText = (cause: SuspenseCause | undefined) =>
  cause?.kind === "server"
    ? ` · ${cause.name} (server)`
    : cause?.kind === "thrown"
      ? ` · thrown by ${cause.name}`
      : cause?.kind === "inside"
        ? ` · in ${cause.name}`
        : ""

// Which boundaries to outline, measured as `createScheduler` says.
export function createSuspenseOutlines({
  layer,
  target,
  waits,
  find,
  causeFor,
  now,
  frame,
}: {
  layer: Layer
  target: EventTarget
  waits: () => ReadonlyMap<number, { since: number }>
  find: (id: number) => { elements: Element[] } | undefined
  causeFor: (id: number) => SuspenseCause | undefined
  now: () => number
  frame: (callback: () => void) => void
}) {
  // Boundaries that just arrived, by id: how long they waited, and the timer
  // that drops them.
  const arrivals = new Map<number, { ms: number; timer: number }>()
  // The last frame's measurements, which labels are drawn from.
  type Measured = Box & {
    style: Outline["style"]
    label: (at: number) => string
  }
  let measured: Measured[] = []
  let more = 0
  // Labels count up from the last measurement, which only a change redoes.
  let tick: ReturnType<typeof setInterval> | undefined
  const stopTick = () => {
    clearInterval(tick)
    tick = undefined
  }

  const render = () => {
    const at = now()
    layer.draw(
      measured.map(({ label, ...outline }) => ({
        ...outline,
        label: label(at),
      })),
      more,
    )
  }
  const measure = () => {
    const all = [
      ...[...waits()].map(([id, { since }]) => ({
        id,
        style: "waiting" as const,
        label: (at: number, cause: string) =>
          `waiting ${durationText(at - since)}${cause}`,
      })),
      ...[...arrivals].map(([id, { ms }]) => ({
        id,
        style: "arrived" as const,
        label: () => `arrived in ${durationText(ms)}`,
      })),
    ]
    const shown = all.slice(0, MAX_OUTLINES)
    more = all.length - shown.length
    measured = []
    for (const { id, style, label } of shown) {
      const box = boxOf(find(id)?.elements ?? [])
      if (!box) continue
      const cause = style === "waiting" ? causeText(causeFor(id)) : ""
      measured.push({ ...box, style, label: (at) => label(at, cause) })
    }
    render()
    if (!measured.some((outline) => outline.style === "waiting")) stopTick()
    else tick ??= setInterval(render, TICK_MS)
  }
  const scheduler = createScheduler({ target, frame, measure })
  const { changed } = scheduler

  return {
    on() {
      scheduler.start()
      changed()
    },
    off() {
      scheduler.stop()
      stopTick()
      for (const { timer } of arrivals.values()) clearTimeout(timer)
      arrivals.clear()
      measured = []
      more = 0
      layer.draw([], 0)
    },
    changed,
    // A waiting boundary's content arrived, after `ms`: outlined for 2 s.
    arrived(id: number, ms: number) {
      if (!scheduler.active()) return
      clearTimeout(arrivals.get(id)?.timer)
      const timer = setTimeout(() => {
        arrivals.delete(id)
        changed()
      }, ARRIVED_MS) as unknown as number
      arrivals.set(id, { ms, timer })
      changed()
    },
  }
}

// A client island (`tree.islands()`), named, with the Server Component that
// rendered it and its props' size.
export type Island = {
  id: number
  name: string
  server: string
  wraps: boolean
  size: Size
}

// Client islands lit, wrappers dashed (their box is the server content they
// wrap), the rest of the page dimmed; the summary counts every island.
export function createIslandOutlines({
  layer,
  target,
  islands,
  find,
  frame,
  onPick,
}: {
  layer: Layer
  target: EventTarget
  islands: () => Island[]
  find: (id: number) => { elements: Element[] } | undefined
  frame: (callback: () => void) => void
  onPick: (id: number) => void
}) {
  // The last frame's boxes, which hovers and clicks are tested against.
  let shown: (Box & { island: Island })[] = []
  let more = 0
  let summary = ""
  let hovered: number | undefined

  const render = () =>
    layer.draw(
      shown.map(({ island, ...box }) => {
        const size = sizeText(island.size)
        const from = island.id === hovered ? ` · from ${island.server}` : ""
        return island.wraps
          ? {
              ...box,
              style: "wrapper" as const,
              label: `${island.name} · ${size} · wraps server content${from}`,
            }
          : {
              ...box,
              style: "island" as const,
              label: `${island.name} · ${size}${from}`,
            }
      }),
      more,
      { dim: true, summary },
    )
  const measure = () => {
    const all = islands()
    const first = all.slice(0, MAX_OUTLINES)
    more = all.length - first.length
    shown = []
    for (const island of first) {
      const box = boxOf(find(island.id)?.elements ?? [])
      if (box) shown.push({ ...box, island })
    }
    const total = {
      bytes: all.reduce((sum, island) => sum + island.size.bytes, 0),
      ...(all.some((island) => island.size.over) && { over: true as const }),
    }
    const count = `${all.length} client island${all.length === 1 ? "" : "s"}`
    summary = `${count} · ${sizeText(total)} of props`
    render()
  }
  // The island under a point: a lit one before a wrapper around it.
  const islandAt = (event: Event) => {
    const { clientX: x, clientY: y } = event as MouseEvent
    const hits = shown.filter(
      (box) =>
        x >= box.left &&
        x < box.left + box.width &&
        y >= box.top &&
        y < box.top + box.height,
    )
    return (hits.find((box) => !box.island.wraps) ?? hits[0])?.island.id
  }
  const pointing = (event: Event) => {
    const id = islandAt(event)
    if (id === hovered) return
    hovered = id
    render()
  }
  // A press on an island is the panel's, not the page's.
  const pressed = (event: Event) => {
    const id = islandAt(event)
    if (id === undefined) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === "click") onPick(id)
  }
  const listeners: [string, (event: Event) => void][] = [
    ["pointermove", pointing],
    ...["pointerdown", "mousedown", "pointerup", "mouseup", "click"].map(
      (type) => [type, pressed] as [string, (event: Event) => void],
    ),
  ]
  const scheduler = createScheduler({ target, frame, measure })
  return {
    on() {
      scheduler.start()
      for (const [type, listener] of listeners)
        target.addEventListener(type, listener, true)
      scheduler.changed()
    },
    off() {
      scheduler.stop()
      for (const [type, listener] of listeners)
        target.removeEventListener(type, listener, true)
      shown = []
      hovered = undefined
      layer.draw([], 0)
    },
    changed: scheduler.changed,
  }
}
