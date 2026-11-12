import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Browser, Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import {
  type BrowserName,
  launchWithExtension,
  reactdxBuild,
} from "./launch.ts"
import { openPanelText, parseCopies, until } from "./panel-text.ts"
import { toolbar } from "./toolbar.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"
const URL_18 = "http://localhost:5218"
const RELOAD =
  "This page was open before ReactDX was installed or updated. Reload it to inspect React."

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

// Chrome opens DevTools on demand; Firefox's toolbox is already open (-devtools) and
// picks up the new extension's panel.
async function openDevtools(browser: Browser, page: Page) {
  if (name !== "chrome") return
  const session = await browser.target().createCDPSession()
  await session.send(
    "Target.openDevTools" as never,
    {
      targetId: (page.target() as unknown as { _targetId: string })._targetId,
    } as never,
  )
  await browser.waitForTarget((t) => t.url().endsWith("/devtools.html"), {
    timeout: 30_000,
  })
}

// React connects to the devtools hook once, as it loads: a tab open before
// ReactDX was installed has no hook in it until it reloads.
test("a tab open before the install asks for a reload, then works", {
  skip,
}, async () => {
  const { browser } = await launchWithExtension(name, [], { devtools: false })
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    await page.goto(URL_18)
    await page.waitForSelector("[data-testid=counter]")
    await browser.installExtension(reactdxBuild(name))

    const deadline = Date.now() + 5000
    let state = await toolbar(name, browser, page)
    while (
      state.title !== "ReactDX: reload this page to check for React" &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      state = await toolbar(name, browser, page)
    }
    assert.equal(state.title, "ReactDX: reload this page to check for React")

    await openDevtools(browser, page)
    const panel = await openPanelText(name, browser)
    const prompt = await until(panel, (t) => t.startsWith(RELOAD))
    assert.equal(prompt, `${RELOAD} Reload page`)

    await panel.press("Reload page")
    const text = await until(panel, (t) =>
      (parseCopies(t)[0]?.names ?? []).includes("Counter"),
    )
    assert.ok(parseCopies(text)[0]?.names.includes("Counter"), text)
  } finally {
    await browser.close()
  }
})
