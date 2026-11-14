import { For, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"

export type MenuItem = { label: string; run: () => void }

// A right-click menu at the pointer (docs/panel.md, Row menu). Closes on a
// choice, Escape, a press elsewhere, a scroll, a resize or the panel losing focus.
export function RowMenu(props: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  let menu!: HTMLDivElement
  const items = () => [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")]
  const outside = (event: Event) => {
    if (!menu.contains(event.target as Node)) props.onClose()
  }
  const close = () => props.onClose()
  onMount(() => {
    // Kept inside the panel.
    const { width, height } = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(0, Math.min(props.x, innerWidth - width))}px`
    menu.style.top = `${Math.max(0, Math.min(props.y, innerHeight - height))}px`
    items()[0]?.focus()
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("scroll", close, true)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
  })
  onCleanup(() => {
    document.removeEventListener("pointerdown", outside, true)
    document.removeEventListener("scroll", close, true)
    window.removeEventListener("blur", close)
    window.removeEventListener("resize", close)
  })
  const onKeyDown = (event: KeyboardEvent) => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    if (event.key === "Escape") props.onClose()
    else if (event.key === "ArrowDown") all[(at + 1) % all.length]?.focus()
    else if (event.key === "ArrowUp")
      all[(at - 1 + all.length) % all.length]?.focus()
    else return
    event.preventDefault()
  }
  return (
    <Portal>
      <div
        ref={menu}
        role="menu"
        tabIndex={-1}
        class="fixed z-50 min-w-44 rounded-md border border-border bg-bg py-1 text-fg shadow-lg"
        style={{ left: `${props.x}px`, top: `${props.y}px` }}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-1 text-left hover:bg-selected focus:bg-selected focus:outline-none"
              onClick={() => {
                item.run()
                props.onClose()
              }}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
    </Portal>
  )
}
