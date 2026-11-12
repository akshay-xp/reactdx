import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js"
import type { TreeStore } from "./tree"
import { ROW_HEIGHT, windowOf } from "./virtual"

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
                class="font-mono"
                style={{
                  height: `${ROW_HEIGHT}px`,
                  "padding-left": `${row.depth * 12}px`,
                }}
              >
                {row.name}
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
