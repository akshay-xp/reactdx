import {
  GET_SNAPSHOT,
  type GetStateMessage,
  type InjectAgentMessage,
  parsePageMessage,
  type RendererInfo,
  type RootInfo,
  type TabStateMessage,
  tabState,
} from "@reactdx/messages"

// Isolated world, top frame: forwards what the hook and agent report.
// Silent until React connects, except to answer an open panel.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const renderers = new Map<number, RendererInfo>()
    let roots: RootInfo[] = []
    let agentRequested = false
    const state = (): TabStateMessage => ({
      type: "state",
      renderers: tabState(renderers, roots),
    })

    window.addEventListener("message", (event) => {
      if (event.source !== window) return
      const message = parsePageMessage(event.data)
      if (!message) return
      if (message.type === "snapshot") roots = message.roots
      else {
        const { id, version, bundleType, rendererPackageName } = message
        renderers.set(id, { version, bundleType, rendererPackageName })
        if (bundleType === 1 && !agentRequested) {
          agentRequested = true
          browser.runtime.sendMessage({
            type: "inject-agent",
          } satisfies InjectAgentMessage)
        }
      }
      browser.runtime.sendMessage(state())
    })

    // Browsers reset the tab's icon on a history navigation, and a page restored from
    // bfcache runs no scripts, so re-announce what this document already has.
    window.addEventListener("pageshow", (event) => {
      if (event.persisted && renderers.size)
        browser.runtime.sendMessage(state())
    })

    browser.runtime.onMessage.addListener(
      (message: GetStateMessage, _, sendResponse) => {
        if (message.type !== "get-state") return
        // The agent answers with a snapshot, which the listener above forwards.
        if (agentRequested) window.postMessage(GET_SNAPSHOT, "*")
        sendResponse(state())
      },
    )
  },
})
