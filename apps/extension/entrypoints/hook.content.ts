import { rendererMessage } from "@reactdx/messages"
import { installHook } from "@reactdx/page"

export default defineContentScript({
  matches: ["<all_urls>"],
  world: "MAIN",
  runAt: "document_start",
  main: () =>
    installHook(window, (id, info) =>
      window.postMessage(rendererMessage(id, info), "*"),
    ),
})
