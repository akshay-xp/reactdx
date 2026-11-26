import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"
import { outlines, recordShadows, untilOutlines } from "./shadows.ts"

// Chrome only: the budgets are the spec's Chrome numbers, and Firefox's panel
// runs in a process Puppeteer can't reach.
const name = process.env.E2E_BROWSER as BrowserName
const skip =
  name !== "chrome" ||
  (process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "19")
const BENCH = "http://localhost:5219/bench.html"

type Bench = Window & { __bench: (mode: string, n: number) => number[] }

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:19", 5219)
})
after(() => stop?.())

const cellsLoaded = (page: Page) =>
  page.waitForFunction(
    () => document.querySelectorAll("[data-testid=cell]").length === 10000,
    { timeout: 10_000 },
  )

// The bench page loaded, then the panel opened, showing the tree's first row.
// Latency budgets are this machine's (a 100 ms all-cells commit) and scale with
// the runner's: CI's edits took 0.24 to 0.29x its commit, as here (#85).
// Measured before the panel opens, then reloaded: the tests expect State: 0.
async function benchPanel() {
  const { browser } = await launchWithExtension(name)
  const [page] = await browser.pages()
  if (!page) throw new Error("no page")
  await page.goto(BENCH)
  await cellsLoaded(page)
  const commit = await page.evaluate(() => {
    const { __bench } = window as unknown as Bench
    __bench("all", 1)
    return Math.min(...__bench("all", 5))
  })
  const scale = Math.max(1, commit / 100)
  const budget = (ms: number) => ms * scale
  await page.reload()
  await cellsLoaded(page)
  const panel = await openPanel(browser)
  await panel.waitForFunction(
    () =>
      [...document.querySelectorAll("[data-testid=node]")].some(
        (n) => n.textContent === "Bench",
      ),
    { timeout: 10_000 },
  )
  // The 10,000 Cells fold into one group row (M6 #72): open it. Found and
  // clicked in the panel: Cells still arriving rebuild the rows, so a handle
  // to the row can go stale before a click lands.
  await panel.waitForFunction(
    () => {
      const open = [...document.querySelectorAll("[data-testid=node]")].some(
        (n) => n.textContent === 'Cell key="0"',
      )
      if (!open)
        document
          .querySelector<HTMLElement>(
            '[data-testid=node][data-id^="-"][aria-expanded=false] [data-toggle]',
          )
          ?.click()
      return open
    },
    { timeout: 10_000, polling: 100 },
  )
  return { browser, page, panel, budget }
}

test("the first rows show within 500 ms of subscribe", { skip }, async (t) => {
  const { browser, panel, budget } = await benchPanel()
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
    t.diagnostic(`${elapsed.toFixed(0)} ms, budget ${budget(500).toFixed(0)}`)
    assert.ok(elapsed < budget(500), `${elapsed} ms`)
  } finally {
    await browser.close()
  }
})

type Timed = Window & { reactdxAt?: number[] }

