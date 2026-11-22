import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, parseCopies, selectListed, until } from "./panel-text.ts"

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
  test(`${fixture}: a state hook and a prop edit round-trip through the page`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}`,
      "after",
    )
    const counter = () =>
      page.$eval("[data-testid=counter]", (el) => el.textContent)
    try {
      await page.waitForSelector("[data-testid=counter]")
      await selectListed(panel, "Counter", (t) => t.includes("State: 0"))

      await panel.edit("State: 0", "7")
      const state = await until(panel.inspector, (t) => t.includes("State: 7"))
      assert.ok(state.includes("State: 7"), state)
      assert.equal(await counter(), "Count: 7")

      await panel.edit('label: "Count"', "Total")
      const label = await until(panel.inspector, (t) =>
        t.includes('label: "Total"'),
      )
      assert.ok(label.includes('label: "Total"'), label)
      assert.equal(await counter(), "Total: 7")

      // Typed: a number over a string, then a quoted string back.
      await panel.edit('label: "Total"', "5")
      const number = await until(panel.inspector, (t) => t.includes("label: 5"))
      assert.ok(number.includes("label: 5"), number)
      assert.equal(await counter(), "5: 7")
      await panel.edit("label: 5", '"Count"')
      const back = await until(panel.inspector, (t) =>
        t.includes('label: "Count"'),
      )
      assert.ok(back.includes('label: "Count"'), back)
    } finally {
      await browser.close()
    }
  })

for (const { fixture, port } of fixtures)
  test(`${fixture}: a context edit changes its provider's value`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/hooks.html`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=hooks]")
      await selectListed(panel, "Hooks", (t) => t.includes('Theme: "dark"'))
      await panel.edit('Theme: "dark"', '"light"')
      const shown = await until(
        panel.inspector,
        (t) =>
          t.includes('Theme: "light"') && t.includes('Context(Theme): "light"'),
      )
      assert.ok(shown.includes('Theme: "light"'), shown)
      assert.ok(shown.includes('Context(Theme): "light"'), shown)
    } finally {
      await browser.close()
    }
  })

for (const { fixture, port } of fixtures)
  test(`${fixture}: force re-render commits once and changes nothing`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}`,
      "after",
    )
    const commits = async () =>
      parseCopies(await panel())[0]?.commits[0] ?? Number.NaN
    try {
      await page.waitForSelector("[data-testid=counter]")
      await selectListed(panel, "Counter", (t) => t.includes("State: 0"))
      const before = await commits()
      await panel.press("Force re-render")
      const after = await until(
        panel,
        (t) => (parseCopies(t)[0]?.commits[0] ?? 0) > before,
      )
      assert.equal(parseCopies(after)[0]?.commits[0], before + 1, after)
      assert.equal(
        await page.$eval("[data-testid=counter]", (el) => el.textContent),
        "Count: 0",
      )
    } finally {
      await browser.close()
    }
  })

for (const { fixture, port } of fixtures)
  test(`${fixture}: Show fallback and Show error, on and off; neither without a boundary`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/edit.html`,
      "after",
    )
    // On the page, and not hidden (React hides a suspended boundary's children).
    const shows = (testid: string) =>
      page
        .waitForFunction(
          (testid) => {
            const el = document.querySelector(`[data-testid=${testid}]`)
            return el && getComputedStyle(el).display !== "none"
          },
          { timeout: 5000 },
          testid,
        )
        .then(() => true)
    // The toggles come with the inspection, which Firefox mirrors a moment
    // later: press once one shows, for up to 5 s.
    const press = async (label: string) => {
      for (let i = 0; ; i++)
        try {
          await panel.pressed(label)
          return await panel.press(label)
        } catch (error) {
          if (i === 50) throw error
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
    }
    try {
      await page.waitForSelector("[data-testid=ready]")
      await selectListed(panel, "Inside")
      await press("Show fallback")
      assert.ok(await shows("fallback"))
      // The panel moved to the Suspense boundary, where it's pressed.
      await until(panel.inspector, (t) => t.startsWith("Suspense"))
      await press("Show fallback")
      assert.ok(await shows("ready"))

      await selectListed(panel, "Child")
      await press("Show error")
      assert.ok(await shows("error-ui"))
      await until(panel.inspector, (t) => t.startsWith("Boundary"))
      await press("Show error")
      assert.ok(await shows("child"))

      await selectListed(panel, "Outside")
      await assert.rejects(panel.pressed("Show fallback"))
      await assert.rejects(panel.pressed("Show error"))
    } finally {
      await browser.close()
    }
  })
