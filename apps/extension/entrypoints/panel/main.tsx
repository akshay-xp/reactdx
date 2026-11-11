import type {
  RendererView,
  SubscribeMessage,
  TabStateMessage,
} from "@reactdx/messages"
import { Panel } from "@reactdx/panel"
import { applyTheme, defaultTheme, type Theme } from "@reactdx/panel/themes"
import { createTreeStore } from "@reactdx/panel/tree"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { Browser } from "wxt/browser"
import "@reactdx/panel/index.css"
import { getTheme, onThemeChanged } from "./theme"

const apply = (theme: Theme) => applyTheme(theme, document.documentElement)
apply(defaultTheme(getTheme()))
onThemeChanged((kind) => apply(defaultTheme(kind)))

const [renderers, setRenderers] = createSignal<RendererView[]>([])
const tree = createTreeStore()
const subscribe = (port: Browser.runtime.Port) =>
  port.postMessage({
    type: "subscribe",
    tabId: browser.devtools.inspectedWindow.tabId,
  } satisfies SubscribeMessage)

// The port drops whenever the background stops (an idle service worker); connecting
// again wakes it, and subscribing asks the page's relay for the current state.
let port = connect()
function connect() {
  const next = browser.runtime.connect({ name: "panel" })
  next.onMessage.addListener((message: TabStateMessage) =>
    setRenderers(message.renderers),
  )
  next.onDisconnect.addListener(() => {
    port = connect()
  })
  subscribe(next)
  return next
}

// A new document starts empty: show only what it reports.
browser.devtools.network.onNavigated.addListener(() => {
  setRenderers([])
  subscribe(port)
})

render(
  () => <Panel renderers={renderers()} tree={tree} />,
  document.getElementById("app") as HTMLElement,
)
