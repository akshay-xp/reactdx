import type {
  ClearHighlightMessage,
  HighlightMessage,
  RendererView,
  ResyncMessage,
  SubscribeMessage,
  TabStateMessage,
  TreeBatchMessage,
} from "@reactdx/messages"
import { Panel } from "@reactdx/panel"
import { applyTheme, defaultTheme, type Theme } from "@reactdx/panel/themes"
import { createTreeStore } from "@reactdx/panel/tree"
import { createEffect, createSignal, on } from "solid-js"
import { render } from "solid-js/web"
import type { Browser } from "wxt/browser"
import "@reactdx/panel/index.css"
import { getTheme, onThemeChanged } from "./theme"

const apply = (theme: Theme) => applyTheme(theme, document.documentElement)
apply(defaultTheme(getTheme()))
onThemeChanged((kind) => apply(defaultTheme(kind)))

const [renderers, setRenderers] = createSignal<RendererView[]>([])
const tree = createTreeStore()
const tabId = browser.devtools.inspectedWindow.tabId
// The mark times the first rows (e2e/perf.test.ts).
const subscribe = (port: Browser.runtime.Port) => {
  performance.mark("reactdx:subscribe")
  port.postMessage({ type: "subscribe", tabId } satisfies SubscribeMessage)
}

// The port drops whenever the background stops (an idle service worker); connecting
// again wakes it, and subscribing asks the page's relay for the current state.
let port = connect()
function connect() {
  const next = browser.runtime.connect({ name: "panel" })
  next.onMessage.addListener((message: TabStateMessage | TreeBatchMessage) => {
    if (message.type === "state") setRenderers(message.renderers)
    else if (tree.apply(message))
      next.postMessage({ type: "resync", tabId } satisfies ResyncMessage)
  })
  next.onDisconnect.addListener(() => {
    port = connect()
  })
  subscribe(next)
  return next
}

// A new document starts empty: show only what it reports.
browser.devtools.network.onNavigated.addListener(() => {
  setRenderers([])
  tree.clear()
  subscribe(port)
})

render(() => {
  // The hovered row is highlighted on the page, until the pointer leaves the tree.
  createEffect(
    on(
      tree.hovered,
      (id) =>
        port.postMessage(
          id === undefined
            ? ({
                type: "clear-highlight",
                tabId,
              } satisfies ClearHighlightMessage)
            : ({ type: "highlight", tabId, id } satisfies HighlightMessage),
        ),
      { defer: true },
    ),
  )
  return <Panel renderers={renderers()} tree={tree} />
}, document.getElementById("app") as HTMLElement)
