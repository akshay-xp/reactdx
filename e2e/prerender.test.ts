import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension } from "./launch.ts"
import { openPanelText, parseCopies, until } from "./panel-text.ts"
import { toolbar } from "./toolbar.ts"

// Chrome only: Firefox doesn't prerender speculation rules.
const name = process.env.E2E_BROWSER as BrowserName
const skip =
  name !== "chrome" ||
  (process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "19")
const URL_19 = "http://localhost:5219/"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:19", 5219)
})
after(() => stop?.())

// Chrome prerenders pages it expects you to open (a typed URL you visit often, or
// speculation rules) and swaps the document into the tab on navigation. DevTools
// being open turns prerendering off, so this launches with it closed.
test("a prerendered React page is detected once it's shown", {
  skip,
}, async () => {
  const { browser } = await launchWithExtension(name, undefined, {
    devtools: false,
  })
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    await page.goto(`${URL_19}bench.html`)
    await page.evaluate((url) => {
      const rules = document.createElement("script")
      rules.type = "speculationrules"
      rules.textContent = JSON.stringify({
        prerender: [{ source: "list", urls: [url] }],
      })
      document.head.append(rules)
      const link = document.createElement("a")
      link.href = url
      link.id = "go"
      link.textContent = "go"
      document.body.prepend(link)
    }, URL_19)
    // Long enough for the prerendered page to load React and post to the relay.
    await new Promise((resolve) => setTimeout(resolve, 4000))
    await page.click("#go")
    await page.waitForSelector("[data-testid=counter]")
    // Proves the shown document is the prerendered one, not a fresh load.
    assert.ok(
      await page.evaluate(
        () =>
          (
            performance.getEntriesByType(
              "navigation",
            )[0] as PerformanceNavigationTiming & { activationStart: number }
          ).activationStart > 0,
      ),
    )
    const deadline = Date.now() + 5000
    let state = await toolbar(name, browser, page)
    while (state.title !== "ReactDX: React 19.3.1" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      state = await toolbar(name, browser, page)
    }
    assert.equal(state.title, "ReactDX: React 19.3.1")
    await page.waitForFunction(
      () =>
        (window as unknown as Record<symbol, unknown>)[
          Symbol.for("reactdx.agent")
        ] === true,
      { timeout: 5000 },
    )

    // The reported bug: DevTools opened afterwards listed the copy with no root.
    const session = await browser.target().createCDPSession()
    await session.send(
      "Target.openDevTools" as never,
      {
        targetId: (page.target() as unknown as { _targetId: string })._targetId,
      } as never,
    )
    // DevTools has loaded its extensions once ReactDX's devtools page exists.
    await browser.waitForTarget((t) => t.url().endsWith("/devtools.html"), {
      timeout: 30_000,
    })
    const panel = await openPanelText(name, browser)
    const text = await until(panel, (t) =>
      (parseCopies(t)[0]?.names ?? []).includes("Counter"),
    )
    assert.ok(parseCopies(text)[0]?.names.includes("Counter"), text)
  } finally {
    await browser.close()
  }
})
