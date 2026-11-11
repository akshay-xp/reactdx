import {
  type RenderersMessage,
  toolbarIcons,
  toolbarState,
} from "@reactdx/messages"

// Browsers reset per-tab icons and titles on a new document, so a page
// without React keeps the manifest's "no React" default with no message.
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: RenderersMessage, sender) => {
    const tabId = sender.tab?.id
    if (
      message.type !== "renderers" ||
      sender.frameId !== 0 ||
      tabId === undefined
    )
      return
    const { icon, title } = toolbarState(message.renderers)
    browser.action.setIcon({ tabId, path: toolbarIcons(icon) })
    browser.action.setTitle({ tabId, title })
  })
})
