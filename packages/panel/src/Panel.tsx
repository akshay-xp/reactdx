import type { RendererView } from "@reactdx/messages"
import { ConnectionList } from "./ConnectionList"

export function Panel(props: { renderers: RendererView[] }) {
  return (
    <main
      data-testid="panel-root"
      class="min-h-screen bg-bg font-sans text-fg text-xs"
    >
      <ConnectionList renderers={props.renderers} />
    </main>
  )
}
