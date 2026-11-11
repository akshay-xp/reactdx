import path from "node:path"
import { chromium, type Page } from "@playwright/test"
import { build } from "esbuild"
import { ensureRdt } from "../../e2e/rdt.ts"
import { startFixture } from "../../fixtures/start.ts"
import { median, p95 } from "./stats.ts"

declare global {
  interface Window {
    __bench(mode: "all" | "one", iterations: number): number[]
    __reactdxRendered?: number
  }
}

const here = import.meta.dirname
const rdtDir = await ensureRdt("chrome")
const WARMUP = 10
const ITERATIONS = 50
const fixtures = [
  { version: "18.3.1", script: "fixture:18", port: 5218 },
  { version: "19.3.1", script: "fixture:19", port: 5219 },
]

type Case = {
  name: string
  extension?: string
  args?: string[]
  ready: (page: Page) => Promise<unknown>
}

// Vite's React Refresh runtime creates a hook without checkDCE when no devtools hook exists.
const hookKind = (page: Page) =>
  page.evaluate(() => {
    const hook: object | undefined = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
    if (!hook) return "none"
    if ("_isBippyHook" in hook) return "bippy"
    if ("getFiberRoots" in hook) return "rdt"
    return "checkDCE" in hook ? "bare" : "react-refresh"
  })

const expectHook = async (page: Page, expected: string) => {
  const kind = await hookKind(page)
  if (kind !== expected)
    throw new Error(`expected ${expected} hook, found ${kind}`)
}

const cases: Case[] = [
  { name: "no hook", ready: (page) => expectHook(page, "react-refresh") },
  {
    name: "bare hook",
    extension: path.join(here, "bare"),
    ready: (page) => expectHook(page, "bare"),
  },
  {
    name: "bippy + traversal",
    extension: path.join(here, "extension"),
    ready: async (page) => {
      await expectHook(page, "bippy")
      await page.evaluate(() => window.__bench("one", 1))
      if (!(await page.evaluate(() => window.__reactdxRendered)))
        throw new Error("bippy hook not counting")
    },
  },
  {
    name: "RDT, DevTools closed",
    extension: rdtDir,
    ready: (page) => expectHook(page, "rdt"),
  },
  {
    name: "RDT, DevTools open",
    extension: rdtDir,
    args: ["--auto-open-devtools-for-tabs"],
    ready: (page) =>
      page.waitForFunction(
        () =>
          (
            window.__REACT_DEVTOOLS_GLOBAL_HOOK__ as
              | { rendererInterfaces?: Map<unknown, unknown> }
              | undefined
          )?.rendererInterfaces?.size,
        null,
        { timeout: 20000 },
      ),
  },
]

async function measure(benchCase: Case, port: number) {
  const extensionArgs = benchCase.extension
    ? [
        `--disable-extensions-except=${benchCase.extension}`,
        `--load-extension=${benchCase.extension}`,
      ]
    : []
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: false,
    args: [
      ...extensionArgs,
      ...(benchCase.args ?? []),
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  })
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    // RDT registers its hook script from its service worker, so the first load can beat it.
    for (let attempt = 1; ; attempt++) {
      await page.goto(`http://localhost:${port}/bench.html`)
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="cell"]').length === 10000,
      )
      try {
        await benchCase.ready(page)
        break
      } catch (error) {
        if (attempt === 5) throw error
        await page.waitForTimeout(1000)
      }
    }
    const results: Record<string, number[]> = {}
    for (const mode of ["all", "one"] as const) {
      await page.evaluate(([m, n]) => window.__bench(m, n), [
        mode,
        WARMUP,
      ] as const)
      results[mode] = await page.evaluate(([m, n]) => window.__bench(m, n), [
        mode,
        ITERATIONS,
      ] as const)
    }
    return results
  } finally {
    await context.close()
  }
}

await build({
  entryPoints: [path.join(here, "src/hook.js")],
  bundle: true,
  format: "iife",
  outfile: path.join(here, "extension/hook.js"),
  logLevel: "warning",
})
const stops = await Promise.all(
  fixtures.map(({ script, port }) => startFixture(script, port)),
)
try {
  const row = (cells: string[]) =>
    cells
      .map((cell, i) =>
        i < 3 ? cell.padEnd([7, 22, 5][i]) : cell.padStart(10),
      )
      .join(" ")
  console.log(row(["React", "Case", "Mode", "median ms", "p95 ms"]))
  for (const { version, port } of fixtures) {
    for (const benchCase of cases) {
      const results = await measure(benchCase, port)
      for (const [mode, durations] of Object.entries(results)) {
        console.log(
          row([
            version,
            benchCase.name,
            mode,
            median(durations).toFixed(3),
            p95(durations).toFixed(3),
          ]),
        )
      }
    }
  }
} finally {
  for (const stop of stops) stop()
}
