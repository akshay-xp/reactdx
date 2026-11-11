import type { Browser } from "puppeteer"
import { chromeEval } from "./firefox.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

// The panel's visible text, whitespace-normalized, read the same way in both browsers.
export type PanelText = () => Promise<string>

// Text pieces are joined with spaces (the accessibility tree splits text differently
// from the DOM), so drop the space that lands before punctuation.
const normalize = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .trim()

// Selects the ReactDX tab in the open DevTools and returns a reader for its text.
export async function openPanelText(
  name: BrowserName,
  browser: Browser,
): Promise<PanelText> {
  if (name === "chrome") {
    const frame = await openPanel(browser)
    return async () =>
      normalize(
        await frame.evaluate(() => {
          const texts: string[] = []
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
          )
          while (walker.nextNode())
            texts.push(walker.currentNode.textContent ?? "")
          return texts.join(" ")
        }),
      )
  }
  // Firefox runs the panel in an extension process Puppeteer can't reach, but its
  // accessibility tree is mirrored into the parent process, where chrome scope can read it.
  const selected = await chromeEval(
    browser,
    `(async () => {
      const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs")
      const { gDevTools } = require("devtools/client/framework/devtools")
      const toolbox = gDevTools.getToolboxForTab(gBrowser.selectedTab) ??
        await gDevTools.showToolboxForTab(gBrowser.selectedTab)
      for (let i = 0; i < 100; i++) {
        const tab = [...toolbox.doc.querySelectorAll(".devtools-tab")]
          .find((t) => t.textContent.trim() === "ReactDX")
        if (tab) {
          const id = tab.id.replace(/^toolbox-tab-/, "")
          await toolbox.selectTool(id)
          return id
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      return null
    })()`,
  )
  if (!selected) throw new Error("no ReactDX tab in Firefox DevTools")
  return async () =>
    normalize(
      (await chromeEval(
        browser,
        `(() => {
          const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs")
          const { gDevTools } = require("devtools/client/framework/devtools")
          const toolbox = gDevTools.getToolboxForTab(gBrowser.selectedTab)
          const iframe = toolbox?.doc.getElementById(${JSON.stringify(`toolbox-panel-iframe-${selected}`)})
          const panel = iframe?.contentDocument?.querySelector("browser")
          if (!panel) return "[no panel browser]"
          const service = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService)
          const texts = []
          const walk = (node) => {
            if (!node) return
            if (node.childCount === 0 && node.name) texts.push(node.name)
            for (let i = 0; i < node.childCount; i++) walk(node.getChildAt(i))
          }
          const root = service.getAccessibleFor(panel)
          walk(root)
          // No text: say what was there, so a failure explains itself.
          return texts.length
            ? texts.join(" ")
            : "[no panel text: url=" + panel.currentURI?.spec + " accessible=" + !!root + " children=" + (root?.childCount ?? 0) + "]"
        })()`,
      )) ?? "",
    )
}

export type Copy = { heading: string; commits: number[] }

// "React 18.3.1 development react-dom Root 1 3 commits ..." into copies.
export function parseCopies(text: string): Copy[] {
  return [
    ...text.matchAll(
      /React (\S+) (development|production) (\S+)((?: Root \d+ \d+ commits)*)/g,
    ),
  ].map(([, version, build, pkg, roots]) => ({
    heading: `React ${version} ${build} ${pkg}`,
    commits: [...(roots ?? "").matchAll(/(\d+) commits/g)].map(([, n]) =>
      Number(n),
    ),
  }))
}

// Polls the panel until the check passes; returns the last text read.
export async function until(
  read: PanelText,
  check: (text: string) => boolean,
  timeout = 5000,
) {
  const deadline = Date.now() + timeout
  for (;;) {
    const text = await read()
    if (check(text) || Date.now() > deadline) return text
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export const total = (copies: Copy[]) =>
  copies.flatMap((c) => c.commits).reduce((a, b) => a + b, 0)

// Launches with ReactDX and opens the panel before or after the page loads.
// One tab, so DevTools has one window.
export async function panelFor(
  name: BrowserName,
  url: string,
  order: "before" | "after",
) {
  const { browser } = await launchWithExtension(name)
  const [page] = await browser.pages()
  if (!page) throw new Error("no page")
  let panel: PanelText | undefined
  if (order === "before") panel = await openPanelText(name, browser)
  await page.goto(url)
  if (order === "after") panel = await openPanelText(name, browser)
  if (!panel) throw new Error("no panel")
  return { browser, page, panel }
}
