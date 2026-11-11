import type { RendererView } from "@reactdx/messages"
import { For, Match, Switch } from "solid-js"

const build = (bundleType: number) =>
  bundleType === 1 ? "development" : "production"

// Page data is only ever a text node: never markup.
export function ConnectionList(props: { renderers: RendererView[] }) {
  const development = () => props.renderers.some((r) => r.bundleType === 1)
  return (
    <Switch>
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
        <ul>
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
                      </li>
                    )}
                  </For>
                </ul>
              </li>
            )}
          </For>
        </ul>
      </Match>
    </Switch>
  )
}
