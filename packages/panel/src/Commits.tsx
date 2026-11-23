import { For, Show } from "solid-js"
import type { InspectorStore } from "./inspection"
import type { TimelineStore } from "./timeline"
import type { TreeStore } from "./tree"

// "2s", "1m", "2h": how long ago, coarse enough to tick once a second.
const ago = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

// The recorded commits, newest first (docs/panel.md, Commits). One tab stop:
// the list holds focus and names the picked row through aria-activedescendant;
// its keys go to the store.
export function Commits(props: {
  timeline: TimelineStore
  tree: TreeStore
  inspector: InspectorStore
  // The clock the times are shown against (Date.now, ticking).
  now: () => number
  onReveal: (id: number) => void
}) {
  const history = () => props.inspector.history()
  const optionId = (seq: number) => `commit-${seq}`
  const selectedName = () => {
    const id = props.tree.selected()
    return id === undefined ? undefined : props.tree.info(id)?.name
  }
  const row = (commit: {
    seq: number
    time: number
    renders: number
    updaters: number[]
  }) => {
    const names = commit.updaters.flatMap((id) => {
      const name = props.tree.info(id)?.name
      return name ? [name] : []
    })
    const parts = [
      `#${commit.seq}`,
      `${ago(props.now() - commit.time)} ago`,
      `${commit.renders} ${commit.renders === 1 ? "component" : "components"}`,
    ]
    if (names.length)
      parts.push(
        names.length > 1 ? `${names[0]} +${names.length - 1}` : `${names[0]}`,
      )
    return parts.join(" · ")
  }
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <div class="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2">
        <button
          type="button"
          aria-pressed={props.timeline.filtered()}
          disabled={selectedName() === undefined}
          class="rounded px-2 py-0.5 text-muted hover:text-fg disabled:opacity-40 aria-pressed:bg-selected aria-pressed:text-fg"
          onClick={() => props.timeline.setFiltered(!props.timeline.filtered())}
        >
          Only {selectedName() ?? "the selected component"}
        </button>
      </div>
      <Show
        when={props.timeline.commits().length}
        fallback={
          <p class="p-2 text-muted">
            No commits recorded since DevTools opened.
          </p>
        }
      >
        <div
          role="listbox"
          aria-label="Commits"
          tabIndex={0}
          aria-activedescendant={
            props.timeline.picked() === undefined
              ? undefined
              : optionId(props.timeline.picked() as number)
          }
          class="min-h-0 flex-1 overflow-auto font-mono focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
          // Clicks are handled once here, like the keys.
          onClick={(event) => {
            const option = (event.target as Element).closest("[role=option]")
            const seq = (option as HTMLElement | null)?.dataset.seq
            if (seq !== undefined) props.timeline.pick(Number(seq))
          }}
          onKeyDown={(event) => {
            if (!props.timeline.key(event.key, history())) return
            event.preventDefault()
            // DevTools opens its drawer on Escape.
            event.stopPropagation()
            const picked = props.timeline.picked()
            if (picked !== undefined)
              document
                .getElementById(optionId(picked))
                ?.scrollIntoView({ block: "nearest" })
          }}
        >
          <For each={props.timeline.shown(history())}>
            {(commit) => (
              <div
                role="option"
                id={optionId(commit.seq)}
                tabIndex={-1}
                data-seq={commit.seq}
                aria-selected={props.timeline.picked() === commit.seq}
                class="cursor-pointer truncate px-2 leading-5 hover:bg-surface aria-selected:bg-selected"
              >
                {row(commit)}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
