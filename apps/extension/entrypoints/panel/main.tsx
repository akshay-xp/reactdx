import type {
  ClearHighlightMessage,
  CommitsMessage,
  CommittedMessage,
  CountsMessage,
  ExpandedMessage,
  HighlightMessage,
  InspectedMessage,
  OutlinesMessage,
  PickedMessage,
  PickMessage,
  ReasonedMessage,
  RendererView,
  ResyncMessage,
  SubscribeMessage,
  TabStateMessage,
  TreeBatchMessage,
  ValueStoredMessage,
  ValueTextMessage,
} from "@reactdx/messages"
import { Panel } from "@reactdx/panel"
import { openInEditor } from "@reactdx/panel/editor"
import { followElements } from "@reactdx/panel/elements"
import { createInspectorStore } from "@reactdx/panel/inspection"
import { createHookNamer } from "@reactdx/panel/names"
import { createSettings } from "@reactdx/panel/settings"
import { createSourceResolver, type Sources } from "@reactdx/panel/source"
import { applyTheme, defaultTheme, type Theme } from "@reactdx/panel/themes"
import { createTimelineStore } from "@reactdx/panel/timeline"
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
const inspector = createInspectorStore(
  (command) => port.postMessage({ ...command, tabId }),
  (text) => editor.copy(text),
)
const timeline = createTimelineStore(
  (command) => port.postMessage({ ...command, tabId }),
  inspector,
)
// Code run in the inspected page. Firefox resolves to [result, exception];
// Chrome before 151 only calls back.
const evaluate = async <T,>(code: string): Promise<T> => {
  const page = browser.devtools.inspectedWindow
  if (import.meta.env.FIREFOX) {
    const [result] = (await page.eval(code)) as unknown as [T]
    return result
  }
  return new Promise<T>((resolve) =>
    page.eval<T>(code, (...[result]) => resolve(result as T)),
  )
}
const elements = followElements({
  onSelectionChanged: browser.devtools.panels.elements.onSelectionChanged,
  evaluate,
})
// Requests go only to the inspected page's own server (docs/panel.md, Sources).
const editor = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  origin: async () => String(await evaluate<string>("location.origin")),
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
  resolve: createSourceResolver(editor.fetch, editor.origin),
  open: (location) => openInEditor(location, editor),
  hookName: createHookNamer(editor.fetch),
}
// Kept across panel opens.
const settings = createSettings({
  get: () =>
    browser.storage.local
      .get("hookNames")
      .then((stored) => stored.hookNames as boolean | undefined),
  set: (on) => {
    browser.storage.local.set({ hookNames: on })
  },
})
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
        | ExpandedMessage
        | ReasonedMessage
        | CommitsMessage
        | CommittedMessage
        | CountsMessage
        | ValueTextMessage
        | ValueStoredMessage,
    ) => {
      if (message.type === "state") {
        setRenderers(message.renderers)
        setStale(message.stale ?? false)
      } else if (message.type === "picked") tree.picked(message.id)
      else if (message.type === "inspected") inspector.receive(message)
      else if (message.type === "expanded") inspector.receiveExpanded(message)
      else if (message.type === "reasoned") inspector.receiveReasoned(message)
      else if (message.type === "commits") timeline.receiveCommits(message)
      else if (message.type === "counts") tree.receiveCounts(message)
      else if (message.type === "committed") timeline.receiveCommitted(message)
      else if (message.type === "value-text")
        inspector.receiveValueText(message)
      else if (message.type === "value-stored")
        inspector.receiveValueStored(message)
      else {
        // A new watch: the page sends its commits again after the tree.
        if (message.ops[0]?.op === "reset") timeline.reset()
        // A new document's agent starts with outlines off.
        const mode = tree.outlines()
        if (message.ops[0]?.op === "reset" && mode)
          next.postMessage({
            type: "outlines",
            tabId,
            mode,
          } satisfies OutlinesMessage)
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
  timeline.clear()
  subscribe(port)
})

render(() => {
  createEffect(
    // A group row (a negative id) has nothing to inspect.
    on(
      tree.selected,
      (id) => inspector.inspect(id !== undefined && id > 0 ? id : undefined),
      { defer: true },
    ),
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
  createEffect(
    on(
      tree.outlines,
      (mode) =>
        port.postMessage({
          type: "outlines",
          tabId,
          mode: mode ?? null,
        } satisfies OutlinesMessage),
      { defer: true },
    ),
  )
  return (
    <Panel
      renderers={renderers()}
      tree={tree}
      inspector={inspector}
      timeline={timeline}
      sources={sources}
      settings={settings}
      stale={stale()}
      onReload={() => browser.devtools.inspectedWindow.reload({})}
      onShowElement={elements.show}
    />
  )
}, document.getElementById("app") as HTMLElement)
