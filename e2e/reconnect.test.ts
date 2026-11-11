import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import { stopBackground } from "./background.ts"
import { type BrowserName, launchWithExtension } from "./launch.ts"
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
const runs = (fixture: string) =>
  process.env.E2E_FIXTURE === undefined || process.env.E2E_FIXTURE === fixture
const skip = !runs("18")
const URL_18 = "http://localhost:5218"
const HEADING = "React 18.3.1 development react-dom"
const plainUrl = plainPage()

const stops: (() => void)[] = []
before(async () => {
  if (runs("18")) stops.push(await startFixture("fixture:18", 5218))
  if (runs("multi")) stops.push(await startFixture("fixture:multi", 5221))
})
after(() => {
  for (const stop of stops) stop()
})

const listing = (heading: string) => (text: string) =>
  parseCopies(text).some((c) => c.heading === heading && c.commits.length > 0)

// The panel lists the copy with a root, and the commit count rises on a click.
async function expectLive(page: Page, panel: PanelText, heading = HEADING) {
  const listed = listing(heading)
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

// bfcache: fixture:multi, because Vite's dev pages hold an HMR WebSocket that keeps
// Firefox from caching them. history.back(), because a Firefox restore fires no load
// event for page.goBack() to wait on.
const URL_MULTI = "http://localhost:5221"
const MULTI_TITLE = "ReactDX: React 18.3.1, 19.3.1"

async function leaveAndRestore(page: Page) {
  await page.evaluateOnNewDocument(() =>
    addEventListener("pageshow", (event) => {
      if (event.persisted)
        (window as unknown as { restored: boolean }).restored = true
    }),
  )
  await page.goto(URL_MULTI)
  await page.waitForSelector("[data-testid=root-19] [data-testid=counter]")
  await page.goto(plainUrl())
  await page.evaluate(() => history.back())
  // Proves the page came back from bfcache, not a fresh load.
  await page.waitForFunction(
    () => (window as unknown as { restored?: boolean }).restored === true,
    { timeout: 5000 },
  )
}

test("a bfcache restore shows the right toolbar, with no panel open", {
  skip: !runs("multi"),
}, async () => {
  const { browser } = await launchWithExtension(name)
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    await leaveAndRestore(page)
    await expectTitle(page, MULTI_TITLE)
  } finally {
    await browser.close()
  }
})

test("a bfcache restore shows the right panel", {
  skip: !runs("multi"),
}, async () => {
  const { browser, page, panel } = await panelFor(name, plainUrl(), "after")
  try {
    await leaveAndRestore(page)
    await expectTitle(page, MULTI_TITLE)
    await expectLive(page, panel, "React 18.3.1 development react-dom")
  } finally {
    await browser.close()
  }
})
