import { parsePageMessage, type RenderersMessage } from "@reactdx/messages"
import type { RendererInfo } from "@reactdx/page"

// Isolated world, top frame: forwards what the hook reports. Silent until React connects.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const renderers = new Map<number, RendererInfo>()
    window.addEventListener("message", (event) => {
      if (event.source !== window) return
      const message = parsePageMessage(event.data)
      if (!message) return
      const { id, version, bundleType, rendererPackageName } = message
      renderers.set(id, { version, bundleType, rendererPackageName })
      browser.runtime.sendMessage({
        type: "renderers",
        renderers: [...renderers.values()],
      } satisfies RenderersMessage)
    })
  },
})
