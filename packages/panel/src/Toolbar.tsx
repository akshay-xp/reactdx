import { Show } from "solid-js"
import type { TreeStore } from "./tree"

// Search (Enter: next match, Shift+Enter: previous) and the DOM elements filter.
export function Toolbar(props: { tree: TreeStore }) {
  return (
    <div class="flex items-center gap-2 border-border border-b p-1">
      <input
        type="search"
        data-testid="search"
        aria-label="Search components"
        placeholder="Search components"
        class="w-48 border border-border bg-surface px-1 text-fg"
        onInput={(event) => props.tree.setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          event.preventDefault()
          props.tree.step(event.shiftKey ? -1 : 1)
        }}
      />
      <Show when={props.tree.query() !== ""}>
        <span data-testid="search-count" class="text-muted">
          {`${props.tree.position()} of ${props.tree.matches().length}`}
        </span>
      </Show>
      <label class="ml-auto flex items-center gap-1">
        <input
          type="checkbox"
          data-testid="show-dom"
          checked={props.tree.showHosts()}
          onChange={(event) =>
            props.tree.setShowHosts(event.currentTarget.checked)
          }
        />
        Show DOM elements
      </label>
    </div>
  )
}
