import {
  type GetStateMessage,
  type InjectAgentMessage,
  type SubscribeMessage,
  type TabStateMessage,
  toolbarIcons,
  toolbarState,
} from "@reactdx/messages"
import type { Browser } from "wxt/browser"

type Port = Browser.runtime.Port

// Holds only the open panels' ports, never page data: the content script owns
// the tab's state. Browsers reset per-tab icons and titles on a new document,
// so a page without React keeps the manifest's "no React" default.
export default defineBackground(() => {
  const panels = new Map<number, Set<Port>>()

  browser.runtime.onMessage.addListener(
    (message: TabStateMessage | InjectAgentMessage, sender) => {
      const tabId = sender.tab?.id
      if (sender.frameId !== 0 || tabId === undefined) return
      if (message.type === "state") {
        const { icon, title } = toolbarState(message.renderers)
        browser.action.setIcon({ tabId, path: toolbarIcons(icon) })
        browser.action.setTitle({ tabId, title })
        for (const port of panels.get(tabId) ?? []) port.postMessage(message)
      }
      if (message.type === "inject-agent") {
        // Chrome can pin the sender's document, so a navigation in between can't redirect it.
        const { documentId } = sender as { documentId?: string }
        browser.scripting.executeScript({
          target: documentId
            ? { tabId, documentIds: [documentId] }
            : { tabId, frameIds: [0] },
          world: "MAIN",
          files: ["/agent.js"],
        })
      }
    },
  )

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "panel") return
    port.onMessage.addListener(({ tabId }: SubscribeMessage) => {
      const ports = panels.get(tabId) ?? new Set()
      panels.set(tabId, ports.add(port))
      port.onDisconnect.addListener(() => {
        ports.delete(port)
        if (!ports.size) panels.delete(tabId)
      })
      // No content script (a browser page) means no React.
      browser.tabs
        .sendMessage(tabId, { type: "get-state" } satisfies GetStateMessage, {
          frameId: 0,
        })
        .then(
          (state: TabStateMessage) => port.postMessage(state),
          () =>
            port.postMessage({
              type: "state",
              renderers: [],
            } satisfies TabStateMessage),
        )
    })
  })
})