// The median of five mounts.
test("a mounted component's row shows within 100 ms of its batch", {
  skip,
}, async (t) => {
  const { browser, page, panel, budget } = await benchPanel()
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
    t.diagnostic(
      `median ${median} ms of ${delays.join(", ")}, budget ${budget(100).toFixed(0)}`,
    )
    assert.ok(median < budget(100), `${median} ms (${delays.join(", ")})`)
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

// The median of five selections.
test("a selected Cell's hooks show within 100 ms", { skip }, async (t) => {
  const { browser, panel, budget } = await benchPanel()
  try {
    const times: number[] = []
    for (const key of [0, 1, 2, 3, 4]) {
      const { ms, cleared } = await selectCell(panel, key)
      assert.ok(cleared, `Cell ${key}: the last hooks never cleared`)
      times.push(ms)
    }
    const median = [...times].sort((a, b) => a - b)[2] as number
    t.diagnostic(
      `median ${median.toFixed(0)} ms of ${times.map((ms) => ms.toFixed(0)).join(", ")}, budget ${budget(100).toFixed(0)}`,
    )
    assert.ok(median < budget(100), `${median} ms (${times.join(", ")})`)
  } finally {
    await browser.close()
  }
})

type Counted = Window & { inspectedCount?: number }

// An edit of the selected Cell's state, timed from Enter in its editor until the
// inspector shows the page's re-send.
const editCell = (
  panel: Awaited<ReturnType<typeof benchPanel>>["panel"],
  from: number,
  to: number,
) =>
  panel.evaluate(
    ({ from, to }) =>
      new Promise<number>((resolve) => {
        const row = [...document.querySelectorAll("[data-testid=value]")].find(
          (el) => el.textContent === `State: ${from}`,
        )
        ;(row?.querySelector("[data-value]") as HTMLElement | null)?.click()
        const input = document.querySelector(
          "[data-testid=value-input]",
        ) as HTMLInputElement
        input.value = String(to)
        const inspector = () =>
          document.querySelector("[data-testid=inspector]")?.textContent ?? ""
        const start = performance.now()
        new MutationObserver((_, observer) => {
          if (!inspector().includes(`State: ${to}`)) return
          observer.disconnect()
          resolve(performance.now() - start)
        }).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        })
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        )
      }),
    { from, to },
  )

// The median of five edits, as for selections.
test("an edited value shows within 100 ms", { skip }, async (t) => {
  const { browser, panel, budget } = await benchPanel()
  try {
    await selectCell(panel)
    const times: number[] = []
    for (const to of [1, 2, 3, 4, 5])
      times.push(await editCell(panel, to - 1, to))
    const median = [...times].sort((a, b) => a - b)[2] as number
    t.diagnostic(
      `median ${median.toFixed(0)} ms of ${times.map((ms) => ms.toFixed(0)).join(", ")}, budget ${budget(100).toFixed(0)}`,
    )
    assert.ok(median < budget(100), `${median} ms (${times.join(", ")})`)
  } finally {
    await browser.close()
  }
})

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

type Hooked = Window & { __hookMs: number[] }

