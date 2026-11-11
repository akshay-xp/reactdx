import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import { stopBackground } from "./background.ts"
import type { BrowserName } from "./launch.ts"
import {
  type PanelText,
  panelFor,
  parseCopies,
  total,
  until,
} from "./panel-text.ts"
import { plainPage } from "./plain.ts"
import { toolbar } from "./toolbar.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"
const URL_18 = "http://localhost:5218"
const HEADING = "React 18.3.1 development react-dom"
const plainUrl = plainPage()

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

const listed = (text: string) =>
  parseCopies(text).some((c) => c.heading === HEADING && c.commits.length > 0)

// The panel lists React 18.3.1 with a root, and its commit count rises on a click.
async function expectLive(page: Page, panel: PanelText) {
  await page.waitForSelector("[data-testid=counter]")
  const text = await until(panel, listed)
  assert.ok(listed(text), text)
  const before = total(parseCopies(text))
  await page.$eval("[data-testid=counter]", (el) => (el as HTMLElement).click())
  const after = await until(panel, (t) => total(parseCopies(t)) > before, 5000)
  assert.ok(total(parseCopies(after)) > before, after)
}

test("the panel reconnects after the background stops", { skip }, async () => {
  const { browser, page, panel } = await panelFor(name, URL_18, "after")
  try {
    await expectLive(page, panel)
    await stopBackground(name, browser)
    await expectLive(page, panel)
    assert.equal(
      (await toolbar(name, browser, page)).title,
      "ReactDX: React 18.3.1",
    )
  } finally {
    await browser.close()
  }
})

async function expectTitle(page: Page, title: string) {
  const deadline = Date.now() + 5000
  let state = await toolbar(name, page.browser(), page)
  while (state.title !== title && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    state = await toolbar(name, page.browser(), page)
  }
  assert.equal(state.title, title)
}

test("a navigation resets the panel to the new document", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_18, "after")
  try {
    await expectLive(page, panel)

    await page.goto(plainUrl())
    const none = "No React on this page"
    assert.equal(await until(panel, (t) => t === none), none)
    await expectTitle(page, "ReactDX: no React")

    await page.goto(URL_18)
    await expectLive(page, panel)
    await expectTitle(page, "ReactDX: React 18.3.1")

    await page.reload()
    await expectLive(page, panel)
  } finally {
    await browser.close()
  }
})
