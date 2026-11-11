import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"
import { openPanelText, parseCopies, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

const xss = (round: number) => `<img src=x onerror=alert(${round})>`

// Any page script can post into the window the relay listens on. Each round ends
// with its own forged renderer, so the panel showing it means the round was processed.
function forge(round: number) {
  const post = (data: unknown) => window.postMessage(data, "*")
  post(null)
  post("reactdx")
  post({ source: "reactdx", type: "renderer", id: "1", version: 18 })
  post({ source: "reactdx", type: "renderer", id: 2, version: "x".repeat(1e6) })
  post({ source: "reactdx", type: "unknown" })
  post({
    source: "reactdx",
    type: "snapshot",
    roots: Array.from({ length: 1000 }, (_, i) => ({
      rendererId: 1,
      id: i + 1,
      commits: 0,
    })),
  })
  post({
    source: "reactdx",
    type: "renderer",
    id: 59 + round,
    version: `<img src=x onerror=alert(${round})>`,
    bundleType: 1,
    rendererPackageName: "react-dom",
  })
}

test("forged page messages can't break the relay or the panel", {
  skip,
}, async () => {
  const { browser } = await launchWithExtension(name)
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    // The relay's document_start listener can attach after this script runs (always
    // in Chrome), so repeat round 1 over the first 50 ms, still before React loads.
    await page.evaluateOnNewDocument(
      `for (const ms of [0, 5, 20, 50]) setTimeout(() => (${forge})(1), ms)`,
    )
    await page.goto("http://localhost:5218")
    await page.waitForSelector("[data-testid=counter]")
    const panel = await openPanelText(name, browser)
    const real = (text: string) =>
      parseCopies(text).find((c) => c.heading.startsWith("React 18.3.1"))
    await until(panel, (t) => (real(t)?.commits.length ?? 0) > 0)

    await page.evaluate(forge, 2)
    // Firefox mirrors the panel's accessibility tree asynchronously, so poll for a whole list.
    const text = await until(
      panel,
      (t) => t.includes(`React ${xss(2)}`) && real(t) !== undefined,
    )
    // The 1,000-root snapshot was dropped: only the real root is listed.
    assert.deepEqual(real(text)?.commits.length, 1, text)
    // The valid-shaped forged renderer is shown, as text.
    for (const round of [1, 2])
      assert.ok(
        text.includes(`React ${xss(round)} development react-dom`),
        text,
      )
    if (name === "chrome") {
      const frame = await openPanel(browser)
      assert.equal(await frame.$("img"), null)
    }

    const before = real(text)?.commits[0] ?? 0
    await page.$eval("[data-testid=counter]", (el) =>
      (el as HTMLElement).click(),
    )
    const after = await until(
      panel,
      (t) => (real(t)?.commits[0] ?? 0) > before,
      2000,
    )
    assert.ok((real(after)?.commits[0] ?? 0) > before, after)
  } finally {
    await browser.close()
  }
})
