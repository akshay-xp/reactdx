import {
  type InjectAgentMessage,
  type RenderersMessage,
  toolbarIcons,
  toolbarState,
} from "@reactdx/messages"

// Browsers reset per-tab icons and titles on a new document, so a page
// without React keeps the manifest's "no React" default with no message.
export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: RenderersMessage | InjectAgentMessage, sender) => {
      const tabId = sender.tab?.id
      if (sender.frameId !== 0 || tabId === undefined) return
      if (message.type === "renderers") {
        const { icon, title } = toolbarState(message.renderers)
        browser.action.setIcon({ tabId, path: toolbarIcons(icon) })
        browser.action.setTitle({ tabId, title })
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
})
