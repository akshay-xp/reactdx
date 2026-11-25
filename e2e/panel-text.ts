import type { Browser, Frame } from "puppeteer"
import { chromeEval } from "./firefox.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

// The panel's visible text, whitespace-normalized, read the same way in both browsers.
// end() presses End on each tree: a tree only renders the rows in view, so a big
// one (Next's) shows its last rows, where the app's components are, only then.
// hover(name) puts the pointer on
// the tree row with that name; leave() moves it off the trees. close() closes DevTools.
// press(name) clicks the button with that name (its text or aria-label) or the
// checkbox with that label, pressed(name)
// reads its aria-pressed, key(text, key) presses a key on a row or the commits
// list, tab(name) selects the panel tab with that name, commits() reads the
// commit rows as listed, selected() is the selected row's name, select(name) clicks the row with that name.
// The text leaves out the inspector pane; inspector() reads only that.
// frame is the panel's document (Chrome only: Firefox's is out of Puppeteer's reach).
export type PanelText = (() => Promise<string>) & {
  frame?: Frame
  inspector(): Promise<string>
  select(name: string): Promise<void>
  end(): Promise<void>
  hover(name: string): Promise<void>
  leave(): Promise<void>
  close(): Promise<void>
  press(name: string): Promise<void>
  pressed(name: string): Promise<boolean>
  // Whether that button is disabled, and its description (its title).
  described(name: string): Promise<{ disabled: boolean; description: string }>
  // Focuses the row (or the listbox) whose text or name includes `text` and
  // presses `key`.
  key(text: string, key: Key): Promise<void>
  // Selects the panel tab ("Components", "Commits") with that name.
  tab(name: string): Promise<void>
  // The commit rows' text, as listed (newest first).
  commits(): Promise<string[]>
  // Replaces the text of the input with that accessible name ("" empties it).
  type(label: string, text: string): Promise<void>
  // Edits the inspector value row reading `row`: opens its editor, enters `text`
  // and presses Enter.
  edit(row: string, text: string): Promise<void>
  selected(): Promise<string | undefined>
}

