import type { RendererView } from "@reactdx/messages"
import { ConnectionList } from "./ConnectionList"
import type { InspectorStore } from "./inspection"
import type { TreeStore } from "./tree"

export function Panel(props: {
  renderers: RendererView[]
  tree: TreeStore
  inspector: InspectorStore
  stale?: boolean
  onReload?: () => void
}) {
  return (
    <main
      data-testid="panel-root"
      class="flex h-screen flex-col bg-bg font-sans text-fg text-xs"
    >
      <ConnectionList
        renderers={props.renderers}
        tree={props.tree}
        inspector={props.inspector}
        stale={props.stale}
        onReload={props.onReload}
      />
    </main>
  )
}
