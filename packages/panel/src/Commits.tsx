import { For, Match, Show, Switch } from "solid-js"
import { ago } from "./ago"
import { KIND_TEXT, NodeLink } from "./Inspector"
import type { InspectorStore } from "./inspection"
import type { CommitDetail, TimelineStore } from "./timeline"
import type { TreeStore } from "./tree"
import { previewText } from "./value"

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
    // Side by side like Components; stacked when narrower than sm (640 px).
    <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="flex h-10 shrink-0 items-center gap-2 border-border border-b px-2">
          <button
            type="button"
            aria-pressed={props.timeline.filtered()}
            disabled={selectedName() === undefined}
            class="rounded px-2 py-0.5 text-muted hover:text-fg disabled:opacity-40 aria-pressed:bg-selected aria-pressed:text-fg"
            onClick={() =>
              props.timeline.setFiltered(!props.timeline.filtered())
            }
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
          <Show when={props.timeline.dropped()}>
            <p class="border-border border-t px-2 leading-6 text-muted">
              Older updates dropped (limit reached)
            </p>
          </Show>
        </Show>
      </div>
      <section
        data-testid="commit-detail"
        aria-label="Commit"
        class="min-h-0 min-w-0 flex-1 overflow-auto border-border border-t p-2 sm:border-t-0 sm:border-l"
      >
        <Switch>
          <Match when={props.timeline.picked() === undefined}>
            <p class="text-muted">
              Pick a commit to see what rendered and why.
            </p>
          </Match>
          <Match when={props.timeline.detail() === null}>
            <p class="text-muted">This commit is no longer recorded.</p>
          </Match>
          <Match when={props.timeline.detail()}>
            {(detail) => (
              <Detail
                detail={detail()}
                tree={props.tree}
                onReveal={props.onReveal}
              />
            )}
          </Match>
        </Switch>
      </section>
    </div>
  )
}

// What triggered a commit, each updater on its own line with the state it
// changed, then every component it rendered and why.
function Detail(props: {
  detail: CommitDetail
  tree: TreeStore
  onReveal: (id: number) => void
}) {
  const Name = (link: { id: number }) => (
    <Show
      when={props.tree.info(link.id)}
      fallback={<span class="text-muted">Unmounted</span>}
    >
      <NodeLink id={link.id} tree={props.tree} onReveal={props.onReveal} />
    </Show>
  )
  const HEADING = "pb-1 text-muted"
  return (
    <div class="flex flex-col gap-3 font-mono">
      <div>
        <h3 class={HEADING}>Triggered by</h3>
        <For
          each={props.detail.updaters}
          fallback={<p data-testid="commit-trigger">Unknown (a root render)</p>}
        >
          {(updater) => (
            <p data-testid="commit-trigger" class="break-words">
              <Name id={updater.id} />
              <Show when={updater.hooks.length}>
                {` (${updater.hooks
                  .map(
                    (hook) =>
                      `${hook.name}: ${previewText(hook.old)} → ${previewText(hook.new)}`,
                  )
                  .join(", ")})`}
              </Show>
            </p>
          )}
        </For>
      </div>
      <div>
        <h3 class={HEADING}>Rendered</h3>
        <For each={props.detail.renders}>
          {(render) => (
            <p data-testid="commit-render">
              <Name id={render.id} />{" "}
              <span class="text-muted">
                {render.kinds.map((kind) => KIND_TEXT[kind]).join(", ")}
              </span>
            </p>
          )}
        </For>
      </div>
    </div>
  )
}
