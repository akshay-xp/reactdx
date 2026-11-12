import {
  type ClearHighlightMessage,
  type GetStateMessage,
  type HighlightMessage,
  type InjectAgentMessage,
  type ResyncMessage,
  type StateReply,
  type SubscribeMessage,
  type TabStateMessage,
  type TreeBatchMessage,
  toolbarIcons,
  toolbarState,
} from "@reactdx/messages"
import type { Browser } from "wxt/browser"

type Port = Browser.runtime.Port

// Holds only open ports, never page data: the content script owns the tab's
// state. Browsers reset per-tab icons and titles on a new document, so a page
// without React keeps the manifest's "no React" default.
export default defineBackground(() => {
  const panels = new Map<number, Set<Port>>()
  // Each watched tab's relay port, which carries its tree batches.
  const trees = new Map<number, Port>()

  browser.runtime.onMessage.addListener(
    (message: TabStateMessage | InjectAgentMessage, sender, sendResponse) => {
      const tabId = sender.tab?.id
      if (sender.frameId !== 0 || tabId === undefined) return
      if (message.type === "state") {
        const { icon, title } = toolbarState(message.renderers)
        browser.action.setIcon({ tabId, path: toolbarIcons(icon) })
        browser.action.setTitle({ tabId, title })
        for (const port of panels.get(tabId) ?? []) port.postMessage(message)
        // A panel opened before this document loaded: start its watch.
        sendResponse({ watch: panels.has(tabId) } satisfies StateReply)
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

  const connectTree = (port: Port) => {
    const tabId = port.sender?.tab?.id
    if (port.sender?.frameId !== 0 || tabId === undefined) return
    trees.get(tabId)?.disconnect()
    trees.set(tabId, port)
    port.onDisconnect.addListener(() => {
      if (trees.get(tabId) === port) trees.delete(tabId)
    })
    port.onMessage.addListener((batch: TreeBatchMessage) => {
      const ports = panels.get(tabId)
      if (!ports) return unwatch(tabId)
      for (const panel of ports) panel.postMessage(batch)
    })
  }

  // Disconnecting the relay's port is what tells it to stop watching.
  const unwatch = (tabId: number) => {
    trees.get(tabId)?.disconnect()
    trees.delete(tabId)
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "tree") return connectTree(port)
    if (port.name !== "panel") return
    port.onMessage.addListener(
      (
        message:
          | SubscribeMessage
          | ResyncMessage
          | HighlightMessage
          | ClearHighlightMessage,
      ) => {
        // Commands go to the tab's relay, which validates them (parseTreeCommand).
        const { tabId, ...command } = message
        if (message.type !== "subscribe") {
          trees.get(tabId)?.postMessage(command)
          return
        }
        const ports = panels.get(tabId) ?? new Set()
        panels.set(tabId, ports.add(port))
        port.onDisconnect.addListener(() => {
          ports.delete(port)
          if (ports.size) return
          panels.delete(tabId)
          unwatch(tabId)
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
      },
    )
  })
})
