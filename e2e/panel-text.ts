import type { Browser } from "puppeteer"
import { chromeEval } from "./firefox.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

// The panel's visible text, whitespace-normalized, read the same way in both browsers.
// end() presses End on each tree: a tree only renders the rows in view, so a big
// one (Next's) shows its last rows, where the app's components are, only then.
// hover(name) puts the pointer on
// the tree row with that name; leave() moves it off the trees. close() closes DevTools.
// press(name) clicks the button with that name (its text or aria-label), pressed(name)
// reads its aria-pressed,
// selected() is the selected row's name.
export type PanelText = (() => Promise<string>) & {
  end(): Promise<void>
  hover(name: string): Promise<void>
  leave(): Promise<void>
  close(): Promise<void>
  press(name: string): Promise<void>
  pressed(name: string): Promise<boolean>
  selected(): Promise<string | undefined>
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
    const hover = async (name: string) => {
      const rows = await frame.$$("[data-testid=name]")
      for (const row of rows)
        if ((await row.evaluate((el) => el.textContent)) === name)
          return row.hover()
      throw new Error(`no row named ${name}`)
    }
    // Onto the toolbar above the trees: CDP's synthetic moves out of the panel
    // frame fire no leave events inside it.
    const leave = async () => {
      await frame.hover("[data-testid=search]")
    }
    const close = () => frame.page().close()
    const button = (name: string) =>
      `[...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") ?? el.textContent.trim()) === ${json(name)})`
    const press = async (name: string) => {
      await frame.evaluate(`${button(name)}.click()`)
    }
    const pressed = async (name: string) =>
      (await frame.evaluate(
        `${button(name)}.getAttribute("aria-pressed") === "true"`,
      )) as boolean
    const selected = () =>
      frame.evaluate(
        () =>
          document.querySelector(
            "[data-testid=node][aria-selected=true] [data-testid=name]",
          )?.textContent ?? undefined,
      )
    return Object.assign(read, {
      end,
      hover,
      leave,
      close,
      press,
      pressed,
      selected,
    })
  }
  // Firefox runs the panel in an extension process Puppeteer can't reach, but its
  // accessibility tree is mirrored into the parent process, where chrome scope can read it.
  const toolId = await chromeEval(
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
  if (!toolId) throw new Error("no ReactDX tab in Firefox DevTools")
  // The panel's <browser> and the accessibility service, in chrome scope.
  const panelBrowser = `
    const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs")
    const { gDevTools } = require("devtools/client/framework/devtools")
    const toolbox = gDevTools.getToolboxForTab(gBrowser.selectedTab)
    const iframe = toolbox?.doc.getElementById(${JSON.stringify(`toolbox-panel-iframe-${toolId}`)})
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
  // Runs `action` (JS returning a string) on the first accessible `match` (a JS
  // expression over `node`) accepts. Throws when none matches, unless `required`
  // is false, which returns null instead.
  const onAccessible = async (
    match: string,
    action: string,
    required = true,
  ) => {
    const missing = `nothing matches ${match}`
    const result = await chromeEval(
      browser,
      `(() => {
        ${panelBrowser}
        if (!panel) return ${json(missing)}
        const find = (node) => {
          if (!node) return null
          if (${match}) return node
          for (let i = 0; i < node.childCount; i++) {
            const found = find(node.getChildAt(i))
            if (found) return found
          }
          return null
        }
        const node = find(service.getAccessibleFor(panel))
        if (!node) return ${json(missing)}
        ${action}
      })()`,
    )
    if (result === missing && !required) return null
    if (result === missing) throw new Error(missing)
    return result
  }
  // A native mouse move to the middle of the accessible's screen bounds (device
  // pixels, as getBounds gives them): the panel's DOM is in another process.
  const pointAt = async (match: string) => {
    await onAccessible(
      match,
      `const x = {}, y = {}, w = {}, h = {}
      node.getBounds(x, y, w, h)
      const utils = window.windowUtils
      utils.sendNativeMouseEvent(
        x.value + w.value / 2,
        y.value + h.value / 2,
        utils.NATIVE_MOUSE_MESSAGE_MOVE,
        0, 0,
        document.documentElement,
        null,
      )
      return "ok"`,
    )
  }
  // A row's name is a text leaf inside a tree item.
  const hover = (name: string) =>
    pointAt(
      `node.role === Ci.nsIAccessibleRole.ROLE_TEXT_LEAF && node.name === ${json(name)} && node.parent?.parent?.role === Ci.nsIAccessibleRole.ROLE_OUTLINEITEM`,
    )
  const leave = () =>
    pointAt(
      `node.name === "Search components" && node.role !== Ci.nsIAccessibleRole.ROLE_TEXT_LEAF`,
    )
  const close = async () => {
    await chromeEval(
      browser,
      `(async () => {
        const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs")
        const { gDevTools } = require("devtools/client/framework/devtools")
        await gDevTools.closeToolboxForTab(gBrowser.selectedTab)
      })()`,
    )
  }
  const role = (name: string) => `Ci.nsIAccessibleRole.ROLE_${name}`
  const button = (name: string) =>
    `(node.role === ${role("PUSHBUTTON")} || node.role === ${role("TOGGLE_BUTTON")}) && node.name === ${json(name)}`
  const press = async (name: string) => {
    await onAccessible(button(name), `node.doAction(0); return "ok"`)
  }
  const pressed = async (name: string) =>
    (await onAccessible(
      button(name),
      `const state = {}, extra = {}
      node.getState(state, extra)
      return String((state.value & Ci.nsIAccessibleStates.STATE_PRESSED) !== 0)`,
    )) === "true"
  // The selected tree item's first text leaf: its name (the toggle has no text).
  const selected = async () =>
    (await onAccessible(
      `node.role === ${role("OUTLINEITEM")} && (() => {
        const state = {}, extra = {}
        node.getState(state, extra)
        return (state.value & Ci.nsIAccessibleStates.STATE_SELECTED) !== 0
      })()`,
      `const leaf = (at) => {
        if (at.role === ${role("TEXT_LEAF")}) return at
        for (let i = 0; i < at.childCount; i++) {
          const found = leaf(at.getChildAt(i))
          if (found) return found
        }
        return null
      }
      return leaf(node)?.name ?? null`,
      false,
    )) ?? undefined
  return Object.assign(read, {
    end,
    hover,
    leave,
    close,
    press,
    pressed,
    selected,
  })
}

const json = JSON.stringify

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
