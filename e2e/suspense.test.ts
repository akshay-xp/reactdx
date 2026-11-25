import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, selectListed, until } from "./panel-text.ts"

// Suspense waits (M7 #80): boundary rows count up while they wait and say how
// long they took; the Inspector says what a waiting boundary waits on.
const name = process.env.E2E_BROWSER as BrowserName
const only = process.env.E2E_FIXTURE
const fixtures = [
  { fixture: "18", script: "fixture:18", port: 5218 },
  { fixture: "19", script: "fixture:19", port: 5219 },
  { fixture: "next", script: "fixture:next", port: 5220 },
].filter((f) => only === undefined || f.fixture === only)

const stops: (() => void)[] = []
// Node 24 hangs on a file with hooks and no tests (--fixture=multi or prod).
if (fixtures.length) {
  before(async () => {
    for (const { script, port } of fixtures)
      stops.push(await startFixture(script, port))
  })
  after(() => {
    for (const stop of stops) stop()
  })
}

for (const { fixture, port } of fixtures.filter((f) => f.fixture !== "next"))
  test(`${fixture}: a waiting boundary counts up, says what it waits on, then how long it took`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/suspense.html`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=comments]", { timeout: 6000 })
      await until(panel, (t) => t.includes("Suspense arrived in"))
      // A new wait while DevTools watches (React 18 tells who suspended then).
      await page.click("[data-testid=again]")
      const waiting = await until(panel, (t) => t.includes("Suspense waiting"))
      assert.ok(waiting.includes("Suspense waiting"), waiting)
      const cause =
        fixture === "18"
          ? "waiting on 1 promise thrown by Comments"
          : "waiting inside Comments"
      const answer = await selectListed(panel, "Suspense", (t) =>
        t.includes(cause),
      )
      assert.match(answer, /Showing its fallback for (\d+ ms|\d\.\ds)/)
      const arrived = await until(
        panel,
        (t) => /Suspense arrived in (\d+ ms|\d\.\ds)/.test(t),
        6000,
      )
      assert.match(arrived, /Suspense arrived in (\d+ ms|\d\.\ds)/)
    } finally {
      await browser.close()
    }
  })

if (fixtures.some((f) => f.fixture === "next"))
  test("next: a Server Component's boundary, by navigation", async () => {
    const { browser, page, panel } = await panelFor(
      name,
      "http://localhost:5220",
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=counter]")
      await until(panel, (t) => t.includes("Counter"))
      await page.click("a[href='/shop/slow']")
      const waiting = await until(
        panel,
        (t) => t.includes("Suspense waiting"),
        10_000,
      )
      assert.ok(waiting.includes("Suspense waiting"), waiting)
      const answer = await selectListed(panel, "Suspense", (t) =>
        t.includes("waiting on Reviews (server)"),
      )
      assert.match(answer, /Showing its fallback for (\d+ ms|\d\.\ds)/)
      const done = await until(
        panel.inspector,
        (t) => t.includes("getReviews · Reviews · 6."),
        12_000,
      )
      assert.ok(done.includes("getReviews · Reviews · 6."), done)
      assert.match(await panel(), /Suspense arrived in 6\.\ds/)
    } finally {
      await browser.close()
    }
  })
