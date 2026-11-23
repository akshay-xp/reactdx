import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, selectListed, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const only = process.env.E2E_FIXTURE
const fixtures = [
  { fixture: "18", script: "fixture:18", port: 5218 },
  { fixture: "19", script: "fixture:19", port: 5219 },
].filter((f) => only === undefined || f.fixture === only)

const stops: (() => void)[] = []
// Node 24 hangs on a file with hooks and no tests.
if (fixtures.length) {
  before(async () => {
    for (const { script, port } of fixtures)
      stops.push(await startFixture(script, port))
  })
  after(() => {
    for (const stop of stops) stop()
  })
}

for (const { fixture, port } of fixtures)
  test(`${fixture}: Why did this render names each reason`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/insight.html`,
      "after",
    )
    const shows = async (...parts: string[]) => {
      const text = await until(panel.inspector, (t) =>
        parts.every((part) => t.includes(part)),
      )
      for (const part of parts) assert.ok(text.includes(part), text)
    }
    try {
      await page.waitForSelector("[data-testid=insight]")
      // The page's first commit comes before the agent watches: nothing yet.
      await selectListed(panel, "Shown", (t) =>
        t.includes("No renders recorded since DevTools opened."),
      )
      await page.click("[data-testid=bump]")
      await shows("Props changed", "count: 1 → 2")
      // A memo child given an inline object and callback: new references.
      await selectListed(panel, "Styled", (t) =>
        t.includes("data: {count: 1} → {count: 2}"),
      )
      await shows(
        'style: {color: "red"} → {color: "red"} same value, new reference',
        "new function",
      )
      const styled = await panel.inspector()
      assert.ok(!/\{count: 2\} (same value|new function)/.test(styled), styled)
      await page.click("[data-testid=add]")
      await selectListed(panel, "Late", (t) => t.includes("Mounted"))
      await selectListed(panel, "Plain", (t) => t.includes("Parent rendered"))
      await panel.press("Force re-render")
      await shows("Forced")

      await selectListed(panel, "Stateful")
      await page.click("[data-testid=state]")
      await shows("State changed", "State #1: 0 → 1")

      await selectListed(panel, "Reader")
      await page.click("[data-testid=theme]")
      await shows("Context changed", 'Theme: "dark" → "light"')
    } finally {
      await browser.close()
    }
  })
