import type { CommitRender, CommitSummary } from "@reactdx/messages"
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js"
import { ago } from "./ago"
import { KIND_TEXT, NodeLink } from "./Inspector"
import type { InspectorStore } from "./inspection"
import { durationText } from "./size"
import type { CommitDetail, TimelineStore, UpdateRow } from "./timeline"
import type { TreeStore } from "./tree"
import { previewText } from "./value"
import { Triangle } from "./values"

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
  const optionId = (seq: number) => `update-${seq}`
  const selectedName = () => {
    const id = props.tree.selected()
    return id === undefined ? undefined : props.tree.info(id)?.name
  }
  const when = (commit: CommitSummary) =>
    `${ago(props.now() - commit.time)} ago`
  const changeText = (commit: CommitSummary) =>
    commit.change
      ? `${previewText(commit.change.old)} → ${previewText(commit.change.new)}`
      : undefined
  // A commit that showed boundaries' content (M7 #81): the first, and how
  // many more.
  const arrivedText = (commit: CommitSummary) => {
    const [first, ...more] = commit.arrived ?? []
    if (!first) return
    const also = more.length ? ` +${more.length}` : ""
    return `Data arrived · ${first.name} boundary · waited ${durationText(first.waited)}${also}`
  }
  // Who caused it: the first updater the tree knows, and how many more.
  const cause = (commit: CommitSummary) => {
    if (!commit.updaters.length) return arrivedText(commit) ?? "Root render"
    const [first] = commit.updaters
    const name =
      (first !== undefined && props.tree.info(first)?.name) ?? "Unmounted"
    const more =
      commit.updaters.length > 1 ? ` +${commit.updaters.length - 1}` : ""
    const change = changeText(commit)
    return `${name}${change ? `: ${change}` : ""}${more}`
  }
  const cost = (commit: CommitSummary) =>
    [
      `${commit.renders} ${commit.renders === 1 ? "render" : "renders"}`,
      ...(commit.wasted ? [`${commit.wasted} wasted`] : []),
      when(commit),
    ].join(" · ")
  // A group or waterfall row's id, toggled open by setGroup.
  const groupId = (row: Exclude<UpdateRow, { kind: "update" }>) =>
    row.kind === "group" ? row.id : row.waterfall.id
  // A row's two lines: what happened, then what it cost.
  const lines = (row: UpdateRow): [string, string] => {
    if (row.kind === "group") {
      const [newest] = row.commits as [CommitSummary]
      const name = cause({ ...newest, change: undefined })
      return [
        `${name} · ${row.commits.length} updates`,
        [...(row.wasted ? [`${row.wasted} wasted`] : []), when(newest)].join(
          " · ",
        ),
      ]
    }
    if (row.kind === "waterfall") return ["Waterfall", ""]
    const first = row.member
      ? (changeText(row.commit) ?? cause(row.commit))
      : cause(row.commit)
    return [first, cost(row.commit)]
  }
  return (
    // Side by side like Components; stacked when narrower than sm (640 px).
    <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="flex h-10 shrink-0 items-center gap-1 border-border border-b px-2">
          <Toggle
            pressed={!props.timeline.filtered() && !props.timeline.wasted()}
            onClick={() => {
              props.timeline.setFiltered(false)
              props.timeline.setWasted(false)
            }}
          >
            All
          </Toggle>
          <Toggle
            pressed={props.timeline.wasted()}
            onClick={() => props.timeline.setWasted(!props.timeline.wasted())}
          >
            With wasted renders
          </Toggle>
          <Toggle
            pressed={props.timeline.filtered()}
            disabled={selectedName() === undefined}
            onClick={() =>
              props.timeline.setFiltered(!props.timeline.filtered())
            }
          >
            Only {selectedName() ?? "the selected component"}
          </Toggle>
          <button
            type="button"
            class="ml-auto rounded px-2 py-0.5 text-muted hover:text-fg"
            onClick={() => props.timeline.clearUpdates()}
          >
            Clear
          </button>
        </div>
        <Show
          when={props.timeline.commits().length}
          fallback={
            <p class="p-2 text-muted">No updates since DevTools opened.</p>
          }
        >
          <div
            role="listbox"
            aria-label="Updates"
            tabIndex={0}
            aria-activedescendant={
              props.timeline.picked() === undefined
                ? undefined
                : optionId(props.timeline.picked() as number)
            }
            class="min-h-0 flex-1 overflow-auto font-mono focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
            // Clicks are handled once here, like the keys.
            onClick={(event) => {
              const option = (event.target as Element).closest<HTMLElement>(
                "[role=option]",
              )
              const { seq, group } = option?.dataset ?? {}
              if (seq !== undefined) props.timeline.pick(Number(seq))
              else if (group !== undefined)
                props.timeline.setGroup(
                  Number(group),
                  option?.dataset.open !== "true",
                )
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
            <For each={props.timeline.rows(history())}>
              {(row) => {
                const [what, cost] = lines(row)
                return row.kind !== "update" ? (
                  <div
                    role="option"
                    id={`group-${groupId(row)}`}
                    tabIndex={-1}
                    data-group={groupId(row)}
                    aria-selected={false}
                    // A listbox option has no aria-expanded: the triangle
                    // shows it, the text says how many.
                    data-open={row.open}
                    class="cursor-pointer px-2 py-0.5 hover:bg-surface"
                  >
                    <span data-testid="line" class="flex items-center gap-1">
                      <Triangle open={row.open} />
                      <span class="truncate">{what}</span>
                    </span>
                    <span data-testid="line" class="block truncate text-muted">
                      {cost}
                    </span>
                  </div>
                ) : (
                  <div
                    role="option"
                    id={optionId(row.commit.seq)}
                    tabIndex={-1}
                    data-seq={row.commit.seq}
                    aria-selected={props.timeline.picked() === row.commit.seq}
                    class="cursor-pointer py-0.5 pr-2 hover:bg-surface aria-selected:bg-selected"
                    classList={{ "pl-6": row.member, "pl-2": !row.member }}
                  >
                    <span data-testid="line" class="block truncate">
                      {what}
                    </span>
                    <span data-testid="line" class="block truncate text-muted">
                      {cost}
                    </span>
                  </div>
                )
              }}
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
        aria-label="Update"
        class="min-h-0 min-w-0 flex-1 overflow-auto border-border border-t p-2 sm:border-t-0 sm:border-l"
      >
        <Switch>
          <Match when={props.timeline.picked() === undefined}>
            <p class="text-muted">
              Pick an update to see what rendered and why.
            </p>
          </Match>
          <Match when={props.timeline.detail() === null}>
            <p class="text-muted">This update is no longer recorded.</p>
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

// Rendered only because its parent did.
const isWasted = (render: CommitRender) =>
  render.kinds.length === 1 && render.kinds[0] === "parent"

// A line of "What rendered": one render, or `count` same-named siblings
// with the same reasons, at its depth in the cascade.
type Cascaded = { render: CommitRender; count: number; depth: number }

// The renders as the tree they cascaded down: each under the nearest
// ancestor that also rendered, in the page's order; runs of same-named
// siblings with the same reasons fold into one line.
function cascade(renders: CommitRender[], tree: TreeStore) {
  const rendered = new Set(renders.map((render) => render.id))
  const children = new Map<number | undefined, CommitRender[]>()
  for (const render of renders) {
    let parent = tree.parentOf(render.id)
    while (parent !== undefined && !rendered.has(parent))
      parent = tree.parentOf(parent)
    children.set(parent, [...(children.get(parent) ?? []), render])
  }
  const name = (id: number) => tree.info(id)?.name
  const out: Cascaded[] = []
  const visit = (list: CommitRender[], depth: number) => {
    for (let at = 0; at < list.length; ) {
      const first = list[at] as CommitRender
      let end = at + 1
      while (
        end < list.length &&
        name(first.id) !== undefined &&
        name((list[end] as CommitRender).id) === name(first.id) &&
        (list[end] as CommitRender).kinds.join() === first.kinds.join()
      )
        end++
      out.push({ render: first, count: end - at, depth })
      // A folded run's own renders aren't followed: one line stands for all.
      if (end - at === 1) visit(children.get(first.id) ?? [], depth + 1)
      at = end
    }
  }
  visit(children.get(undefined) ?? [], 0)
  return out
}

// A filter button: pressed while it applies.
function Toggle(props: {
  pressed: boolean
  disabled?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      class="rounded px-2 py-0.5 text-muted hover:text-fg disabled:opacity-40 aria-pressed:bg-selected aria-pressed:text-fg"
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  )
}

// An update's cause (each updater, with the state it set), what it cost, and
// what rendered as a cascade; renders with no reason of their own hide
// behind one line unless asked for.
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
  const [hide, setHide] = createSignal(true)
  const wasted = () => props.detail.renders.filter(isWasted).length
  const shown = () =>
    hide()
      ? props.detail.renders.filter((render) => !isWasted(render))
      : props.detail.renders
  const cost = () => {
    const all = props.detail.renders.length
    return `${all} ${all === 1 ? "component" : "components"} rendered · ${all - wasted()} had a reason, ${wasted()} only because a parent rendered`
  }
  return (
    <div class="flex flex-col gap-3 font-mono">
      <div class="flex flex-col gap-1">
        <For
          each={props.detail.updaters}
          fallback={<p data-testid="commit-trigger">Root render</p>}
        >
          {(updater) => (
            <p data-testid="commit-trigger" class="break-words">
              <Name id={updater.id} />
              {updater.hooks.length
                ? ` set ${updater.hooks
                    .map(
                      (hook) =>
                        `${hook.name}: ${previewText(hook.old)} → ${previewText(hook.new)}`,
                    )
                    .join(", ")}`
                : " updated"}
            </p>
          )}
        </For>
        <p data-testid="commit-cost" class="text-muted">
          {cost()}
        </p>
      </div>
      <div>
        <div class="flex items-center gap-2 pb-1">
          <h3 class="text-muted">What rendered</h3>
          <label class="ml-auto flex items-center gap-1 text-muted">
            <input
              type="checkbox"
              checked={hide()}
              onChange={(event) => setHide(event.currentTarget.checked)}
            />
            Hide renders with no reason
          </label>
        </div>
        <For each={cascade(shown(), props.tree)}>
          {(line) => (
            <p
              data-testid="commit-render"
              data-depth={line.depth}
              style={{ "padding-left": `${line.depth * 12}px` }}
            >
              <Name id={line.render.id} />
              {line.count > 1 && ` ×${line.count}`}{" "}
              <span class="text-muted">
                {line.render.kinds.map((kind) => KIND_TEXT[kind]).join(", ")}
              </span>
            </p>
          )}
        </For>
        <Show when={hide() && wasted()}>
          <p data-testid="commit-hidden" class="text-muted">
            {wasted()} wasted, hidden
          </p>
        </Show>
      </div>
    </div>
  )
}
