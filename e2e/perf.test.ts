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

test("the 10k tree scrolls with under 100 DOM rows and no long task", {
  skip,
}, async (t) => {
  const { browser, panel } = await benchPanel()
  try {
    const run = await panel.evaluate(async () => {
      const frame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        )
      const settle = () => new Promise((resolve) => setTimeout(resolve, 200))
      const tasks: number[] = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tasks.push(entry.duration)
      }).observe({ type: "longtask" })
      // Proves the observer sees this frame's long tasks. Its own task: one in the
      // task that registered the observer isn't reported.
      await settle()
      setTimeout(() => {
        const start = performance.now()
        while (performance.now() - start < 80);
      })
      await settle()
      const observed = tasks.splice(0).length > 0

      const tree = document.querySelector("[data-testid=tree]") as HTMLElement
      const count = () => document.querySelectorAll("[data-testid=node]").length
      let most = count()
      let steps = 0
      while (tree.scrollTop + tree.clientHeight < tree.scrollHeight) {
        tree.scrollTop += tree.clientHeight
        await frame()
        most = Math.max(most, count())
        steps++
      }
      await settle()
      const last = [...document.querySelectorAll("[data-testid=node]")].at(-1)
      return { observed, tasks, most, steps, last: last?.textContent }
    })
    t.diagnostic(JSON.stringify({ ...run, tasks: run.tasks.length }))
    assert.ok(run.observed, "the long-task observer saw no planted task")
    assert.ok(run.steps > 100, `${run.steps} scroll steps`)
    assert.ok(run.most < 100, `${run.most} rows in the DOM`)
    assert.equal(run.last, 'Cell key="9999"')
    assert.deepEqual(
      run.tasks.filter((ms) => ms > 50),
      [],
    )
  } finally {
    await browser.close()
  }
})

test("End and Home select the last and first rows and scroll to them", {
  skip,
}, async () => {
  const { browser, panel } = await benchPanel()
  try {
    const selected = (text: string) =>
      panel.waitForFunction(
        (want) =>
          document.querySelector("[data-testid=node][aria-selected=true]")
            ?.textContent === want,
        { timeout: 2000 },
        text,
      )
    await panel.focus("[data-testid=tree]")
    await panel.page().keyboard.press("End")
    await selected('Cell key="9999"')
    await panel.page().keyboard.press("Home")
    await selected("Bench")
  } finally {
    await browser.close()
  }
})

// Selects a Cell by clicking its row in the panel; resolves with the ms until the
// inspector shows `shows`.
const selectCell = (panel: Awaited<ReturnType<typeof benchPanel>>["panel"]) =>
  panel.evaluate(
    (shows) =>
      new Promise<number>((resolve) => {
        const row = [...document.querySelectorAll("[data-testid=node]")].find(
          (n) => n.textContent === 'Cell key="0"',
        )
        const inspector = () =>
          document.querySelector("[data-testid=inspector]")?.textContent ?? ""
        const start = performance.now()
        new MutationObserver((_, observer) => {
          if (!inspector().includes(shows)) return
          observer.disconnect()
          resolve(performance.now() - start)
        }).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        })
        ;(
          row?.querySelector("[data-testid=name]") as HTMLElement | null
        )?.click()
      }),
    "State: 0",
  )

test("a selected Cell's hooks show within 100 ms", { skip }, async (t) => {
  const { browser, panel } = await benchPanel()
  try {
    const elapsed = await selectCell(panel)
    t.diagnostic(`${elapsed.toFixed(0)} ms`)
    assert.ok(elapsed < 100, `${elapsed} ms`)
  } finally {
    await browser.close()
  }
})
