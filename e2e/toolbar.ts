import type { Browser, Page } from "puppeteer"
import type { BrowserName } from "./launch.ts"

export type Toolbar = { title: string; icon?: string }

declare const chrome: {
  tabs: {
    query(filter: object): Promise<{ id?: number }[]>
  }
  action: { getTitle(details: { tabId: number }): Promise<string> }
}

// The toolbar title and, in Firefox, the icon URL ReactDX shows for the page's tab.
// Chrome has no API to read an icon back.
export function toolbar(
  name: BrowserName,
  browser: Browser,
  page: Page,
): Promise<Toolbar> {
  return name === "chrome"
    ? chromeToolbar(browser, page)
    : firefoxToolbar(browser)
}

// Chrome: ReactDX's service worker, to evaluate extension APIs in.
export async function reactdxWorker(browser: Browser) {
  const target = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().endsWith("/background.js"),
  )
  const worker = await target.worker()
  if (!worker) throw new Error("no ReactDX service worker")
  return worker
}

async function chromeToolbar(browser: Browser, page: Page) {
  const worker = await reactdxWorker(browser)
  // Without the tabs permission a URL query matches nothing; the page under test is the active tab.
  await page.bringToFront()
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      windowType: "normal",
    })
    if (tab?.id === undefined) throw new Error("no active tab")
    return { title: await chrome.action.getTitle({ tabId: tab.id }) }
  })
}

type BidiResult = {
  contexts: { context: string }[]
  result: { type: string; value?: string }
}

// Raw WebDriver BiDi in the browser's chrome scope (needs MOZ_REMOTE_ALLOW_SYSTEM_ACCESS).
// Reads the selected tab's state; the page under test is selected.
async function firefoxToolbar(browser: Browser) {
  const connection = (
    browser as unknown as {
      connection: {
        send(method: string, params: object): Promise<{ result: BidiResult }>
      }
    }
  ).connection
  const tree = await connection.send("browsingContext.getTree", {
    "moz:scope": "chrome",
  })
  const { result } = await connection.send("script.evaluate", {
    // MV3 buttons sit in the extensions panel, whose nodes are built lazily, so read
    // the action's per-tab data that the button renders.
    expression: `(() => {
      const { ExtensionParent } = ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionParent.sys.mjs",
      )
      const policy = WebExtensionPolicy.getByID("reactdx@akxp.net")
      const action = policy && ExtensionParent.apiManager.global.browserActionFor(policy.extension)
      if (!action) return null
      const data = action.action.getContextData(gBrowser.selectedTab)
      return JSON.stringify({ title: data.title, icon: data.icon["16"] })
    })()`,
    target: { context: tree.result.contexts[0].context },
    awaitPromise: false,
  })
  if (result.result.type !== "string") throw new Error("no ReactDX action")
  return JSON.parse(result.result.value ?? "") as Toolbar
}
