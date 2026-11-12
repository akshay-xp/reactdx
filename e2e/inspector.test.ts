import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, parseCopies, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const only = process.env.E2E_FIXTURE
const fixtures = [
  { fixture: "18", script: "fixture:18", port: 5218 },
  { fixture: "19", script: "fixture:19", port: 5219 },
  { fixture: "next", script: "fixture:next", port: 5220 },
].filter((f) => only === undefined || f.fixture === only)

const stops: (() => void)[] = []
before(async () => {
  for (const { script, port } of fixtures)
    stops.push(await startFixture(script, port))
})
after(() => {
  for (const stop of stops) stop()
})

for (const { fixture, port } of fixtures)
  test(`${fixture}: the inspector shows the selection's props, live`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=counter]")
      // Next's tree is taller than the panel: its components are at the end.
      const read = async () => {
        await panel.end()
        return panel()
      }
      const listed = await until(read, (t) =>
        parseCopies(t).some((c) => c.names.includes("Counter")),
      )
      assert.ok(
        parseCopies(listed).some((c) => c.names.includes("Counter")),
        listed,
      )
      await panel.select("Counter")
      const props = await until(panel.inspector, (t) =>
        t.includes('label: "Count"'),
      )
      assert.ok(props.includes('label: "Count"'), props)

      await panel.press("Show DOM elements")
      await until(read, (t) => t.includes("button"))
      await panel.select("button")
      const before = 'children: ["Count", ": ", 0]'
      const shown = await until(panel.inspector, (t) => t.includes(before))
      assert.ok(shown.includes(before), shown)

      await page.click("[data-testid=counter]")
      const after = 'children: ["Count", ": ", 1]'
      const live = await until(panel.inspector, (t) => t.includes(after))
      assert.ok(live.includes(after), live)
    } finally {
      await browser.close()
    }
  })
