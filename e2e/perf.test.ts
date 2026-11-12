import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

// Chrome only: the budgets are the spec's Chrome numbers, and Firefox's panel
// runs in a process Puppeteer can't reach.
const name = process.env.E2E_BROWSER as BrowserName
const skip =
  name !== "chrome" ||
  (process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "19")
const BENCH = "http://localhost:5219/bench.html"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:19", 5219)
})
after(() => stop?.())

// The bench page loaded, then the panel opened, showing the tree's first row.
async function benchPanel() {
  const { browser } = await launchWithExtension(name)
  const [page] = await browser.pages()
  if (!page) throw new Error("no page")
  await page.goto(BENCH)
  await page.waitForFunction(
    () => document.querySelectorAll("[data-testid=cell]").length === 10000,
    { timeout: 10_000 },
  )
  const panel = await openPanel(browser)
  await panel.waitForFunction(
    () =>
      [...document.querySelectorAll("[data-testid=node]")].some(
        (n) => n.textContent === "Bench",
      ),
    { timeout: 10_000 },
  )
  return { browser, page, panel }
}

test("the first rows show within 500 ms of subscribe", { skip }, async (t) => {
  const { browser, panel } = await benchPanel()
  try {
    const marks = await panel.evaluate(() =>
      performance
        .getEntriesByType("mark")
        .map(({ name, startTime }) => ({ name, startTime })),
    )
    const rows = marks.find((m) => m.name === "reactdx:rows")
    assert.ok(rows, `no reactdx:rows mark: ${JSON.stringify(marks)}`)
    const subscribe = marks
      .filter(
        (m) => m.name === "reactdx:subscribe" && m.startTime <= rows.startTime,
      )
      .at(-1)
    assert.ok(subscribe, `no reactdx:subscribe mark: ${JSON.stringify(marks)}`)
    const elapsed = rows.startTime - subscribe.startTime
    t.diagnostic(`${elapsed.toFixed(0)} ms`)
    assert.ok(elapsed < 500, `${elapsed} ms`)
  } finally {
    await browser.close()
  }
})

type Timed = Window & { reactdxAt?: number }

test("a mounted component's row shows within 100 ms of its batch", {
  skip,
}, async (t) => {
  const { browser, page, panel } = await benchPanel()
  try {
    await page.evaluate(() =>
      addEventListener("message", ({ data }) => {
        const w = window as Timed
        if (
          w.reactdxAt === undefined &&
          data?.source === "reactdx" &&
          data.type === "tree" &&
          data.ops.some(
            (op: { op: string; name?: string }) =>
              op.op === "add" && op.name === "Extra",
          )
        )
          w.reactdxAt = Date.now()
      }),
    )
    await panel.evaluate(() => {
      const shown = () =>
        [...document.querySelectorAll("[data-testid=node]")].some(
          (n) => n.textContent === "Extra",
        )
      new MutationObserver((_, observer) => {
        if (!shown()) return
        ;(window as Timed).reactdxAt = Date.now()
        observer.disconnect()
      }).observe(document.body, { childList: true, subtree: true })
    })
    await page.click("[data-testid=extra]")
    const at = (frame: typeof page | typeof panel) =>
      frame
        .waitForFunction(() => (window as Timed).reactdxAt, { timeout: 5000 })
        .then((handle) => handle.jsonValue() as Promise<number>)
    const posted = await at(page)
    const shown = await at(panel)
    t.diagnostic(`${shown - posted} ms`)
    assert.ok(shown - posted < 100, `${shown - posted} ms`)
  } finally {
    await browser.close()
  }
})
