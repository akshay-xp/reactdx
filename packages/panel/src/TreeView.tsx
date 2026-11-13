import type { TreeKind } from "@reactdx/messages"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import type { TreeStore } from "./tree"
import { ROW_HEIGHT, windowOf } from "./virtual"

// Kinds worth a badge: the rest are plain components or DOM elements.
export const BADGES = new Set<TreeKind>(["memo", "forwardRef", "lazy"])

// A right-pointing CSS triangle: no text, so nothing for text readers to pick up.
export const TRIANGLE = {
  "border-left": "4px solid currentColor",
  "border-top": "4px solid transparent",
  "border-bottom": "4px solid transparent",
}

// One root's tree. Only the rows in the pane's view (plus overscan) are in the
// DOM. The tree doesn't scroll: the pane around it does ([data-testid=trees]; the
// page's own scroller outside one).
export function TreeView(props: { tree: TreeStore; rootId: number }) {
  let box!: HTMLDivElement
  let pane: Element | undefined
  const rows = createMemo(() => props.tree.rows(props.rootId))
  // The view's top in the tree's coordinates, and its height.
  const [top, setTop] = createSignal(0)
  const [height, setHeight] = createSignal(0)
  const offset = (pane: Element) =>
    box.getBoundingClientRect().top - pane.getBoundingClientRect().top
  const measure = () => {
    if (!pane) return
    setTop(-offset(pane))
    setHeight(pane.clientHeight)
  }
  onMount(() => {
    const view = box.closest("[data-testid=trees]") ?? document.documentElement
    pane = view
    measure()
    view.addEventListener("scroll", measure)
    // The pane's height follows the panel's size; the box moves when trees
    // above it change.
    const observer = new ResizeObserver(measure)
    observer.observe(view)
    observer.observe(box)
    onCleanup(() => {
      view.removeEventListener("scroll", measure)
      observer.disconnect()
    })
  })
  const selected = (id: number) => props.tree.selected() === id
  // Dark muted on selected is 2.9:1 (docs/panel.md, Themes).
  const muted = (id: number) => (selected(id) ? "text-fg" : "text-muted")
  // One listener for every row: a toggle click on an expandable row toggles it,
  // any other click selects the row.
  const click = (event: MouseEvent) => {
    const target = event.target as Element
    const row = target.closest<HTMLElement>("[data-testid=node]")
    if (!row) return
    const id = Number(row.dataset.id)
    if (target.closest("[data-toggle]") && row.hasAttribute("aria-expanded"))
      props.tree.toggle(id)
    else props.tree.select(id)
  }
  // Times the first rows after a subscribe (e2e/perf.test.ts).
  const shown = createMemo(() => rows().length > 0)
  createEffect(() => shown() && performance.mark("reactdx:rows"))
  // Only on selection changes: a commit mustn't scroll back to the selection.
  createEffect(
    on(props.tree.selected, (id) => {
      const index = rows().findIndex((row) => row.id === id)
      // Before mount there's no layout to scroll.
      if (index === -1 || !pane) return
      const top = offset(pane) + index * ROW_HEIGHT
      if (top < 0) pane.scrollTop += top
      else if (top + ROW_HEIGHT > pane.clientHeight)
        pane.scrollTop += top + ROW_HEIGHT - pane.clientHeight
      // Render the new window now (the scroll event comes later); once it's in the
      // DOM, bring the row's toggle and name into view sideways: deep rows start
      // off to the right.
      measure()
      queueMicrotask(() => {
        const row = box.querySelector(`[data-id="${id}"]`)
        const start = row?.querySelector("[data-toggle]")
        const name = row?.querySelector("[data-testid=name]")
        if (!pane || !start || !name) return
        const left = pane.getBoundingClientRect().left
        const from = start.getBoundingClientRect().left - left
        const to = name.getBoundingClientRect().right - left
        // Whole pixels, rounded outward: the scroll snaps to device pixels.
        if (from < 0) pane.scrollLeft += Math.floor(from)
        else if (to > pane.clientWidth)
          // A name wider than the pane keeps its start in view.
          pane.scrollLeft += Math.ceil(Math.min(from, to - pane.clientWidth))
      })
    }),
  )
  const range = () => windowOf(top(), height(), rows().length)

  return (
    <div
      ref={box}
      data-testid="tree"
      role="tree"
      tabIndex={0}
      onClick={click}
      onPointerOver={(event) => {
        const row = (event.target as Element).closest<HTMLElement>(
          "[data-testid=node]",
        )
        if (row) props.tree.hover(Number(row.dataset.id))
      }}
      onPointerLeave={() => props.tree.hover(undefined)}
      onKeyDown={(event) => {
        if (props.tree.key(props.rootId, event.key)) event.preventDefault()
      }}
    >
      <div
        class="relative"
        style={{ height: `${rows().length * ROW_HEIGHT}px` }}
      >
        {/* As wide as the widest row in the window (and at least the pane's
            content), so every row and the selection's background span it. */}
        <div
          class="w-max min-w-full"
          style={{ transform: `translateY(${range().start * ROW_HEIGHT}px)` }}
        >
          <For each={rows().slice(range().start, range().end)}>
            {(row) => (
              <div
                data-testid="node"
                role="treeitem"
                tabIndex={-1}
                aria-level={row.depth + 1}
                aria-selected={selected(row.id)}
                aria-expanded={row.expandable ? row.expanded : undefined}
                class="flex items-center gap-1 whitespace-nowrap font-mono"
                classList={{ "bg-selected": selected(row.id) }}
                data-id={row.id}
                data-match={row.match || undefined}
                style={{
                  height: `${ROW_HEIGHT}px`,
                  "padding-left": `${row.depth * 12}px`,
                }}
              >
                <span data-toggle class="flex w-3 shrink-0 justify-center">
                  <Show when={row.expandable}>
                    <span
                      data-testid="toggle"
                      aria-hidden="true"
                      style={TRIANGLE}
                      classList={{ "rotate-90": row.expanded }}
                    />
                  </Show>
                </span>
                <span
                  data-testid="name"
                  classList={{
                    "text-fg": selected(row.id),
                    "text-accent": row.match && !selected(row.id),
                  }}
                >
                  {row.name}
                </span>
                <Show when={BADGES.has(row.kind)}>
                  {" "}
                  <span data-testid="badge" class={muted(row.id)}>
                    {row.kind}
                  </span>
                </Show>
                <Show when={row.key !== null}>
                  {" "}
                  <span data-testid="key" class={`truncate ${muted(row.id)}`}>
                    {`key="${row.key}"`}
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
