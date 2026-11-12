import type { TreeKind } from "@reactdx/messages"
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import type { TreeStore } from "./tree"
import { ROW_HEIGHT, windowOf } from "./virtual"

const BADGES = new Set<TreeKind>(["memo", "forwardRef", "lazy"])

// A right-pointing CSS triangle: no text, so nothing for text readers to pick up.
const TRIANGLE = {
  "border-left": "4px solid currentColor",
  "border-top": "4px solid transparent",
  "border-bottom": "4px solid transparent",
}

// One root's tree. Only the rows in view (plus overscan) are in the DOM.
export function TreeView(props: { tree: TreeStore; rootId: number }) {
  let scroller!: HTMLDivElement
  const rows = createMemo(() => props.tree.rows(props.rootId))
  const [scrollTop, setScrollTop] = createSignal(0)
  const [height, setHeight] = createSignal(0)
  const measure = () => {
    setScrollTop(scroller.scrollTop)
    setHeight(scroller.clientHeight)
  }
  onMount(() => {
    measure()
    addEventListener("resize", measure)
    onCleanup(() => removeEventListener("resize", measure))
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
  const range = () => windowOf(scrollTop(), height(), rows().length)

  return (
    <div
      ref={scroller}
      data-testid="tree"
      role="tree"
      tabIndex={0}
      class="overflow-y-auto"
      style={{ "max-height": "80vh" }}
      onScroll={measure}
      onClick={click}
      onKeyDown={(event) => {
        if (props.tree.key(props.rootId, event.key)) event.preventDefault()
      }}
    >
      <div
        class="relative"
        style={{ height: `${rows().length * ROW_HEIGHT}px` }}
      >
        <div
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
                {row.name}
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
