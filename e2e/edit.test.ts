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
    } finally {
      await browser.close()
    }
  })
