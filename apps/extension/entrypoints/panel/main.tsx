import type {
  RendererView,
  SubscribeMessage,
  TabStateMessage,
} from "@reactdx/messages"
import { Panel } from "@reactdx/panel"
import { applyTheme, defaultTheme, type Theme } from "@reactdx/panel/themes"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@reactdx/panel/index.css"
import { getTheme, onThemeChanged } from "./theme"

const apply = (theme: Theme) => applyTheme(theme, document.documentElement)
apply(defaultTheme(getTheme()))
onThemeChanged((kind) => apply(defaultTheme(kind)))

const [renderers, setRenderers] = createSignal<RendererView[]>([])
// The port drops whenever the background stops (an idle service worker); connecting
// again wakes it, and subscribing asks the page's relay for the current state.
function connect() {
  const port = browser.runtime.connect({ name: "panel" })
  port.onMessage.addListener((message: TabStateMessage) =>
    setRenderers(message.renderers),
  )
  port.onDisconnect.addListener(connect)
  port.postMessage({
    type: "subscribe",
    tabId: browser.devtools.inspectedWindow.tabId,
  } satisfies SubscribeMessage)
}
connect()

render(
  () => <Panel renderers={renderers()} />,
  document.getElementById("app") as HTMLElement,
)
