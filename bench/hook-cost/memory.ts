import path from "node:path"
import type { Page } from "@playwright/test"
import { ensureRdt } from "../../e2e/rdt.ts"
import { startFixture } from "../../fixtures/start.ts"
import { type Case, expectHook, rdtAttached, withBench } from "./browser.ts"

declare global {
  interface Window {
    __reactdxCommits?: number
  }
}

const rdtDir = await ensureRdt("chrome")
const reactdxDir = path.resolve(
  import.meta.dirname,
  "../../apps/extension/.output/chrome-mv3",
)
const WARMUP = 10
const COMMITS = 50
const fixtures = [
  { version: "18.3.1", script: "fixture:18", port: 5218 },
  { version: "19.3.1", script: "fixture:19", port: 5219 },
]

const reactdxInstalled = (page: Page) =>
  page.waitForFunction(() => Symbol.for("reactdx") in globalThis)

type MemoryCase = Case & {
  // Starts the case's recording after load; returns a check that it ran.
  start?: (page: Page) => Promise<() => Promise<string | undefined>>
}

const cases: MemoryCase[] = [
  { name: "no devtools", ready: (page) => expectHook(page, "react-refresh") },
  {
    name: "RDT, DevTools closed",
    extension: rdtDir,
    ready: (page) => expectHook(page, "rdt"),
  },
  {
    name: "RDT, DevTools open",
    extension: rdtDir,
    args: ["--auto-open-devtools-for-tabs"],
    ready: rdtAttached,
  },
  {
    name: "RDT, Profiler recording",
    extension: rdtDir,
    args: ["--auto-open-devtools-for-tabs"],
    ready: rdtAttached,
    // The Profiler's record button, with "Record why each component
    // rendered" on, calls the same on every renderer interface.
    start: async (page) => {
      await page.evaluate(() => {
        const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ as unknown as {
          rendererInterfaces: Map<
            number,
            { startProfiling(changes: boolean, timeline: boolean): void }
          >
        }
        for (const renderer of hook.rendererInterfaces.values())
          renderer.startProfiling(true, false)
      })
      return () =>
        page.evaluate(() => {
          const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ as unknown as {
            rendererInterfaces: Map<
              number,
              {
                getProfilingData(): {
                  dataForRoots: { commitData: unknown[] }[]
                }
              }
            >
          }
          const commits = [...hook.rendererInterfaces.values()]
            .flatMap((renderer) => renderer.getProfilingData().dataForRoots)
            .reduce((sum, root) => sum + root.commitData.length, 0)
          return commits ? `${commits} commits profiled` : undefined
        })
    },
  },
  {
    name: "ReactDX, panel closed",
    extension: reactdxDir,
    ready: reactdxInstalled,
  },
  {
    name: "ReactDX, panel open",
    extension: reactdxDir,
    ready: reactdxInstalled,
    // What an open panel asks of the page: the relay's watch, which turns on
    // the tree and the recorder. The panel itself runs in DevTools.
    start: async (page) => {
      await page.evaluate(() => {
        window.__reactdxCommits = 0
        window.addEventListener("message", (event) => {
          if (event.data?.source === "reactdx" && event.data.type === "commits")
            window.__reactdxCommits =
              (window.__reactdxCommits ?? 0) + event.data.commits.length
        })
        window.postMessage({ source: "reactdx-relay", type: "watch" }, "*")
      })
      await page.waitForTimeout(300)
      return async () => {
        await page.waitForTimeout(300)
        const commits = await page.evaluate(() => window.__reactdxCommits)
        return commits ? `${commits} commits recorded` : undefined
      }
    },
  },
]

// Live heap of the page's renderer after a full collection: the page's
// world, the extensions' content scripts and their backends (not DevTools).
const heapMB = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("HeapProfiler.enable")
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.collectGarbage")
  const { usedSize } = await cdp.send("Runtime.getHeapUsage")
  await cdp.detach()
  return usedSize / 1e6
}

const measure = (benchCase: MemoryCase, port: number) =>
  withBench(benchCase, port, async (page) => {
    const ran = await benchCase.start?.(page)
    await page.evaluate((n) => window.__bench("all", n), WARMUP)
    const loaded = await heapMB(page)
    await page.evaluate((n) => window.__bench("all", n), COMMITS)
    const check = await ran?.()
    if (ran && !check) throw new Error(`${benchCase.name}: nothing recorded`)
    return { loaded, after: await heapMB(page), check }
  })

const stops = await Promise.all(
  fixtures.map(({ script, port }) => startFixture(script, port)),
)
try {
  const row = (cells: string[]) =>
    cells
      .map((cell, i) => (i < 2 ? cell.padEnd([7, 24][i]) : cell.padStart(12)))
      .join(" ")
  console.log(
    `Heap after ${WARMUP} warm-up commits, then after ${COMMITS} more, each rendering all 10,000 cells.`,
  )
  console.log(row(["React", "Case", "loaded MB", "after MB", "growth MB"]))
  for (const { version, port } of fixtures)
    for (const benchCase of cases) {
      const { loaded, after, check } = await measure(benchCase, port)
      console.log(
        row([
          version,
          benchCase.name,
          loaded.toFixed(1),
          after.toFixed(1),
          (after - loaded).toFixed(1),
        ]) + (check ? `   (${check})` : ""),
      )
    }
} finally {
  for (const stop of stops) stop()
}
