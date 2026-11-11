import { startAgent } from "@reactdx/page/agent"

export default defineUnlistedScript(() =>
  startAgent(window, (message) => window.postMessage(message, "*")),
)
