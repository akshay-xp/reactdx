import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { ElementHandle } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, selectListed } from "./panel-text.ts"

// Chrome: a right-click and layout, in the panel's document. The commands it
// sends are the same in Firefox (unit tests: packages/page, packages/panel).
const name = process.env.E2E_BROWSER as BrowserName
const skip =
  name !== "chrome" ||
  (process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "19")
const URL_19 = "http://localhost:5219"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:19", 5219)
})
after(() => stop?.())

test("a value row reads key: value, and its menu stores the value as a page global", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_19, "after")
  try {
    await page.waitForSelector("[data-testid=counter]")
    await selectListed(panel, "Counter", (t) => t.includes('label: "Count"'))
    const frame = panel.frame
    if (!frame) throw new Error("no panel frame")
    let row: ElementHandle | undefined
    for (const el of await frame.$$("[data-testid=value]"))
      if ((await el.evaluate((e) => e.textContent)) === 'label: "Count"')
        row = el
    if (!row) throw new Error("no label row")
    // A space's width between the key and the value.
    const gap = await row.evaluate((el) => {
      const [key, value] = el.querySelectorAll("[data-search-text]")
      return (
        (value as Element).getBoundingClientRect().left -
        (key as Element).getBoundingClientRect().right
      )
    })
    assert.ok(gap > 1, `gap ${gap}`)

    await row.click({ button: "right" })
    await frame.waitForSelector("[role=menu]")
    await panel.press("Store as global variable")
    const stored = await page.waitForFunction(
      () => (window as unknown as { $reactdx1?: unknown }).$reactdx1,
    )
    assert.equal(await stored.jsonValue(), "Count")
    // The panel says where it went.
    await frame.waitForFunction(
      () =>
        document.querySelector("[role=status]")?.textContent ===
        "Stored as $reactdx1. Use it in the Console.",
    )
  } finally {
    await browser.close()
  }
})
