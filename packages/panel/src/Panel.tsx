import type { RendererView } from "@reactdx/messages"
import { ConnectionList } from "./ConnectionList"
import type { TreeStore } from "./tree"

export function Panel(props: { renderers: RendererView[]; tree: TreeStore }) {
  return (
    <main
      data-testid="panel-root"
      class="min-h-screen bg-bg font-sans text-fg text-xs"
    >
      <ConnectionList renderers={props.renderers} tree={props.tree} />
    </main>
  )
}
