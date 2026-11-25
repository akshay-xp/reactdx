import { durationText, type SuspenseCause } from "@reactdx/messages"

// Suspense outlines on the page (docs/page.md, Outlines).

export type Outline = Box & {
  label: string
  style: "waiting" | "arrived"
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

// The panel theme's light values (waiting, success): the page doesn't know
// the panel's theme.
const COLORS = { waiting: "#8a5a00", arrived: "#188038" }

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

  return {
    draw(outlines: Outline[], more: number) {
      if (outlines.length === 0) return host?.remove()
      if (!host || !root) {
        host = doc.createElement("div")
        host.style.cssText =
          "position: fixed; inset: 0; pointer-events: none; z-index: 2147483647"
        root = host.attachShadow({ mode: "closed" })
      }
      const boxes = outlines.map(({ left, top, width, height, ...rest }) => {
        const color = COLORS[rest.style]
        const box = doc.createElement("div")
        box.dataset.outline = ""
        box.dataset.style = rest.style
        // An outline, not a border: the box's rectangle stays the element's.
        box.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; outline: 2px solid ${color}`
        box.append(label(rest.label, color))
        return box
      })
      if (more > 0) {
        const note = label(`${more} more outlines`, COLORS.waiting)
        note.dataset.more = ""
        note.style.inset = "auto 0 0 auto"
        boxes.push(note)
      }
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
  layer: { draw(outlines: Outline[], more: number): void }
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
