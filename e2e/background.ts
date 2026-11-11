import type { Browser } from "puppeteer"
import { chromeEval } from "./firefox.ts"
import type { BrowserName } from "./launch.ts"

const isReactdxWorker = (url: string) => url.endsWith("/background.js")

// Stops ReactDX's background (Chrome service worker, Firefox event page) the way
// the browser does when idle, and resolves once it has stopped.
export async function stopBackground(name: BrowserName, browser: Browser) {
  if (name === "chrome") {
    // The ServiceWorker domain lives on page sessions, not the browser's.
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    const session = await page.createCDPSession()
    await session.send("ServiceWorker.enable" as never)
    await session.send("ServiceWorker.stopAllWorkers" as never)
    const deadline = Date.now() + 5000
    while (
      browser
        .targets()
        .some((t) => t.type() === "service_worker" && isReactdxWorker(t.url()))
    ) {
      if (Date.now() > deadline) throw new Error("service worker still running")
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return
  }
  const state = await chromeEval(
    browser,
    `(async () => {
      const { extension } = WebExtensionPolicy.getByID("reactdx@akxp.net")
      await extension.terminateBackground()
      return String(extension.backgroundState)
    })()`,
  )
  if (state === "running") throw new Error("background still running")
}
