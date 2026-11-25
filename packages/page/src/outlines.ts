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

// What a waiting boundary's label says it waits on, when that's known.
const causeText = (cause: SuspenseCause | undefined) =>
  cause?.kind === "server"
    ? ` · ${cause.name} (server)`
    : cause?.kind === "thrown"
      ? ` · thrown by ${cause.name}`
      : cause?.kind === "inside"
        ? ` · in ${cause.name}`
        : ""

// Which boundaries to outline, and when to measure them: on the next frame
// after a change, never inside React's commit (docs/m7-findings.md, spike 2).
export function createSuspenseOutlines({
  layer,
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
  let active = false
  let scheduled = false
  // The last frame's measurements, which labels are drawn from.
  let measured: (Box & { since: number; cause: string })[] = []
  let more = 0

  const render = () => {
    const at = now()
    layer.draw(
      measured.map(({ since, cause, ...box }) => ({
        ...box,
        style: "waiting",
        label: `waiting ${durationText(at - since)}${cause}`,
      })),
      more,
    )
  }
  const measure = () => {
    scheduled = false
    if (!active) return
    const all = [...waits()]
    const shown = all.slice(0, MAX_OUTLINES)
    more = all.length - shown.length
    measured = []
    for (const [id, { since }] of shown) {
      const box = boxOf(find(id)?.elements ?? [])
      if (box) measured.push({ ...box, since, cause: causeText(causeFor(id)) })
    }
    render()
  }
  const changed = () => {
    if (!active || scheduled) return
    scheduled = true
    frame(measure)
  }

  return {
    on() {
      active = true
      changed()
    },
    off() {
      active = false
      measured = []
      more = 0
      layer.draw([], 0)
    },
    changed,
  }
}
