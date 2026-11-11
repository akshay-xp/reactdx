import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension } from "./launch.ts"
import { plainPage } from "./plain.ts"
import { reactdxWorker, type Toolbar, toolbar } from "./toolbar.ts"

const name = process.env.E2E_BROWSER as BrowserName
let extension: Awaited<ReturnType<typeof launchWithExtension>>
const plainUrl = plainPage()

before(async () => {
  extension = await launchWithExtension(name)
})
after(async () => {
  await extension?.browser.close()
})

// The background updates the toolbar asynchronously after React connects.
async function settled(page: Page, expected: string): Promise<Toolbar> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const state = await toolbar(name, extension.browser, page)
    if (state.title === expected || Date.now() > deadline) return state
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test("a page without React shows the grey icon and sends nothing", async () => {
  const page = await extension.browser.newPage()
  const seen = name === "chrome" && (await recordMessages())
  await page.goto(plainUrl())
  const state = await settled(page, "ReactDX: no React")
  assert.equal(state.title, "ReactDX: no React")
  if (name === "firefox") assert.match(state.icon ?? "", /none-/)
  if (seen) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.deepEqual(await seen(), [])
  }
  await page.close()
})

// Chrome only: records every runtime message the service worker receives.
async function recordMessages() {
  const worker = await reactdxWorker(extension.browser)
  await worker.evaluate(() => {
    const scope = globalThis as unknown as {
      seen: unknown[]
      chrome: {
        runtime: { onMessage: { addListener(f: (m: unknown) => void): void } }
      }
    }
    scope.seen = []
    scope.chrome.runtime.onMessage.addListener((m) => scope.seen.push(m))
  })
  return () =>
    worker.evaluate(() => (globalThis as unknown as { seen: unknown[] }).seen)
}

for (const [script, port, title, icon] of [
  ["fixture:18", 5218, "ReactDX: React 18.3.1", "development"],
  ["fixture:19", 5219, "ReactDX: React 19.3.1", "development"],
  // The App Router runs the React canary Next bundles, not the app's react-dom.
  [
    "fixture:next",
    5220,
    "ReactDX: React 19.3.0-canary-278794d7-20261002",
    "development",
  ],
  ["fixture:multi", 5221, "ReactDX: React 18.3.1, 19.3.1", "development"],
  [
    "fixture:prod",
    5222,
    "ReactDX: React 19.3.1 (production build)",
    "production",
  ],
] as const) {
  if (
    process.env.E2E_FIXTURE &&
    script !== `fixture:${process.env.E2E_FIXTURE}`
  )
    continue
  describe(script, () => {
    let stop: (() => void) | undefined
    before(async () => (stop = await startFixture(script, port)))
    after(() => stop?.())

    test(`${icon} React sets the icon, and leaving resets it`, async () => {
      const page = await extension.browser.newPage()
      await page.goto(`http://localhost:${port}`)
      await page.waitForSelector("[data-testid=counter]")
      const state = await settled(page, title)
      assert.equal(state.title, title)
      if (name === "firefox")
        assert.match(state.icon ?? "", new RegExp(`/${icon}-`))
      await page.goto(plainUrl())
      assert.equal(
        (await settled(page, "ReactDX: no React")).title,
        "ReactDX: no React",
      )
      await page.close()
    })
  })
}
