import {
  GET_SNAPSHOT,
  type GetStateMessage,
  type InjectAgentMessage,
  parseExpanded,
  parseInspected,
  parsePageMessage,
  parsePicked,
  parseTreeBatch,
  parseTreeCommand,
  parseValueStored,
  parseValueText,
  type RendererInfo,
  type RootInfo,
  type StateReply,
  type TabStateMessage,
  tabState,
  UNWATCH,
  WATCH,
} from "@reactdx/messages"
import type { Browser } from "wxt/browser"

// Isolated world, top frame: forwards what the hook and agent report.
// Silent until React connects, except to answer an open panel.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const renderers = new Map<number, RendererInfo>()
    let roots: RootInfo[] = []
    let agentRequested = false
    let agentSeen = false
    // Run at document_start, the page is still loading. Firefox also injects into
    // tabs already open at install, after their React loaded without the hook.
    const stale = document.readyState !== "loading"
    const state = (): TabStateMessage => ({
      type: "state",
      renderers: tabState(renderers, roots),
      stale,
    })

    // While a panel watches, tree batches flow over this port. It closes when the
    // last panel leaves, the background stops or the page enters bfcache; the
    // panel subscribing again (or a state reply) starts a new watch and resync.
    let tree: Browser.runtime.Port | undefined
    const stop = () => {
      tree = undefined
      window.postMessage(UNWATCH, "*")
    }
    const watch = () => {
      if (tree) return
      tree = browser.runtime.connect({ name: "tree" })
      tree.onDisconnect.addListener(stop)
      tree.onMessage.addListener((message: unknown) => {
        // A resync is a new watch; every other command goes to the agent as is.
        const command = parseTreeCommand(message)
        if (command?.type === "resync") window.postMessage(WATCH, "*")
        else if (command)
          window.postMessage({ source: "reactdx-relay", ...command }, "*")
      })
      window.postMessage(WATCH, "*")
    }
    // A prerendered document (Chrome loads pages it expects you to open, unless
    // DevTools is open) isn't in its tab yet, so the background can't act on what
    // it says. Hold every message until the document is shown.
    const shown = new Promise<void>((resolve) => {
      if (!(document as { prerendering?: boolean }).prerendering) resolve()
      else
        document.addEventListener("prerenderingchange", () => resolve(), {
          once: true,
        })
    })
    const send = () =>
      shown
        .then(() => browser.runtime.sendMessage(state()))
        .then((reply?: StateReply) => reply?.watch && watch())

    window.addEventListener("message", (event) => {
      if (event.source !== window) return
      // Batches, picks and inspections go to the panel over the tree port, unstored.
      const forward =
        parseTreeBatch(event.data) ??
        parsePicked(event.data) ??
        parseInspected(event.data) ??
        parseExpanded(event.data) ??
        parseValueText(event.data) ??
        parseValueStored(event.data)
      if (forward) {
        tree?.postMessage(forward)
        return
      }
      const message = parsePageMessage(event.data)
      if (!message) return
      if (message.type === "snapshot") {
        roots = message.roots
        // The agent can start after a watch was posted; its first snapshot says it's there.
        if (!agentSeen && tree) window.postMessage(WATCH, "*")
        agentSeen = true
      } else {
        const { id, version, bundleType, rendererPackageName } = message
        renderers.set(id, { version, bundleType, rendererPackageName })
        if (bundleType === 1 && !agentRequested) {
          agentRequested = true
          shown.then(() =>
            browser.runtime.sendMessage({
              type: "inject-agent",
            } satisfies InjectAgentMessage),
          )
        }
      }
      send()
    })

    // Browsers reset the tab's icon on a history navigation, and a page restored from
    // bfcache runs no scripts, so re-announce what this document already has.
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && renderers.size) send()
    })
    // Chrome closes the port when the page enters bfcache but delivers the disconnect
    // only after the restore, too late for pageshow's watch: close it ourselves.
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted || !tree) return
      tree.disconnect()
      stop()
    })

    browser.runtime.onMessage.addListener(
      (message: GetStateMessage, _, sendResponse) => {
        if (message.type !== "get-state") return
        // The agent answers with a snapshot, which the listener above forwards.
        if (agentRequested) {
          window.postMessage(GET_SNAPSHOT, "*")
          // A subscribing panel starts empty, so it always gets the whole tree.
          if (tree) window.postMessage(WATCH, "*")
          else watch()
        }
        sendResponse(state())
      },
    )
  },
})
