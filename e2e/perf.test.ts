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

type Timed = Window & { reactdxAt?: number[] }

// The median of five mounts: one timing on a shared CI runner ranged from 70 to
// over 130 ms, on main too.
test("a mounted component's row shows within 100 ms of its batch", {
  skip,
}, async (t) => {
  const { browser, page, panel } = await benchPanel()
  try {
    // Each batch that adds Extra, and each time its row appears in the panel.
    await page.evaluate(() => {
      const w = window as Timed
      w.reactdxAt = []
      addEventListener("message", ({ data }) => {
        if (
          data?.source === "reactdx" &&
          data.type === "tree" &&
          data.ops.some(
            (op: { op: string; name?: string }) =>
              op.op === "add" && op.name === "Extra",
          )
        )
          w.reactdxAt?.push(Date.now())
      })
    })
    await panel.evaluate(() => {
      const w = window as Timed
      w.reactdxAt = []
      let was = false
      new MutationObserver(() => {
        const shown = [...document.querySelectorAll("[data-testid=node]")].some(
          (n) => n.textContent === "Extra",
        )
        if (shown && !was) w.reactdxAt?.push(Date.now())
        was = shown
      }).observe(document.body, { childList: true, subtree: true })
    })
    const times = (frame: typeof page | typeof panel) =>
      frame.evaluate(() => (window as Timed).reactdxAt ?? [])
    const extraShown = (on: boolean) =>
      panel.waitForFunction(
        (on) =>
          [...document.querySelectorAll("[data-testid=node]")].some(
            (n) => n.textContent === "Extra",
          ) === on,
        { timeout: 5000 },
        on,
      )
    for (let round = 0; round < 5; round++) {
      await page.click("[data-testid=extra]")
      await extraShown(true)
      await page.click("[data-testid=extra]")
      await extraShown(false)
    }
    const posted = await times(page)
    const shown = await times(panel)
    assert.equal(posted.length, 5)
    assert.equal(shown.length, 5)
    const delays = shown.map((at, i) => at - (posted[i] as number))
    const median = [...delays].sort((a, b) => a - b)[2] as number
    t.diagnostic(`median ${median} ms of ${delays.join(", ")}`)
    assert.ok(median < 100, `${median} ms (${delays.join(", ")})`)
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

      const pane = document.querySelector("[data-testid=trees]") as HTMLElement
      const count = () => document.querySelectorAll("[data-testid=node]").length
      let most = count()
      let steps = 0
      // Until the scroll stops moving: the headings' fractional heights can leave
      // the bottom half a pixel short of scrollHeight.
      for (let last = -1; pane.scrollTop !== last; ) {
        last = pane.scrollTop
        pane.scrollTop += pane.clientHeight
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

test("the trees pane is the only scroller: not the tree, not the toolbar", {
  skip,
}, async () => {
  const { browser, panel } = await benchPanel()
  try {
    const layout = await panel.evaluate(() => {
      const pane = document.querySelector("[data-testid=trees]") as HTMLElement
      const scrolls = (el: Element) =>
        el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth
      const scrolling = [...document.querySelectorAll("[data-testid=split] *")]
        .filter((el) => !el.closest("[data-testid=inspector]") && scrolls(el))
        .map((el) => el.getAttribute("data-testid") ?? el.tagName)
      return {
        scrolling,
        toolbarOutside: !pane.querySelector("[data-testid=search]"),
        inView: pane.getBoundingClientRect().bottom <= innerHeight,
      }
    })
    assert.deepEqual(layout, {
      scrolling: ["trees"],
      toolbarOutside: true,
      inView: true,
    })
  } finally {
    await browser.close()
  }
})

test("End and Home select the last and first rows and scroll to them", {
  skip,
}, async () => {
  const { browser, panel } = await benchPanel()
  try {
    const selected = (text: string, timeout: number) =>
      panel.waitForFunction(
        (want) =>
          document.querySelector("[data-testid=node][aria-selected=true]")
            ?.textContent === want,
        { timeout },
        text,
      )
    await panel.focus("[data-testid=tree]")
    // The tree can still be receiving Cells (seen on CI): End then selects the
    // last row so far, so it's pressed again until the last Cell is selected.
    const deadline = Date.now() + 10_000
    for (;;) {
      await panel.page().keyboard.press("End")
      const last = await selected('Cell key="9999"', 500).then(
        () => true,
        () => false,
      )
      if (last) break
      if (Date.now() > deadline)
        assert.fail(
          `End selected ${await panel.evaluate(
            () =>
              document.querySelector("[data-testid=node][aria-selected=true]")
                ?.textContent,
          )}`,
        )
    }
    await panel.page().keyboard.press("Home")
    await selected("Bench", 2000)
  } finally {
    await browser.close()
  }
})

// Selects `Cell key="<key>"` by clicking its row in the panel; resolves with the
// ms until the inspector shows its hooks (a new selection clears the last one's).
const selectCell = (
  panel: Awaited<ReturnType<typeof benchPanel>>["panel"],
  key = 0,
) =>
  panel.evaluate(
    (key) =>
      new Promise<{ ms: number; cleared: boolean }>((resolve) => {
        const row = [...document.querySelectorAll("[data-testid=node]")].find(
          (n) => n.textContent === `Cell key="${key}"`,
        )
        const inspector = () =>
          document.querySelector("[data-testid=inspector]")?.textContent ?? ""
        const shown = () =>
          inspector().includes(`key="${key}"`) &&
          inspector().includes("State: 0")
        const start = performance.now()
        // The timing counts only if the last selection's hooks went first.
        let cleared = false
        new MutationObserver((_, observer) => {
          if (!inspector().includes("State: 0")) cleared = true
          if (!shown()) return
          observer.disconnect()
          resolve({ ms: performance.now() - start, cleared })
        }).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        })
        ;(
          row?.querySelector("[data-testid=name]") as HTMLElement | null
        )?.click()
      }),
    key,
  )

// The median of five selections: one timing on a shared CI runner varies from
// tens to over a hundred ms.
test("a selected Cell's hooks show within 100 ms", { skip }, async (t) => {
  const { browser, panel } = await benchPanel()
  try {
    const times: number[] = []
    for (const key of [0, 1, 2, 3, 4]) {
      const { ms, cleared } = await selectCell(panel, key)
      assert.ok(cleared, `Cell ${key}: the last hooks never cleared`)
      times.push(ms)
    }
    const median = [...times].sort((a, b) => a - b)[2] as number
    t.diagnostic(
      `median ${median.toFixed(0)} ms of ${times.map((ms) => ms.toFixed(0)).join(", ")}`,
    )
    assert.ok(median < 100, `${median} ms (${times.join(", ")})`)
  } finally {
    await browser.close()
  }
})

type Counted = Window & { inspectedCount?: number }

test("an unrelated commit sends no inspected message", { skip }, async () => {
  const { browser, page, panel } = await benchPanel()
  try {
    await selectCell(panel)
    await page.evaluate(() => {
      const w = window as Counted
      w.inspectedCount = 0
      addEventListener("message", ({ data }) => {
        if (data?.source === "reactdx" && data.type === "inspected")
          w.inspectedCount = (w.inspectedCount ?? 0) + 1
      })
    })
    const count = () => page.evaluate(() => (window as Counted).inspectedCount)
    // Re-renders Bench and mounts Extra; the cells bail out.
    await page.click("[data-testid=extra]")
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(await count(), 0)
    // The control: a commit to the selected Cell is re-sent.
    await page.evaluate(() =>
      (
        window as unknown as { __bench: (m: string, n: number) => void }
      ).__bench("one", 1),
    )
    await page.waitForFunction(
      () => ((window as Counted).inspectedCount ?? 0) >= 1,
      { timeout: 1000 },
    )
    await panel.waitForFunction(
      () =>
        document
          .querySelector("[data-testid=inspector]")
          ?.textContent?.includes("State: 1"),
      { timeout: 1000 },
    )
  } finally {
    await browser.close()
  }
})
