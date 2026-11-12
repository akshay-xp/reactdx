import type {
  ClearHighlightMessage,
  ExpandedMessage,
  HighlightMessage,
  InspectedMessage,
  PickedMessage,
  PickMessage,
  RendererView,
  ResyncMessage,
  SubscribeMessage,
  TabStateMessage,
  TreeBatchMessage,
} from "@reactdx/messages"
import { Panel } from "@reactdx/panel"
import { openInEditor } from "@reactdx/panel/editor"
import { createInspectorStore } from "@reactdx/panel/inspection"
import { createSourceResolver, type Sources } from "@reactdx/panel/source"
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
const [stale, setStale] = createSignal(false)
const tree = createTreeStore()
const tabId = browser.devtools.inspectedWindow.tabId
// Its commands go over the current port, which the background routes to the tab.
const inspector = createInspectorStore((command) =>
  port.postMessage({ ...command, tabId }),
)
// Requests go only to the inspected page's own server (docs/panel.md, Sources).
const editor = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  // Firefox resolves to [result, exception]; Chrome before 151 only calls back.
  origin: async () => {
    const page = browser.devtools.inspectedWindow
    if (import.meta.env.FIREFOX) {
      const [origin] = (await page.eval("location.origin")) as unknown as [
        string,
      ]
      return origin
    }
    return new Promise<string>((resolve) =>
      page.eval<string>("location.origin", (...[origin]) =>
        resolve(String(origin)),
      ),
    )
  },
  // The Clipboard API needs a focused document, which a DevTools panel often isn't.
  copy: (text: string) => {
    const area = document.createElement("textarea")
    area.value = text
    document.body.append(area)
    area.select()
    document.execCommand("copy")
    area.remove()
  },
}
const sources: Sources = {
  resolve: createSourceResolver(editor.fetch),
  open: (location) => openInEditor(location, editor),
}
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
  next.onMessage.addListener(
    (
      message:
        | TabStateMessage
        | TreeBatchMessage
        | PickedMessage
        | InspectedMessage
        | ExpandedMessage,
    ) => {
      if (message.type === "state") {
        setRenderers(message.renderers)
        setStale(message.stale ?? false)
      } else if (message.type === "picked") tree.picked(message.id)
      else if (message.type === "inspected") inspector.receive(message)
      else if (message.type === "expanded") inspector.receiveExpanded(message)
      else {
        if (tree.apply(message))
          next.postMessage({ type: "resync", tabId } satisfies ResyncMessage)
        // A new watch (reconnect, reload) starts the agent without a selection.
        else if (
          message.ops[0]?.op === "reset" &&
          tree.selected() !== undefined
        )
          inspector.resend()
      }
    },
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
  setStale(false)
  tree.clear()
  subscribe(port)
})

render(() => {
  createEffect(
    on(tree.selected, (id) => inspector.inspect(id), { defer: true }),
  )
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
  createEffect(
    on(
      tree.picking,
      (active) =>
        port.postMessage({
          type: active ? "pick-start" : "pick-stop",
          tabId,
        } satisfies PickMessage),
      { defer: true },
    ),
  )
  return (
    <Panel
      renderers={renderers()}
      tree={tree}
      inspector={inspector}
      sources={sources}
      stale={stale()}
      onReload={() => browser.devtools.inspectedWindow.reload({})}
    />
  )
}, document.getElementById("app") as HTMLElement)
