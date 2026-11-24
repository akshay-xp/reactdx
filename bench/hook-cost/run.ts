import path from "node:path"
import { build } from "esbuild"
import { ensureRdt } from "../../e2e/rdt.ts"
import { startFixture } from "../../fixtures/start.ts"
import { type Case, expectHook, rdtAttached, withBench } from "./browser.ts"
import { median, p95 } from "./stats.ts"

const here = import.meta.dirname
const rdtDir = await ensureRdt("chrome")
const WARMUP = 10
const ITERATIONS = 50
const fixtures = [
  { version: "18.3.1", script: "fixture:18", port: 5218 },
  { version: "19.3.1", script: "fixture:19", port: 5219 },
]

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
    ready: rdtAttached,
  },
]

const measure = (benchCase: Case, port: number) =>
  withBench(benchCase, port, async (page) => {
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
  })

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
