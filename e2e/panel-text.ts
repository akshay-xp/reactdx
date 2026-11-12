import type { Browser } from "puppeteer"
import { chromeEval } from "./firefox.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

// The panel's visible text, whitespace-normalized, read the same way in both browsers.
// end() presses End on each tree: a tree only renders the rows in view, so a big
// one (Next's) shows its last rows, where the app's components are, only then.
// check(label) clicks the checkbox with that label.
export type PanelText = (() => Promise<string>) & {
  end(): Promise<void>
  check(label: string): Promise<void>
}

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
    const read = async () =>
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
    const end = async () => {
      for (const tree of await frame.$$("[data-testid=tree]")) {
        await tree.focus()
        await frame.page().keyboard.press("End")
      }
    }
    const check = async (label: string) => {
      await frame.evaluate((label) => {
        const box = [
          ...document.querySelectorAll<HTMLInputElement>(
            "input[type=checkbox]",
          ),
        ].find((el) => el.closest("label")?.textContent?.trim() === label)
        if (!box) throw new Error(`no checkbox labelled ${label}`)
        box.click()
      }, label)
    }
    return Object.assign(read, { end, check })
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
      // The toolbox's tool list, not its tab DOM: in a narrow window (xvfb on CI)
      // the last tabs move into an overflow menu and aren't rendered as tabs.
      for (let i = 0; i < 100; i++) {
        const tool = toolbox.getAdditionalTools().find((t) => t.label === "ReactDX")
        if (tool) {
          await toolbox.selectTool(tool.id)
          return tool.id
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      return null
    })()`,
  )
  if (!selected) throw new Error("no ReactDX tab in Firefox DevTools")
  // The panel's <browser> and the accessibility service, in chrome scope.
  const panelBrowser = `
    const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs")
    const { gDevTools } = require("devtools/client/framework/devtools")
    const toolbox = gDevTools.getToolboxForTab(gBrowser.selectedTab)
    const iframe = toolbox?.doc.getElementById(${JSON.stringify(`toolbox-panel-iframe-${selected}`)})
    const panel = iframe?.contentDocument?.querySelector("browser")
    const service = Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService)`
  // Focus goes through each tree's accessible (the panel's DOM is in another
  // process); the key is a trusted one, from the parent's TextInputProcessor.
  const end = async () => {
    await chromeEval(
      browser,
      `(async () => {
        ${panelBrowser}
        if (!panel) return
        const trees = []
        const walk = (node) => {
          if (!node) return
          if (node.role === Ci.nsIAccessibleRole.ROLE_OUTLINE) trees.push(node)
          for (let i = 0; i < node.childCount; i++) walk(node.getChildAt(i))
        }
        walk(service.getAccessibleFor(panel))
        const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor)
        tip.beginInputTransactionForTests(window)
        const key = new KeyboardEvent("", { key: "End", code: "End", keyCode: KeyboardEvent.DOM_VK_END })
        for (const tree of trees) {
          tree.takeFocus()
          await new Promise((r) => setTimeout(r, 50))
          tip.keydown(key)
          tip.keyup(key)
        }
      })()`,
    )
  }
  // The checkbox's accessible, found by its name; its action 0 is a click.
  const check = async (label: string) => {
    const result = await chromeEval(
      browser,
      `(() => {
        ${panelBrowser}
        if (!panel) return "no panel browser"
        const find = (node) => {
          if (!node) return null
          if (node.role === Ci.nsIAccessibleRole.ROLE_CHECKBUTTON && node.name === ${JSON.stringify(label)}) return node
          for (let i = 0; i < node.childCount; i++) {
            const found = find(node.getChildAt(i))
            if (found) return found
          }
          return null
        }
        const box = find(service.getAccessibleFor(panel))
        if (!box) return "no checkbox labelled " + ${JSON.stringify(label)}
        box.doAction(0)
        return "ok"
      })()`,
    )
    if (result !== "ok") throw new Error(result ?? "check failed")
  }
  const read = async () =>
    normalize(
      (await chromeEval(
        browser,
        `(() => {
          ${panelBrowser}
          if (!panel) return "[no panel browser]"
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
  return Object.assign(read, { end, check })
}

export type Copy = { heading: string; commits: number[]; names: string[] }

const HEADING = /React (\S+) (development|production) (\S+)/g
const ROOT = /Root \d+ (\d+) commits/g

// "React 18.3.1 development react-dom Root 1 3 commits App Counter ..." into copies:
// each root's commit count, and the component names listed under its roots.
export function parseCopies(text: string): Copy[] {
  const headings = [...text.matchAll(HEADING)]
  return headings.map((match, i) => {
    const start = (match.index ?? 0) + match[0].length
    const rest = text.slice(start, headings[i + 1]?.index ?? text.length)
    // Ends at any other "React ..." heading too, even one this pattern can't parse
    // (a forged version with spaces): component names are never "React".
    const end = rest.search(/(^| )React /)
    const segment = end === -1 ? rest : rest.slice(0, end)
    return {
      heading: match[0],
      commits: [...segment.matchAll(ROOT)].map(([, n]) => Number(n)),
      names: segment.replace(ROOT, " ").split(" ").filter(Boolean),
    }
  })
}

// Polls the panel until the check passes; returns the last text read.
export async function until(
  read: () => Promise<string>,
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
