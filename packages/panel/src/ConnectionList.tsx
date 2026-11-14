import type { RendererView } from "@reactdx/messages"
import { For, Match, Show, Switch } from "solid-js"
import { Empty, EmptyAction } from "./Empty"
import { Inspector, type Settings } from "./Inspector"
import type { InspectorStore } from "./inspection"
import type { Sources } from "./source"
import { Toolbar } from "./Toolbar"
import { TreeView } from "./TreeView"
import type { TreeStore } from "./tree"

const build = (bundleType: number) =>
  bundleType === 1 ? "development" : "production"

// A circular arrow, inside a 24-unit svg (Glyph).
function ReloadGlyph() {
  return (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 6.2" />
      <path d="M20 4v7h-7" />
    </>
  )
}

// Page data is only ever a text node: never markup.
// `stale`: the page loaded before ReactDX was installed or updated, so React never
// saw its hook; only a reload can connect it.
export function ConnectionList(props: {
  renderers: RendererView[]
  tree: TreeStore
  inspector: InspectorStore
  sources: Sources
  settings: Settings
  stale?: boolean
  onReload?: () => void
}) {
  const development = () => props.renderers.some((r) => r.bundleType === 1)
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
        {/* Side by side; stacked when the panel is narrower than sm (640 px). */}
        <div
          data-testid="split"
          class="flex min-h-0 flex-1 flex-col sm:flex-row"
        >
          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <Toolbar tree={props.tree} />
            {/* The one scroller for every copy's trees, both ways; each TreeView
                renders the rows in this pane's view. The content is as wide as
                its widest row, so rows and the selection span it. */}
            <div data-testid="trees" class="min-h-0 flex-1 overflow-auto">
              <ul class="w-max min-w-full">
                <For each={props.renderers}>
                  {(renderer) => (
                    <li
                      data-testid="renderer"
                      class="border-border border-b p-2"
                    >
                      <h2>
                        <span class="font-mono">React {renderer.version}</span>{" "}
                        <span class="text-muted">
                          {build(renderer.bundleType)}
                        </span>{" "}
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
            />
          </aside>
        </div>
      </Match>
    </Switch>
  )
}
