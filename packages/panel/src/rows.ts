import { onCleanup } from "solid-js"

// Keyboard rows for the inspector (docs/panel.md, Keyboard): the `[role=treeitem]`
// elements under `root`, in DOM order, are one tab stop. The row last focused
// (by `data-path`) holds it, else the first; arrow keys move focus.
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
  const onKeyDown = (event: KeyboardEvent) => {
    const all = rows()
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (at === -1) return
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
