import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { SELECT_CODE } from "../packages/panel/src/elements.ts"
import type { BrowserName } from "./launch.ts"
import { type PanelText, panelFor, parseCopies, until } from "./panel-text.ts"
import { overlayPage, waitForOverlays } from "./shadows.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"
const URL_18 = "http://localhost:5218"
const PICK = "Pick element"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

// Polls an async check until it holds or 5 s pass; returns the last value. A
// read that throws is retried: Firefox replaces a button's accessible as it
// re-renders (pressed), so it's missing for a moment.
async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      const value = await read()
      if (done(value) || Date.now() > deadline) return value
    } catch (error) {
      if (Date.now() > deadline) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function pickerOn(panel: PanelText) {
  const text = await until(panel, (t) =>
    (parseCopies(t)[0]?.names ?? []).includes("Counter"),
  )
  assert.ok(parseCopies(text)[0]?.names.includes("Counter"), text)
  await panel.press(PICK)
  assert.equal(await poll(() => panel.pressed(PICK), Boolean), true)
}

test("a pick selects the clicked component and doesn't click the page", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_18, "after")
  try {
    await page.waitForSelector("[data-testid=counter]")
    await pickerOn(panel)
    await page.click("[data-testid=counter]")
    assert.equal(await poll(panel.selected, (s) => s === "Counter"), "Counter")
    assert.equal(
      await page.$eval("[data-testid=counter]", (el) => el.textContent),
      "Count: 0",
    )
    assert.equal(
      await poll(
        () => panel.pressed(PICK),
        (p) => !p,
      ),
      false,
    )
  } finally {
    await browser.close()
  }
})

test("Escape cancels the picker and its highlight", { skip }, async () => {
  const { browser, page, panel } = await overlayPage(name, URL_18)
  try {
    await pickerOn(panel)
    await page.hover("[data-testid=counter]")
    await waitForOverlays(page, 1)
    await page.keyboard.press("Escape")
    await waitForOverlays(page, 0)
    assert.equal(
      await poll(
        () => panel.pressed(PICK),
        (p) => !p,
      ),
      false,
    )
    assert.equal(await panel.selected(), undefined)
  } finally {
    await browser.close()
  }
})

// The Elements panel (#92). Puppeteer can't select a node there, so the select
// code runs in the page as inspectedWindow.eval would, with its $0.
const selectInElements = (page: import("puppeteer").Page, selector: string) =>
  page.evaluate(
    (code, selector) =>
      new Function("$0", `return ${code}`)(document.querySelector(selector)),
    SELECT_CODE,
    selector,
  )

test("a node selected in the Elements panel selects its component", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_18, "after")
  try {
    await until(panel, (t) =>
      (parseCopies(t)[0]?.names ?? []).includes("Counter"),
    )
    await selectInElements(page, "[data-testid=counter]")
    assert.equal(await poll(panel.selected, (s) => s === "Counter"), "Counter")
  } finally {
    await browser.close()
  }
})

test("Show in Elements panel reveals the element, and its selection there keeps the component", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_18, "after")
  try {
    await until(panel, (t) =>
      (parseCopies(t)[0]?.names ?? []).includes("Counter"),
    )
    await selectInElements(page, "[data-testid=counter]")
    await poll(panel.selected, (s) => s === "Counter")
    // What the panel's evals asked, as the agent answered them.
    await page.evaluate(() => {
      const w = window as unknown as { __elements: string[] }
      w.__elements = []
      window.addEventListener("reactdx-elements", (event) => {
        const { selected, element } = (event as CustomEvent).detail
        w.__elements.push(
          selected
            ? `selected ${selected.dataset?.testid}`
            : `revealed ${element?.dataset?.testid}`,
        )
      })
    })
    // Enabled once the inspection says Counter has DOM.
    const SHOW = "Show in Elements panel"
    await poll(
      () => panel.described(SHOW),
      (d) => !d.disabled,
    )
    await panel.press(SHOW)
    const read = () =>
      page.evaluate(
        () => (window as unknown as { __elements: string[] }).__elements,
      )
    assert.deepEqual(await poll(read, (e) => e.length >= 2), [
      "revealed counter",
      "selected counter",
    ])
    // Firefox: inspect() brought its Inspector to the front.
    const before = await panel.show()
    if (name === "firefox") assert.equal(before, "inspector")
    assert.equal(await poll(panel.selected, (s) => s === "Counter"), "Counter")
  } finally {
    await browser.close()
  }
})

// What the panel's evals asked, as the agent answered them.
const logElements = (page: import("puppeteer").Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __elements: string[] }
    w.__elements = []
    window.addEventListener("reactdx-elements", (event) => {
      const { selected, element } = (event as CustomEvent).detail
      w.__elements.push(
        selected
          ? `selected ${selected.dataset?.testid}`
          : `revealed ${element?.dataset?.testid}`,
      )
    })
  })
const logged = (page: import("puppeteer").Page) =>
  page.evaluate(
    () => (window as unknown as { __elements: string[] }).__elements,
  )

test("with DOM elements shown, an Elements selection selects the element's own row", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_18, "after")
  try {
    await until(panel, (t) =>
      (parseCopies(t)[0]?.names ?? []).includes("Counter"),
    )
    await panel.press("Show DOM elements")
    await selectInElements(page, "[data-testid=counter]")
    assert.equal(await poll(panel.selected, (s) => s === "button"), "button")
  } finally {
    await browser.close()
  }
})

test("a component selected from the Elements panel is scrolled to when ReactDX shows again", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(
    name,
    `${URL_18}/bench.html`,
    "after",
  )
  try {
    await until(panel, (t) => t.includes("Cell"))
    await selectInElements(page, "[data-testid=cell]")
    await poll(panel.selected, (s) => s === "Cell")
    // The real inspect() brings the Elements panel to the front, and its own
    // selection change comes back before the next one.
    await logElements(page)
    const SHOW = "Show in Elements panel"
    await poll(
      () => panel.described(SHOW),
      (d) => !d.disabled,
    )
    await panel.press(SHOW)
    await poll(
      () => logged(page),
      (e) => e.includes("selected cell"),
    )
    await page.evaluate(
      (code) =>
        new Function("$0", `return ${code}`)(
          document.querySelectorAll("[data-testid=cell]")[5000],
        ),
      SELECT_CODE,
    )
    await new Promise((resolve) => setTimeout(resolve, 500))
    await panel.show()
    // Only a row in view is rendered: the selected one reads its name once
    // the tree scrolled to it.
    assert.equal(await poll(panel.selected, (s) => s === "Cell"), "Cell")
  } finally {
    await browser.close()
  }
})

test("/ focuses the tree search; a search with no matches says so and clears", {
  skip,
}, async () => {
  const { browser, panel } = await panelFor(name, URL_18, "after")
  try {
    await until(panel, (t) =>
      (parseCopies(t)[0]?.names ?? []).includes("Counter"),
    )
    const SEARCH = "Search components"
    assert.equal(await panel.focused(SEARCH), false)
    // The key goes to a focused tree row, as a developer's would.
    await panel.key("Counter", "/")
    assert.equal(await poll(() => panel.focused(SEARCH), Boolean), true)
    await panel.type(SEARCH, "zzz")
    await until(panel, (t) => t.includes("No components match “zzz”."))
    await panel.press("Clear search")
    const cleared = await until(
      panel,
      (t) => !t.includes("No components match"),
    )
    assert.ok(!cleared.includes("No components match"), cleared)
  } finally {
    await browser.close()
  }
})