type Key =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "Escape"
const KEY_CODES: Record<Key, string> = {
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  Home: "HOME",
  End: "END",
  Escape: "ESCAPE",
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
    const text = async (inspector: boolean) =>
      normalize(
        await frame.evaluate((inspector) => {
          const pane = document.querySelector("[data-testid=inspector]")
          const root = inspector ? pane : document.body
          if (!root) return ""
          const texts: string[] = []
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            // A hidden tab isn't shown (nor in Firefox's accessibility tree).
            if (walker.currentNode.parentElement?.closest("[hidden]")) continue
            if (inspector || !pane?.contains(walker.currentNode))
              texts.push(walker.currentNode.textContent ?? "")
          }
          return texts.join(" ")
        }, inspector),
      )
    const read = () => text(false)
    const inspector = () => text(true)
    const end = async () => {
      for (const tree of await frame.$$("[data-testid=tree]")) {
        await tree.focus()
        await frame.page().keyboard.press("End")
      }
    }
    const row = async (name: string) => {
      for (const row of await frame.$$("[data-testid=name]"))
        if ((await row.evaluate((el) => el.textContent)) === name) return row
      throw new Error(`no row named ${name}`)
    }
    const hover = async (name: string) => (await row(name)).hover()
    // Found and clicked in one step: the tree re-renders rows as batches
    // arrive, and a row found in one round trip could be replaced before the
    // click's next ("detached", or "not clickable" once its box is gone; #68).
    // The tree selects on a click anywhere in the row.
    const select = async (name: string) => {
      const clicked = await frame.evaluate((name) => {
        const found = [
          ...document.querySelectorAll<HTMLElement>("[data-testid=name]"),
        ].find((el) => el.textContent === name)
        found?.click()
        return Boolean(found)
      }, name)
      if (!clicked) throw new Error(`no row named ${name}`)
    }
    // Onto the toolbar above the trees: CDP's synthetic moves out of the panel
    // frame fire no leave events inside it.
    const leave = async () => {
      await frame.hover("[data-testid=search]")
    }
    const close = () => frame.page().close()
    // A button by its name, or a checkbox by its label's text.
    const button = (name: string) =>
      `[...document.querySelectorAll("button, input[type=checkbox]")].find((el) => !el.closest("[hidden]") && (el.getAttribute("aria-label") ?? (el.labels?.[0] ?? el).textContent.trim()) === ${json(name)})`
    const press = async (name: string) => {
      await frame.evaluate(`${button(name)}.click()`)
    }
    const type = async (label: string, text: string) => {
      const input = `input[aria-label=${json(label)}]`
      await frame.click(input, { count: 3 })
      await frame.page().keyboard.press("Backspace")
      if (text) await frame.type(input, text)
    }
    const pressed = async (name: string) =>
      (await frame.evaluate(
        `${button(name)}.getAttribute("aria-pressed") === "true"`,
      )) as boolean
    const described = async (name: string) =>
      (await frame.evaluate(
        `(() => { const el = ${button(name)}; return { disabled: el.disabled, description: el.title } })()`,
      )) as { disabled: boolean; description: string }
    const edit = async (row: string, text: string) => {
      const value = await frame.waitForFunction(
        (row) =>
          [...document.querySelectorAll("[data-testid=value]")]
            .find((el) => el.textContent === row)
            ?.querySelector("[data-value]"),
        {},
        row,
      )
      await (value as unknown as { click(): Promise<void> }).click()
      const input = await frame.waitForSelector("[data-testid=value-input]")
      await input?.evaluate((el) => (el as HTMLInputElement).select())
      await frame.page().keyboard.type(text)
      await frame.page().keyboard.press("Enter")
    }
    const key = async (text: string, key: Key) => {
      // An exact name first (a section header named by its aria-label), then
      // any row whose text includes it.
      await frame.evaluate((text) => {
        const all = [
          ...document.querySelectorAll<HTMLElement>(
            "[role=treeitem], [role=listbox]",
          ),
        ]
        ;(
          all.find((el) => el.getAttribute("aria-label") === text) ??
          all.find((el) => el.textContent?.includes(text))
        )?.focus()
      }, text)
      await frame.page().keyboard.press(key)
    }
    const tab = async (name: string) => {
      await frame.evaluate(
        (name) =>
          (
            [...document.querySelectorAll("[role=tab]")].find(
              (el) => el.getAttribute("aria-label") === name,
            ) as HTMLElement | undefined
          )?.click(),
        name,
      )
    }
    const commits = () =>
      frame.evaluate(() =>
        [...document.querySelectorAll("[role=option]")].map((el) =>
          (el.textContent ?? "").trim(),
        ),
      )
    const selected = () =>
      frame.evaluate(
        () =>
          document.querySelector(
            "[data-testid=node][aria-selected=true] [data-testid=name]",
          )?.textContent ?? undefined,
      )
    return Object.assign(read, {
      frame,
      inspector,
      select,
      end,
      hover,
      leave,
      close,
      press,
      pressed,
      described,
      key,
      tab,
      commits,
      type,
      edit,
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
          // A tree re-rendered since the walk leaves a stale accessible, which
          // can't take focus: skip it; the next read's end() gets the new one.
          try {
            tree.takeFocus()
          } catch {
            continue
          }
          await new Promise((r) => setTimeout(r, 50))
          tip.keydown(key)
          tip.keyup(key)
        }
      })()`,
    )
  }
  // The inspector pane is the landmark named "Inspector".
  const text = async (inspector: boolean) =>
    normalize(
      (await chromeEval(
        browser,
        `(() => {
          ${panelBrowser}
          if (!panel) return "[no panel browser]"
          const texts = []
          const isPane = (node) =>
            node.role === Ci.nsIAccessibleRole.ROLE_LANDMARK && node.name === "Inspector"
          const walk = (node, inside) => {
            if (!node) return
            const here = inside || isPane(node)
            if (node.childCount === 0 && node.name && here === ${inspector}) texts.push(node.name)
            for (let i = 0; i < node.childCount; i++) walk(node.getChildAt(i), here)
          }
          const root = service.getAccessibleFor(panel)
          walk(root, false)
          if (${inspector}) return texts.join(" ")
          // No text: say what was there, so a failure explains itself.
          return texts.length
            ? texts.join(" ")
            : "[no panel text: url=" + panel.currentURI?.spec + " accessible=" + !!root + " children=" + (root?.childCount ?? 0) + "]"
        })()`,
      )) ?? "",
    )
  const read = () => text(false)
  const inspector = () => text(true)
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
  const rowName = (name: string) =>
    `node.role === Ci.nsIAccessibleRole.ROLE_TEXT_LEAF && node.name === ${json(name)} && node.parent?.parent?.role === Ci.nsIAccessibleRole.ROLE_OUTLINEITEM`
  const hover = (name: string) => pointAt(rowName(name))
  // The row's own click action: native clicks land by screen position, which can
  // lag behind a tree that just scrolled.
  const select = async (name: string) => {
    await onAccessible(
      rowName(name),
      `node.parent.parent.doAction(0); return "ok"`,
    )
  }
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
    `[${role("PUSHBUTTON")}, ${role("TOGGLE_BUTTON")}, ${role("CHECKBUTTON")}].includes(node.role) && node.name === ${json(name)}`
  // Like tabs, a button can be missing from the mirror for a moment.
  const press = async (name: string) => {
    for (const deadline = Date.now() + 5000; ; ) {
      const done = await onAccessible(
        button(name),
        `node.doAction(0); return "ok"`,
        false,
      )
      if (done) return
      if (Date.now() > deadline) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await onAccessible(button(name), `return "ok"`)
  }
  // The entry's editable text, which edits as typing does (input events fire).
  const type = async (label: string, text: string) => {
    await onAccessible(
      // type="search" is a SEARCHBOX where Firefox has that role, else an ENTRY.
      `[${role("ENTRY")}, ${role("SEARCHBOX")}].includes(node.role) && node.name === ${json(label)}`,
      `node.QueryInterface(Ci.nsIAccessibleEditableText).setTextContents(${json(text)})
      return "ok"`,
    )
  }
  // The row's accessible takes focus and gets a trusted Enter, which opens its
  // editor; the entry's text is set, then a second Enter applies it.
  const enter = `const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor)
      tip.beginInputTransactionForTests(window)
      const key = new KeyboardEvent("", { key: "Enter", code: "Enter", keyCode: KeyboardEvent.DOM_VK_RETURN })`
  const edit = async (row: string, text: string) => {
    // This row's editor: a focus that missed (a stale accessible) would open
    // the previously focused row's.
    const editor = `node.role !== ${role("TEXT_LEAF")} && node.name === ${json(`Edit ${row.slice(0, row.indexOf(":"))}`)}`
    const press = `return new Promise((r) => setTimeout(() => {
        tip.keydown(key)
        tip.keyup(key)
        r("ok")
      }, 50))`
    // The row can be re-rendered (a re-send) before its lookup, its focus or
    // the key (no row for a moment, a stale accessible whose takeFocus throws,
    // or a focus that went nowhere): find, focus and press again until the
    // editor shows.
    const deadline = Date.now() + 5000
    for (;;) {
      const focused = await onAccessible(
        `node.role === ${role("OUTLINEITEM")} && node.name === ${json(row)}`,
        `${enter}
        try {
          node.takeFocus()
        } catch {
          return null
        }
        ${press}`,
        false,
      )
      for (let i = 0; focused && i < 10; i++) {
        const done = await onAccessible(
          editor,
          `node.QueryInterface(Ci.nsIAccessibleEditableText).setTextContents(${json(text)})
          ${enter}
          ${press}`,
          false,
        )
        if (done) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (Date.now() > deadline) throw new Error(`no editor for ${row}`)
      if (!focused) await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  // The row's accessible takes focus, then a trusted key from the parent.
  const key = async (text: string, key: Key) => {
    // An exact name first (a section header), then any row that includes it.
    const rows = `[${role("OUTLINEITEM")}, ${role("LISTBOX")}].includes(node.role)`
    const exact = await onAccessible(
      `${rows} && node.name === ${json(text)}`,
      `return "found"`,
      false,
    )
    await onAccessible(
      exact
        ? `${rows} && node.name === ${json(text)}`
        : `${rows} && node.name?.includes(${json(text)})`,
      `node.takeFocus()
      const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor)
      tip.beginInputTransactionForTests(window)
      const event = new KeyboardEvent("", { key: ${json(key)}, code: ${json(key)}, keyCode: KeyboardEvent.DOM_VK_${KEY_CODES[key]} })
      return new Promise((r) => setTimeout(() => {
        tip.keydown(event)
        tip.keyup(event)
        r("ok")
      }, 50))`,
    )
  }
  // Firefox mirrors the panel's accessibility tree a moment late: after a
  // navigation the tabs can be missing from it briefly, so it's tried again.
  const tab = async (name: string) => {
    const match = `node.role === ${role("PAGETAB")} && node.name === ${json(name)}`
    for (const deadline = Date.now() + 5000; ; ) {
      const done = await onAccessible(
        match,
        `node.doAction(0); return "ok"`,
        false,
      )
      if (done || Date.now() > deadline) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await onAccessible(match, `return "ok"`)
  }
  const commits = async () =>
    JSON.parse(
      (await chromeEval(
        browser,
        `(() => {
          ${panelBrowser}
          if (!panel) return "[]"
          const rows = []
          const walk = (node) => {
            if (!node) return
            if (node.role === ${role("OPTION")}) rows.push(node.name ?? "")
            for (let i = 0; i < node.childCount; i++) walk(node.getChildAt(i))
          }
          walk(service.getAccessibleFor(panel))
          return JSON.stringify(rows)
        })()`,
      )) ?? "[]",
    ) as string[]
  const pressed = async (name: string) =>
    (await onAccessible(
      button(name),
      `const state = {}, extra = {}
      node.getState(state, extra)
      return String((state.value & Ci.nsIAccessibleStates.STATE_PRESSED) !== 0)`,
    )) === "true"
  const described = async (name: string) =>
    JSON.parse(
      (await onAccessible(
        button(name),
        `const state = {}, extra = {}
        node.getState(state, extra)
        return JSON.stringify({
          disabled: (state.value & Ci.nsIAccessibleStates.STATE_UNAVAILABLE) !== 0,
          description: node.description,
        })`,
      )) as string,
    ) as { disabled: boolean; description: string }
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
    inspector,
    select,
    end,
    hover,
    leave,
    close,
    press,
    pressed,
    described,
    key,
    tab,
    commits,
    type,
    edit,
    selected,
  })
}

const json = JSON.stringify

export type Copy = { heading: string; commits: number[]; names: string[] }

const HEADING = /React (\S+) (development|production) (\S+)/g
const ROOT = /Root \d+ (\d+) updates/g
const LEGEND = "Numbers: renders since DevTools opened"
// The legend bar's hidden-internals count and toggle (Next pages).
const HIDDEN = / · \d+ Next\.js components (hidden|shown) (Show|Hide)/
// A Suspense row's wait chip (M7 #80): not a name.
const WAIT = / (waiting|arrived in) \d+(\.\d)?( ms|s)/g

// "React 18.3.1 development react-dom Root 1 3 commits App Counter 2 ..." into
// copies: each root's commit count, and the component names listed under its
// roots (not the rows' render counts or Suspense waits, nor the legend and
// hidden count under the trees).
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
      names: segment
        .replace(ROOT, " ")
        .replace(LEGEND, " ")
        .replace(HIDDEN, " ")
        .replace(WAIT, " ")
        .split(" ")
        .filter((name) => name && !/^\d+$/.test(name)),
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

// Selects a component once the tree lists it (a new page's tree fills in; End
// shows a tall tree's last rows, where Next's components are), then waits until
// its inspector passes `check` and returns that text. A navigation can drop the
// selection, even after it showed: the new document's first watch resets the
// tree, and Firefox can report the navigation (which clears the tree) late. So
// a lost selection is made again, until 15 s.
export async function selectListed(
  panel: PanelText,
  component: string,
  check: (text: string) => boolean = () => true,
) {
  const deadline = Date.now() + 15_000
  let text = ""
  while (Date.now() < deadline) {
    // End only when the row isn't listed yet: it selects the last row, and
    // Firefox can deliver it after the select below, replacing the
    // Inspector under a press (#68).
    const listed = (t: string) =>
      parseCopies(t).some((c) => c.names.includes(component))
    await until(async () => {
      const shown = await panel()
      if (listed(shown)) return shown
      await panel.end()
      return panel()
    }, listed)
    await panel.select(component)
    const lost = (t: string) => t.startsWith("Select a component")
    text = await until(
      panel.inspector,
      (t) => lost(t) || (t.startsWith(`${component} `) && check(t)),
      5000,
    )
    if (text.startsWith(`${component} `) && check(text)) return text
  }
  throw new Error(`${component}'s inspector never passed the check: ${text}`)
}
