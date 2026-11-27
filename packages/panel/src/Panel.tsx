import type { RendererView } from "@reactdx/messages"
import { ConnectionList } from "./ConnectionList"
import type { Settings } from "./Inspector"
import type { InspectorStore } from "./inspection"
import type { Sources } from "./source"
import type { TimelineStore } from "./timeline"
import type { TreeStore } from "./tree"

export function Panel(props: {
  renderers: RendererView[]
  tree: TreeStore
  inspector: InspectorStore
  timeline?: TimelineStore
  sources: Sources
  settings: Settings
  stale?: boolean
  onReload?: () => void
  onShowElement?: (id: number) => void
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
        timeline={props.timeline}
        sources={props.sources}
        settings={props.settings}
        stale={props.stale}
        onReload={props.onReload}
        onShowElement={props.onShowElement}
      />
    </main>
  )
}
