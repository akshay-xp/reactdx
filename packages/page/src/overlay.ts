// One element on <html>, created on first show. A closed shadow root keeps page CSS
// out and page queries from reaching the boxes; the host never takes a click.
export function createOverlay(doc: Document) {
  let host: HTMLElement | undefined
  let root: ShadowRoot | undefined

  const hide = () => host?.remove()

  const show = (elements: Element[], label: string) => {
    if (elements.length === 0) return hide()
    if (!host || !root) {
      host = doc.createElement("div")
      host.style.cssText =
        "position: fixed; inset: 0; pointer-events: none; z-index: 2147483647"
      root = host.attachShadow({ mode: "closed" })
    }
    const rects = elements.map((el) => el.getBoundingClientRect())
    const boxes = rects.map(({ left, top, width, height }) => {
      const box = doc.createElement("div")
      box.dataset.box = ""
      box.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; background: rgba(111, 168, 220, 0.45); outline: 1px solid rgb(66, 133, 244)`
      return box
    })
    const name = doc.createElement("div")
    const [first] = rects as [DOMRect]
    name.style.cssText = `position: absolute; left: ${first.left}px; top: ${Math.max(first.top - 20, 0)}px; padding: 2px 4px; background: rgb(32, 33, 36); color: rgb(255, 255, 255); font: 12px monospace; white-space: nowrap`
    name.textContent = label
    root.replaceChildren(...boxes, name)
    if (!host.isConnected) doc.documentElement.append(host)
  }

  return { show, hide }
}
