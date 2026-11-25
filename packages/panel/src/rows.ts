import { onCleanup } from "solid-js"

// Keyboard rows for the inspector (docs/panel.md, Keyboard): the `[role=treeitem]`
// elements under `root`, in DOM order, are one tab stop. The row last focused
// (by `data-path`) holds it, else the first; arrow keys move focus, and open
// and close rows by their `aria-expanded` and toggle.
export function keyboardRows(root: HTMLElement) {
  // The row last focused (a removed one keeps its path).
  let focused: HTMLElement | undefined
  // A row had focus and it hasn't gone elsewhere: a re-render that replaces the
  // row (a re-send) gives it to the row with the same path. Only a replaced
  // row: when a row's editor closes because focus is leaving (Firefox runs its
  // blur before focus lands), pulling focus back would override the move.
  let holding = false
  const rows = () => [...root.querySelectorAll<HTMLElement>("[role=treeitem]")]
  const sync = () => {
    const all = rows()
    const path = focused?.dataset.path
    const stop = all.find((row) => row.dataset.path === path) ?? all[0]
    for (const row of all) row.tabIndex = row === stop ? 0 : -1
    const lost =
      !document.activeElement || document.activeElement === document.body
    if (holding && lost && !focused?.isConnected && stop?.dataset.path === path)
      stop?.focus()
  }
  const onFocusIn = (event: FocusEvent) => {
    const row = (event.target as Element).closest<HTMLElement>(
      "[role=treeitem]",
    )
    if (!row) return
    focused = row
    holding = true
    sync()
  }
  const onFocusOut = (event: FocusEvent) => {
    const to = event.relatedTarget as Node | null
    if (to && !root.contains(to)) holding = false
  }
  // A press elsewhere (even on something that takes no focus) lets go.
  const onPointerDown = (event: PointerEvent) => {
    if (!root.contains(event.target as Node)) holding = false
  }
  const level = (row: HTMLElement) => Number(row.getAttribute("aria-level"))
  // A section header is its own toggle.
  const toggle = (row: HTMLElement) =>
    (
      row.querySelector<HTMLElement>("[data-testid=value-toggle]") ?? row
    ).click()
  // Right opens a closed row or moves into an open one; Left closes an open row
  // or moves to its parent (the nearest earlier row a level up).
  const sideways = (all: HTMLElement[], at: number, key: string) => {
    const row = all[at] as HTMLElement
    const open = row.getAttribute("aria-expanded")
    if (key === "ArrowRight") {
      if (open === "false") toggle(row)
      else if (open === "true") all[at + 1]?.focus()
      return
    }
    if (open === "true") return toggle(row)
    for (let i = at - 1; i >= 0; i--)
      if (level(all[i] as HTMLElement) < level(row)) return all[i]?.focus()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const all = rows()
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (at === -1) return
    // The row's menu, as a right-click at its bottom left would open it.
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault()
      const row = all[at] as HTMLElement
      const { left, bottom } = row.getBoundingClientRect()
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: left,
          clientY: bottom,
        }),
      )
      return
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault()
      return sideways(all, at, event.key)
    }
    const to = {
      ArrowDown: Math.min(at + 1, all.length - 1),
      ArrowUp: Math.max(at - 1, 0),
      Home: 0,
      End: all.length - 1,
    }[event.key]
    if (to === undefined) return
    event.preventDefault()
    all[to]?.focus()
  }
  const observer = new MutationObserver(sync)
  observer.observe(root, { childList: true, subtree: true })
  root.addEventListener("focusin", onFocusIn)
  root.addEventListener("focusout", onFocusOut)
  document.addEventListener("pointerdown", onPointerDown, true)
  root.addEventListener("keydown", onKeyDown)
  sync()
  onCleanup(() => {
    observer.disconnect()
    root.removeEventListener("focusin", onFocusIn)
    root.removeEventListener("focusout", onFocusOut)
    document.removeEventListener("pointerdown", onPointerDown, true)
    root.removeEventListener("keydown", onKeyDown)
  })
}
