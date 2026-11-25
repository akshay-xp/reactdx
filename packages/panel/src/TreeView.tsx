import { durationText, type TreeKind } from "@reactdx/messages"
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
export const BADGES = new Set<TreeKind>([
  "memo",
  "forwardRef",
  "lazy",
  "server",
])

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
  // A text color token, or fg on the selection: dark muted on selected is
  // 2.9:1 (docs/panel.md, Themes).
  const tint = (id: number, token: string) => (selected(id) ? "text-fg" : token)
  const muted = (id: number) => tint(id, "text-muted")
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
  // Only on selection changes and reveals: a commit mustn't scroll back to the
  // selection.
  createEffect(
    on([props.tree.selected, props.tree.reveals], ([id]) => {
      const index = rows().findIndex((row) => row.id === id)
      // Before mount there's no layout to scroll.
      if (index === -1 || !pane) return
      // A row's clearance from the pane's edges: macOS draws the horizontal
      // scrollbar over the content, so a row right at the bottom hides under it.
      const margin = Math.min(ROW_HEIGHT, (pane.clientHeight - ROW_HEIGHT) / 2)
      const top = offset(pane) + index * ROW_HEIGHT
      if (top < margin) pane.scrollTop += top - margin
      else if (top + ROW_HEIGHT + margin > pane.clientHeight)
        pane.scrollTop += top + ROW_HEIGHT + margin - pane.clientHeight
      measure()
      // Next frame, after the scroll has applied and the window has rendered:
      // bring the row's toggle and name into view sideways (deep rows start off
      // to the right).
      requestAnimationFrame(() => {
        const row = box.querySelector(`[data-id="${id}"]`)
        const start = row?.querySelector("[data-toggle]")
        // The count sits at the tree's right edge: not the row's content.
        const end = [...(row?.children ?? [])]
          .filter((child) => !child.matches("[data-testid=renders]"))
          .at(-1)
        if (!pane || !start || !end) return
        const left = pane.getBoundingClientRect().left
        const from = start.getBoundingClientRect().left - left
        // The content's end (name, badge or key), a row's height from the right
        // edge: macOS draws the vertical scrollbar over the content.
        const to = end.getBoundingClientRect().right - left + ROW_HEIGHT
        // Whole pixels, rounded outward: the scroll snaps to device pixels.
        // Content that fits is shown whole; wider content shows its start.
        if (from < 0 || to - from > pane.clientWidth)
          pane.scrollLeft += Math.floor(from)
        else if (to > pane.clientWidth)
          pane.scrollLeft += Math.ceil(to - pane.clientWidth)
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
        // A group row (a negative id) is no component on the page.
        const id = Number(row?.dataset.id)
        if (row) props.tree.hover(id > 0 ? id : undefined)
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
            {(row) => {
              const recent = () => props.tree.isRecent(row.id)
              const count = () => props.tree.countOf(row.id)
              const wait = () => props.tree.waitOf(row.id)
              return (
                <div
                  data-testid="node"
                  role="treeitem"
                  tabIndex={-1}
                  aria-level={row.depth + 1}
                  aria-selected={selected(row.id)}
                  aria-expanded={row.expandable ? row.expanded : undefined}
                  class="flex items-center gap-1 whitespace-nowrap font-mono"
                  classList={{
                    "bg-selected": selected(row.id),
                    // Just rendered: under the selection's own background.
                    "bg-highlight/40": recent() && !selected(row.id),
                  }}
                  data-id={row.id}
                  data-recent={recent() || undefined}
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
                    <span
                      data-testid="badge"
                      class={
                        row.kind === "server"
                          ? tint(row.id, "text-server")
                          : muted(row.id)
                      }
                    >
                      {row.kind}
                    </span>
                  </Show>
                  <Show when={row.client}>
                    {" "}
                    <span
                      data-testid="client"
                      class={tint(row.id, "text-client")}
                    >
                      client
                    </span>
                  </Show>
                  <Show when={row.key !== null}>
                    {" "}
                    <span data-testid="key" class={`truncate ${muted(row.id)}`}>
                      {`key="${row.key}"`}
                    </span>
                  </Show>
                  <Show when={wait()}>
                    {(wait) => (
                      <>
                        {" "}
                        <span
                          data-testid="wait"
                          class={
                            wait().waiting
                              ? tint(row.id, "text-waiting")
                              : muted(row.id)
                          }
                        >
                          {wait().waiting
                            ? `waiting ${durationText(wait().ms)}`
                            : `arrived in ${durationText(wait().ms)}`}
                        </span>
                      </>
                    )}
                  </Show>
                  <Show when={row.group}>
                    {(group) => (
                      <span data-testid="group" class={muted(row.id)}>
                        {`×${group().size}`}
                        {count()?.wasted ? ` · ${count()?.wasted} wasted` : ""}
                      </span>
                    )}
                  </Show>
                  <Show when={(count()?.renders ?? 0) > 1}>
                    <span
                      data-testid="renders"
                      class={`ml-auto pr-2 pl-3 tabular-nums ${muted(row.id)}`}
                    >
                      {count()?.renders}
                    </span>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
