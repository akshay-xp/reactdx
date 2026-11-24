import type { RendererView } from "@reactdx/messages"
import {
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import { Commits } from "./Commits"
import { Empty, EmptyAction } from "./Empty"
import { Inspector, type Settings } from "./Inspector"
import type { InspectorStore } from "./inspection"
import type { Sources } from "./source"
import { ReloadGlyph, Toolbar } from "./Toolbar"
import { TreeView } from "./TreeView"
import type { TimelineStore } from "./timeline"
import type { TreeStore } from "./tree"

// The tabs, by index.
const COMPONENTS = 0
const COMMITS = 1

const build = (bundleType: number) =>
  bundleType === 1 ? "development" : "production"

// Page data is only ever a text node: never markup.
// `stale`: the page loaded before ReactDX was installed or updated, so React never
// saw its hook; only a reload can connect it.
export function ConnectionList(props: {
  renderers: RendererView[]
  tree: TreeStore
  inspector: InspectorStore
  // Recent commits: with them, Components and Commits are tabs.
  timeline?: TimelineStore
  sources: Sources
  settings: Settings
  stale?: boolean
  onReload?: () => void
}) {
  const development = () => props.renderers.some((r) => r.bundleType === 1)
  const [tab, setTab] = createSignal(COMPONENTS)
  // Commit times are shown against this, a second at a time.
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(clock))
  // Side by side; stacked when the panel is narrower than sm (640 px).
  const split = () => (
    <div data-testid="split" class="flex min-h-0 flex-1 flex-col sm:flex-row">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <Toolbar tree={props.tree} />
        {/* The one scroller for every copy's trees, both ways; each TreeView
            renders the rows in this pane's view. The content is as wide as
            its widest row, so rows and the selection span it. */}
        <div data-testid="trees" class="min-h-0 flex-1 overflow-auto">
          <ul class="w-max min-w-full">
            <For each={props.renderers}>
              {(renderer) => (
                <li data-testid="renderer" class="border-border border-b p-2">
                  <h2>
                    <span class="font-mono">React {renderer.version}</span>{" "}
                    <span class="text-muted">{build(renderer.bundleType)}</span>{" "}
                    <span class="font-mono text-muted">
                      {renderer.rendererPackageName}
                    </span>
                  </h2>
                  <ul class="pl-4">
                    <For each={renderer.roots}>
                      {(root) => (
                        <li data-testid="root" data-commits={root.commits}>
                          <span>Root {root.id}</span>
                          <span class="pl-2 text-muted">
                            {root.commits} commits
                          </span>
                          <Show when={renderer.bundleType === 1}>
                            <TreeView tree={props.tree} rootId={root.id} />
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </li>
              )}
            </For>
          </ul>
        </div>
        <p class="border-border border-t px-2 leading-6 text-muted">
          Numbers: renders since DevTools opened
        </p>
      </div>
      <aside
        data-testid="inspector"
        aria-label="Inspector"
        class="flex min-h-0 min-w-0 flex-1 flex-col border-border border-t sm:border-t-0 sm:border-l"
      >
        <Inspector
          tree={props.tree}
          inspector={props.inspector}
          sources={props.sources}
          settings={props.settings}
          onRenders={() => {
            props.timeline?.setFiltered(true)
            setTab(COMMITS)
          }}
          onCommit={(seq) => {
            props.timeline?.pick(seq)
            setTab(COMMITS)
          }}
          onLatest={() => props.timeline?.live()}
        />
      </aside>
    </div>
  )
  return (
    <Switch>
      <Match when={props.renderers.length === 0 && props.stale}>
        <Empty
          icon={<ReloadGlyph />}
          title="Reload this page to inspect React."
          hint="It was open before ReactDX was installed or updated."
        >
          <EmptyAction
            icon={<ReloadGlyph />}
            onClick={() => props.onReload?.()}
          >
            Reload page
          </EmptyAction>
        </Empty>
      </Match>
      <Match when={props.renderers.length === 0}>
        <p class="p-2 text-muted">No React on this page</p>
      </Match>
      <Match when={!development()}>
        <p class="p-2 text-muted">
          Production build of React{" "}
          {[...new Set(props.renderers.map((r) => r.version))].join(", ")}.
          ReactDX inspects development builds.
        </p>
      </Match>
      <Match when={development()}>
        <Show when={props.timeline} fallback={split()}>
          {(timeline) => (
            <Tabs
              selected={tab()}
              onSelect={setTab}
              tabs={[
                { name: "Components", content: split() },
                {
                  name: "Commits",
                  content: (
                    <Commits
                      timeline={timeline()}
                      tree={props.tree}
                      inspector={props.inspector}
                      now={now}
                      onReveal={(id) => {
                        setTab(COMPONENTS)
                        props.tree.reveal(id)
                      }}
                    />
                  ),
                },
              ]}
            />
          )}
        </Show>
      </Match>
    </Switch>
  )
}

// Tabs inside the panel, each content kept mounted (hidden when another is
// selected) so it keeps its scroll and state. Left/Right move between tabs.
function Tabs(props: {
  tabs: { name: string; content: JSX.Element }[]
  selected: number
  onSelect: (index: number) => void
}) {
  const selected = () => props.selected
  const setSelected = (index: number) => props.onSelect(index)
  const id = (i: number) => `tab-${props.tabs[i]?.name.toLowerCase()}`
  const tabs: HTMLButtonElement[] = []
  return (
    <>
      <div
        role="tablist"
        aria-label="Views"
        class="flex shrink-0 border-border border-b px-1"
      >
        <For each={props.tabs}>
          {(tab, i) => (
            <button
              ref={(el) => {
                tabs[i()] = el
              }}
              type="button"
              role="tab"
              id={`${id(i())}-tab`}
              aria-controls={id(i())}
              aria-selected={selected() === i()}
              tabIndex={selected() === i() ? 0 : -1}
              class="-mb-px border-transparent border-b-2 px-2 py-1 text-muted hover:text-fg aria-selected:border-accent aria-selected:text-fg"
              onClick={() => setSelected(i())}
              onKeyDown={(event) => {
                const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
                if (by === undefined) return
                event.preventDefault()
                const to = (i() + by + props.tabs.length) % props.tabs.length
                setSelected(to)
                tabs[to]?.focus()
              }}
            >
              {tab.name}
            </button>
          )}
        </For>
      </div>
      <For each={props.tabs}>
        {(tab, i) => (
          <div
            role="tabpanel"
            id={id(i())}
            aria-labelledby={`${id(i())}-tab`}
            hidden={selected() !== i()}
            class="flex min-h-0 flex-1 flex-col"
          >
            {tab.content}
          </div>
        )}
      </For>
    </>
  )
}
