import { onCleanup } from "solid-js"

// Keyboard rows for the inspector (docs/panel.md, Keyboard): the `[role=treeitem]`
// elements under `root`, in DOM order, are one tab stop. The row last focused
// (by `data-path`) holds it, else the first; arrow keys move focus, and open
// and close rows by their `aria-expanded` and toggle.
export function keyboardRows(root: HTMLElement) {
  let focused: string | undefined
  const rows = () => [...root.querySelectorAll<HTMLElement>("[role=treeitem]")]
  const sync = () => {
    const all = rows()
    const stop = all.find((row) => row.dataset.path === focused) ?? all[0]
    for (const row of all) row.tabIndex = row === stop ? 0 : -1
  }
  const onFocusIn = (event: FocusEvent) => {
    const row = (event.target as Element).closest<HTMLElement>(
      "[role=treeitem]",
    )
    if (!row) return
    focused = row.dataset.path
    sync()
  }
  const level = (row: HTMLElement) => Number(row.getAttribute("aria-level"))
  const toggle = (row: HTMLElement) =>
    row.querySelector<HTMLElement>("[data-testid=value-toggle]")?.click()
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
  root.addEventListener("keydown", onKeyDown)
  sync()
  onCleanup(() => {
    observer.disconnect()
    root.removeEventListener("focusin", onFocusIn)
    root.removeEventListener("keydown", onKeyDown)
  })
}
