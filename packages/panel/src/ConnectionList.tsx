import type { RendererView } from "@reactdx/messages"
import { For, Match, Show, Switch } from "solid-js"
import { Inspector } from "./Inspector"
import type { InspectorStore } from "./inspection"
import type { Sources } from "./source"
import { Toolbar } from "./Toolbar"
import { TreeView } from "./TreeView"
import type { TreeStore } from "./tree"

const build = (bundleType: number) =>
  bundleType === 1 ? "development" : "production"

// Page data is only ever a text node: never markup.
// `stale`: the page loaded before ReactDX was installed or updated, so React never
// saw its hook; only a reload can connect it.
export function ConnectionList(props: {
  renderers: RendererView[]
  tree: TreeStore
  inspector: InspectorStore
  sources: Sources
  stale?: boolean
  onReload?: () => void
}) {
  const development = () => props.renderers.some((r) => r.bundleType === 1)
  return (
    <Switch>
      <Match when={props.renderers.length === 0 && props.stale}>
        <div class="flex flex-col items-start gap-2 p-2">
          <p class="text-muted">
            This page was open before ReactDX was installed or updated. Reload
            it to inspect React.
          </p>
          <button
            type="button"
            class="rounded-md bg-surface px-2 py-0.5 text-fg hover:bg-selected"
            onClick={() => props.onReload?.()}
          >
            Reload page
          </button>
        </div>
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
          <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <Toolbar tree={props.tree} />
            <ul>
              <For each={props.renderers}>
                {(renderer) => (
                  <li data-testid="renderer" class="border-border border-b p-2">
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
          <aside
            data-testid="inspector"
            aria-label="Inspector"
            class="flex min-h-0 min-w-0 flex-1 flex-col border-border border-t sm:border-t-0 sm:border-l"
          >
            <Inspector
              tree={props.tree}
              inspector={props.inspector}
              sources={props.sources}
            />
          </aside>
        </div>
      </Match>
    </Switch>
  )
}