// Recording (M6) runs inside React's commit hook while the panel watches:
// flushSync's time includes it. The fastest of nine after a warm-up commit: on
// CI's 2-core runner single commits take about 1x or 2x, before the panel opens
// too, and a median of five flipped on 2 vs 3 doubled ones (#85). Each waits
// for the panel to settle (its first load, the warm-up's flush): on that runner
// the panel's work competed with the page for the CPU. One cell's budget is loose: the
// tree mirror walks all 10,000 cloned siblings (+3 to 5 ms on CI, #76).
test("watching keeps a one-cell commit under 2x, all cells under +25%", {
  skip,
}, async (t) => {
  const { browser } = await launchWithExtension(name)
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    await page.goto(BENCH)
    await cellsLoaded(page)
    // Our hook's time in each commit: React reads onCommitFiberRoot on every
    // commit, and the agent's listeners run inside it.
    await page.evaluate(() => {
      const w = window as unknown as Hooked & {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          onCommitFiberRoot: (...args: unknown[]) => unknown
        }
      }
      const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__
      const commit = hook.onCommitFiberRoot
      w.__hookMs = []
      hook.onCommitFiberRoot = function (...args) {
        const start = performance.now()
        try {
          return commit.apply(this, args)
        } finally {
          w.__hookMs.push(performance.now() - start)
        }
      }
    })
    let panel: Awaited<ReturnType<typeof openPanel>> | undefined
    // The flush (100 ms) has reached the panel, and the panel has handled it:
    // three 50 ms timers in a row fire on time. A fixed wait wasn't enough on
    // CI for 10,000 counts. (requestIdleCallback never fires in the panel.)
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await panel?.evaluate(async () => {
        for (let quiet = 0; quiet < 3; ) {
          const start = performance.now()
          await new Promise((resolve) => setTimeout(resolve, 50))
          quiet = performance.now() - start < 60 ? quiet + 1 : 0
        }
      })
    }
    // The fastest hook call of the last all-cells measurement.
    const hooks: Record<string, number> = {}
    const fastest = async (mode: "one" | "all") => {
      await page.evaluate((mode) => (window as Bench).__bench(mode, 1), mode)
      await settle()
      const { times, hook } = await page.evaluate((mode) => {
        const w = window as unknown as Bench & Hooked
        w.__hookMs = []
        return { times: w.__bench(mode, 9), hook: Math.min(...w.__hookMs) }
      }, mode)
      hooks[mode] = hook
      return Math.min(...times)
    }
    const before = { one: await fastest("one"), all: await fastest("all") }
    panel = await openPanel(browser)
    await panel.waitForFunction(
      () =>
        document
          .querySelector("[data-testid=group]")
          ?.textContent?.startsWith("×10000"),
      { timeout: 10_000 },
    )
    await settle()
    const watched = { one: await fastest("one"), all: await fastest("all") }
    const watchedShare = (hooks.all as number) / before.all
    // Outlines on: each commit schedules a frame.
    await panel.click("[data-testid=outlines]")
    await settle()
    const outlined = { one: await fastest("one"), all: await fastest("all") }
    const outlinedShare = (hooks.all as number) / before.all
    const shares = `hook share ${watchedShare.toFixed(3)} → ${outlinedShare.toFixed(3)}`
    t.diagnostic(
      `one ${before.one.toFixed(2)} → ${watched.one.toFixed(2)} → ${outlined.one.toFixed(2)} ms, all ${before.all.toFixed(1)} → ${watched.all.toFixed(1)} → ${outlined.all.toFixed(1)} ms, ${shares}`,
    )
    for (const share of [watchedShare, outlinedShare])
      assert.ok(share < 0.12, `${shares}: ${share.toFixed(3)} >= 0.12`)
    for (const after of [watched, outlined]) {
      const times = JSON.stringify({ before, watched, outlined })
      assert.ok(after.one / before.one < 2, times)
      assert.ok(after.all / before.all < 1.25, times)
    }
  } finally {
    await browser.close()
  }
})

test("the 10k bench scrolls with 100 Suspense outlines and no long task", {
  skip,
}, async (t) => {
  const { browser } = await launchWithExtension(name)
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    await recordShadows(page)
    await page.goto(`${BENCH}?waiting=100`)
    await page.waitForFunction(
      () => document.querySelectorAll("[data-testid=cell]").length === 10000,
      { timeout: 10_000 },
    )
    const panel = await openPanel(browser)
    await panel.waitForSelector("[data-testid=outlines]")
    await panel.click("[data-testid=outlines]")
    await untilOutlines(page, (drawn) => drawn.length === 100, 10_000)
    const run = await page.evaluate(async () => {
      const frame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        )
      const settle = () => new Promise((resolve) => setTimeout(resolve, 200))
      const tasks: number[] = []
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tasks.push(entry.duration)
      }).observe({ type: "longtask" })
      // Proves the observer sees long tasks, as in the tree scroll test.
      await settle()
      setTimeout(() => {
        const start = performance.now()
        while (performance.now() - start < 80);
      })
      await settle()
      const observed = tasks.splice(0).length > 0
      let steps = 0
      for (let last = -1; window.scrollY !== last; steps++) {
        last = window.scrollY
        window.scrollBy(0, 50)
        await frame()
      }
      await settle()
      return { observed, tasks, steps }
    })
    t.diagnostic(JSON.stringify({ ...run, tasks: run.tasks.length }))
    assert.ok(run.observed, "the long-task observer saw no planted task")
    assert.ok(run.steps > 5, `${run.steps} scroll steps`)
    assert.deepEqual(
      run.tasks.filter((ms) => ms > 50),
      [],
    )
    assert.equal((await outlines(page)).length, 100)
  } finally {
    await browser.close()
  }
})
