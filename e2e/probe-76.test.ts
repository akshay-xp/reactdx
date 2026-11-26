// DIAG #76: not for merge. Times our hook per commit on bench.html with the
// panel watching, with single steps of the tree walk patched out of agent.js.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  name !== "chrome" ||
  (process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "19")
const BENCH = "http://localhost:5219/bench.html"
const AGENT = path.resolve(
  import.meta.dirname,
  "../apps/extension/.output/chrome-mv3/agent.js",
)
type Bench = Window & { __bench: (mode: string, n: number) => number[] }

const T = "\t\t\t\t\t"
const UNTOUCHED = `const alt = kid.alternate;\n${T}if (alt !== null && (kid.flags & 1) === 0 && kid.memoizedProps === alt.memoizedProps && kid.memoizedState === alt.memoizedState && kid.child === alt.child && kid.type === alt.type && !__updaters?.has(kid) && !__updaters?.has(alt)) return;\n${T}`
const VARIANTS: Record<string, [string, string][]> = {
  base: [],
  "no-fibers-set": [
    [
      `fibers.set(id, kid);\n${T}const name = label(kid);`,
      "const name = label(kid);",
    ],
  ],
  "no-label": [
    [
      `const name = label(kid);\n${T}if (name !== names.get(id))`,
      `const name = names.get(id);\n${T}if (name !== names.get(id))`,
    ],
  ],
  "no-track": [
    [`track(kid, id, ops);\n${T}visit(kid, id);`, "visit(kid, id);"],
  ],
  "no-visit": [
    [
      `visit(kid, id);\n${T}update(kid, id, id, rootId, ops);`,
      "update(kid, id, id, rootId, ops);",
    ],
  ],
  "no-update-call": [
    [
      `update(kid, id, id, rootId, ops);\n\t\t\t\t} else`,
      "if (kids.length < 1000) update(kid, id, id, rootId, ops);\n\t\t\t\t} else",
    ],
  ],
  "no-per-kid": [
    [
      "kids.forEach((kid, index) => {\n\t\t\t\tconst id = next[index];",
      "if (same && kids.length > 1000) { children.set(key, next); return; }\n\t\t\tkids.forEach((kid, index) => {\n\t\t\t\tconst id = next[index];",
    ],
  ],
  "no-sibling-walk": [
    [
      "if (children.has(key) && bailedOut(fiber)) return;",
      "if (children.has(key) && bailedOut(fiber)) return;\n\t\t\tif ((children.get(key)?.length ?? 0) > 1000) return;",
    ],
  ],
  untouched: [
    [
      `fibers.set(id, kid);\n${T}const name = label(kid);`,
      `fibers.set(id, kid);\n${T}${UNTOUCHED}const name = label(kid);`,
    ],
  ],
  "untouched-lazy": [
    [
      `fibers.set(id, kid);\n${T}const name = label(kid);`,
      `${UNTOUCHED}fibers.set(id, kid);\n${T}const name = label(kid);`,
    ],
  ],
}
// The untouched variants read the commit's updaters, set where the tree's commit starts.
const UPDATERS: [string, string] = [
  "const update = (fiber, key, parentId, rootId, ops) => {",
  "let __updaters;\n\t\tconst update = (fiber, key, parentId, rootId, ops) => {",
]
const COMMIT: [string, string] = [
  "visit = onVisit;",
  "__updaters = root.memoizedUpdaters;\n\t\t\t\tvisit = onVisit;",
]

let original = ""
let stop: (() => void) | undefined
before(async () => {
  if (skip) return
  original = readFileSync(AGENT, "utf8")
  stop = await startFixture("fixture:19", 5219)
})
after(() => {
  if (original) writeFileSync(AGENT, original)
  stop?.()
})

const med = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[xs.length >> 1] as number
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

for (const round of [1, 2])
  for (const [variant, patches] of Object.entries(VARIANTS))
    test(`${variant} (${round})`, { skip }, async (t) => {
      let agent = original
      for (const [from, to] of variant.startsWith("untouched")
        ? [...patches, UPDATERS, COMMIT]
        : patches) {
        if (agent.split(from).length !== 2)
          throw new Error(`${variant}: no single ${from}`)
        agent = agent.replace(from, to)
      }
      writeFileSync(AGENT, agent)
      const { browser } = await launchWithExtension(name)
      try {
        const [page] = await browser.pages()
        if (!page) throw new Error("no page")
        await page.goto(BENCH)
        await page.waitForFunction(
          () =>
            document.querySelectorAll("[data-testid=cell]").length === 10000,
          { timeout: 10_000 },
        )
        await page.evaluate(() => {
          const w = window as unknown as Record<string, any>
          const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__
          const commit = hook.onCommitFiberRoot
          w.__hookMs = []
          hook.onCommitFiberRoot = function (...args: unknown[]) {
            const start = performance.now()
            try {
              return commit.apply(this, args)
            } finally {
              w.__hookMs.push(performance.now() - start)
            }
          }
        })
        const settle = () => new Promise((r) => setTimeout(r, 1500))
        const measure = async (
          mode: "one" | "all",
          rounds: number,
          n: number,
        ) => {
          const hooks: number[] = []
          const commits: number[] = []
          for (let i = 0; i < rounds; i++) {
            await page.evaluate(
              (mode) => (window as unknown as Bench).__bench(mode, 1),
              mode,
            )
            await settle()
            const r = await page.evaluate(
              ({ mode, n }) => {
                const w = window as unknown as Bench & { __hookMs: number[] }
                w.__hookMs = []
                return { times: w.__bench(mode, n), hooks: w.__hookMs }
              },
              { mode, n },
            )
            hooks.push(...r.hooks)
            commits.push(...r.times)
          }
          return { hooks, commits }
        }
        const unwatched = await measure("one", 2, 40)
        const panel = await openPanel(browser)
        await panel.waitForFunction(
          () =>
            document
              .querySelector("[data-testid=group]")
              ?.textContent?.startsWith("×10000"),
          { timeout: 10_000 },
        )
        await settle()
        const one = await measure("one", 5, 40)
        const all = await measure("all", 2, 5)
        t.diagnostic(
          `RESULT ${variant} (${round}): one hook mean ${mean(one.hooks).toFixed(3)} ms, commit fastest ${Math.min(...unwatched.commits).toFixed(2)} → ${Math.min(...one.commits).toFixed(2)} median ${med(unwatched.commits).toFixed(2)} → ${med(one.commits).toFixed(2)} ms; all hook mean ${mean(all.hooks).toFixed(2)} ms, commit fastest ${Math.min(...all.commits).toFixed(1)} ms`,
        )
      } finally {
        await browser.close()
      }
    })
