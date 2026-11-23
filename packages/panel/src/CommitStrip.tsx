import { createMemo, For } from "solid-js"
import type { TimelineStore } from "./timeline"
import type { TreeStore } from "./tree"

const BAR_HEIGHT = 20

// The recent commits, oldest at the left, then Live (docs/panel.md, Timeline).
// One tab stop: the strip holds focus and names the picked bar through
// aria-activedescendant; its keys go to the store.
export function CommitStrip(props: {
  timeline: TimelineStore
  tree: TreeStore
}) {
  const most = createMemo(() =>
    Math.max(1, ...props.timeline.commits().map((commit) => commit.renders)),
  )
  const optionId = (seq: number | undefined) =>
    seq === undefined ? "commit-live" : `commit-${seq}`
  const info = () => {
    const seq = props.timeline.picked()
    const commit = props.timeline.commits().find((c) => c.seq === seq)
    if (!commit) return "Live"
    const names = commit.updaters.flatMap((id) => {
      const name = props.tree.info(id)?.name
      return name ? [name] : []
    })
    const trigger = names.length
      ? `Triggered by ${names.join(", ")}`
      : "Triggered by: unknown"
    return `Commit ${commit.seq}: ${commit.renders} rendered. ${trigger}`
  }
  return (
    <div class="border-border border-b px-2 py-1">
      <div
        role="listbox"
        aria-label="Commits"
        aria-orientation="horizontal"
        tabIndex={0}
        aria-activedescendant={optionId(props.timeline.picked())}
        class="flex items-end gap-px focus-visible:outline-1 focus-visible:outline-accent"
        style={{ height: `${BAR_HEIGHT}px` }}
        // Clicks are handled once here, like the keys.
        onClick={(event) => {
          const option = (event.target as Element).closest("[role=option]")
          if (!option) return
          const seq = (option as HTMLElement).dataset.seq
          if (seq === undefined) props.timeline.live()
          else props.timeline.pick(Number(seq))
        }}
        onKeyDown={(event) => {
          if (!props.timeline.key(event.key)) return
          event.preventDefault()
          // DevTools opens its drawer on Escape.
          event.stopPropagation()
        }}
      >
        <For each={props.timeline.commits()}>
          {(commit) => (
            <div
              role="option"
              id={optionId(commit.seq)}
              aria-label={`Commit ${commit.seq}: ${commit.renders} rendered`}
              aria-selected={props.timeline.picked() === commit.seq}
              class="w-1.5 shrink-0 cursor-pointer bg-muted hover:bg-fg aria-selected:bg-accent"
              style={{
                height: `${Math.max(2, (commit.renders / most()) * BAR_HEIGHT)}px`,
              }}
              tabIndex={-1}
              data-seq={commit.seq}
            />
          )}
        </For>
        <div
          role="option"
          id={optionId(undefined)}
          aria-label="Live"
          aria-selected={props.timeline.picked() === undefined}
          tabIndex={-1}
          class="ml-1 cursor-pointer self-center text-muted aria-selected:text-accent"
        >
          Live
        </div>
      </div>
      <p data-testid="commit-info" class="truncate text-muted">
        {info()}
      </p>
    </div>
  )
}
