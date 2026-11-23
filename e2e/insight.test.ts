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

      // Mounted with Late, after the panel opened: its mount is recorded too.
      await selectListed(panel, "Stepped", (t) => t.includes("Mounted"))
      for (let i = 0; i < 3; i++) await page.click("[data-testid=step]")
      await shows("Render 4 of 4", "State #1: 2 → 3")
      await panel.press("Previous render")
      await shows("Render 3 of 4", "State #1: 1 → 2")
      await panel.key("Render 3 of 4", "ArrowLeft")
      await shows("Render 2 of 4", "State #1: 0 → 1")
      await selectListed(panel, "Plain", (t) => t.includes("Parent rendered"))
      await panel.press("Force re-render")
      await shows("Forced")

      await selectListed(panel, "Stateful")
      await page.click("[data-testid=state]")
      await shows("State changed", "State #1: 0 → 1")

      await selectListed(panel, "Counter")
      await page.click("[data-testid=count]")
      await shows("Triggered by Counter (State #1: 3 → 4)")

      await selectListed(panel, "Reader")
      await page.click("[data-testid=theme]")
      await shows("Context changed", 'Theme: "dark" → "light"')

      await selectListed(panel, "Effects")
      await page.click("[data-testid=b]")
      await shows("Effects ran", "Effect #3: deps [1] changed", "[1]: 1 → 2")
      await shows("Effect #5: no deps")
      const effects = await panel.inspector()
      assert.ok(!effects.includes("Effect #4"), effects)

      await page.click("[data-testid=rekey]")
      await selectListed(panel, "Item", (t) =>
        t.includes("Remounted: key changed (a → b)"),
      )
      await page.click("[data-testid=wrap]")
      await selectListed(panel, "Inner", (t) =>
        t.includes("Remounted: ancestor section remounted"),
      )
      await panel.press("section")
      await until(panel.inspector, (t) => t.startsWith("section "))
      assert.ok((await panel.inspector()).startsWith("section "))
    } finally {
      await browser.close()
    }
  })
