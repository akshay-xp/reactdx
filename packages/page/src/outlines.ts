// Suspense outlines on the page (docs/page.md, Outlines).

export type Outline = {
  left: number
  top: number
  width: number
  height: number
  label: string
  style: "waiting" | "arrived"
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
