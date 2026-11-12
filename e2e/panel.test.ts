import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { type Copy, panelFor, parseCopies, total, until } from "./panel-text.ts"
import { plainPage } from "./plain.ts"

const name = process.env.E2E_BROWSER as BrowserName
const plainUrl = plainPage()

// Each fixture's tree check, given its development copies (Counter's click toggles Clicked).
const exactly = (names: string[]) => (copies: Copy[]) =>
  copies.every((c) => JSON.stringify(c.names) === JSON.stringify(names))
const app = exactly(["App", "Counter"])
const appClicked = exactly(["App", "Counter", "Clicked"])
const counters = exactly(["Counter"])
const oneClicked = (copies: Copy[]) =>
  copies.filter((c) => c.names.includes("Clicked")).length === 1 &&
  copies.every((c) => c.names.includes("Counter"))
// Next's App Router wraps the page in its own components.
const nextTree = (copies: Copy[]) =>
  copies.every(
    (c) => c.names.includes("Counter") && !c.names.includes("Clicked"),
  )
const nextClicked = (copies: Copy[]) =>
  copies.every((c) => c.names.includes("Clicked"))

for (const [script, port, expected, tree, clicked] of [
  [
    "fixture:18",
    5218,
    [/^React 18\.3\.1 development react-dom$/],
    app,
    appClicked,
  ],
  [
    "fixture:19",
    5219,
    [/^React 19\.3\.1 development react-dom$/],
    app,
    appClicked,
  ],
  [
    "fixture:next",
    5220,
    [
      /^React 19\.3\.0-canary-\S+ development react-dom$/,
      /^React \S+ production react-dom$/,
    ],
    nextTree,
    nextClicked,
  ],
  [
    "fixture:multi",
    5221,
    [
      /^React 18\.3\.1 development react-dom$/,
      /^React 19\.3\.1 development react-dom$/,
    ],
    counters,
    oneClicked,
  ],
] as const) {
  if (
    process.env.E2E_FIXTURE &&
    script !== `fixture:${process.env.E2E_FIXTURE}`
  )
    continue
  describe(`${script} panel`, () => {
    let stop: (() => void) | undefined
    before(async () => (stop = await startFixture(script, port)))
    after(() => stop?.())

    for (const order of ["after", "before"] as const) {
      test(`lists each React copy, its commits and its tree (DevTools opened ${order} load)`, async () => {
        const { browser, page, panel } = await panelFor(
          name,
          `http://localhost:${port}`,
          order,
        )
        try {
          await page.waitForSelector("[data-testid=counter]")
          // Next's tree is taller than the panel; its app components are last.
          const read = async () => {
            await panel.end()
            return panel()
          }
          // Roots arrive with the agent's next snapshot, after hydration on Next.
          const development = (copies: Copy[]) =>
            copies.filter((c) => c.heading.includes("development"))
          const ready = (copies: Copy[]) =>
            copies.length === expected.length &&
            copies.every(
              (c) => c.heading.includes("production") || c.commits.length > 0,
            ) &&
            tree(development(copies))
          const text = await until(read, (t) => ready(parseCopies(t)))
          const copies = parseCopies(text)
          assert.equal(copies.length, expected.length, text)
          for (const [i, pattern] of expected.entries())
            assert.match(copies[i]?.heading ?? "", pattern)
          for (const copy of development(copies))
            assert.ok(copy.commits.length >= 1, text)
          assert.ok(tree(development(copies)), text)
          for (const copy of copies.filter((c) =>
            c.heading.includes("production"),
          ))
            assert.deepEqual(copy.names, [], text)
          const before = total(copies)
          await page.$eval("[data-testid=counter]", (el) =>
            (el as HTMLElement).click(),
          )
          const done = (t: string) =>
            total(parseCopies(t)) > before &&
            clicked(development(parseCopies(t)))
          const after = await until(read, done, 2000)
          assert.ok(done(after), after)
        } finally {
          await browser.close()
        }
      })
    }
  })
}

test("a page without React says so", async () => {
  const { browser, panel } = await panelFor(name, plainUrl(), "after")
  try {
    const text = await until(panel, (t) => t === "No React on this page")
    assert.equal(text, "No React on this page")
  } finally {
    await browser.close()
  }
})

describe("fixture:prod panel", {
  skip:
    process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "prod",
}, () => {
  let stop: (() => void) | undefined
  before(async () => (stop = await startFixture("fixture:prod", 5222)))
  after(() => stop?.())

  test("production React shows the notice", async () => {
    const { browser, panel } = await panelFor(
      name,
      "http://localhost:5222",
      "after",
    )
    try {
      const notice =
        "Production build of React 19.3.1. ReactDX inspects development builds."
      assert.equal(await until(panel, (t) => t === notice), notice)
    } finally {
      await browser.close()
    }
  })
})

describe("fixture:19 tree page", {
  skip:
    process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "19",
}, () => {
  let stop: (() => void) | undefined
  before(async () => (stop = await startFixture("fixture:19", 5219)))
  after(() => stop?.())

  test("every component kind shows its name, badge and key; wrappers hidden", async () => {
    const { browser, panel } = await panelFor(
      name,
      "http://localhost:5219/tree.html",
      "after",
    )
    try {
      const expected = [
        "Kinds",
        "Klass",
        "Memoized",
        "memo",
        "Fwd",
        "forwardRef",
        "Named",
        "forwardRef",
        "Suspense",
        "Lazy",
        "lazy",
        "Theme",
        "Theme",
        "Context",
        "Profiler",
        "Item",
        "Anonymous",
        "Item",
        'key="a"',
        "Item",
        'key="b"',
        "Activity",
        "Item",
      ]
      const names = (t: string) => JSON.stringify(parseCopies(t)[0]?.names)
      const text = await until(
        panel,
        (t) => names(t) === JSON.stringify(expected),
      )
      assert.equal(names(text), JSON.stringify(expected), text)
    } finally {
      await browser.close()
    }
  })
})

describe("fixture:18 DOM elements filter", {
  skip:
    process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18",
}, () => {
  let stop: (() => void) | undefined
  before(async () => (stop = await startFixture("fixture:18", 5218)))
  after(() => stop?.())

  test("Show DOM elements shows host rows and hides them again", async () => {
    const { browser, panel } = await panelFor(
      name,
      "http://localhost:5218",
      "after",
    )
    try {
      const names = (t: string) => JSON.stringify(parseCopies(t)[0]?.names)
      const expectNames = async (expected: string[]) => {
        const want = JSON.stringify(expected)
        const text = await until(panel, (t) => names(t) === want)
        assert.equal(names(text), want, text)
      }
      await expectNames(["App", "Counter"])
      await panel.press("Show DOM elements")
      await expectNames(["App", "p", "Counter", "button"])
      await panel.press("Show DOM elements")
      await expectNames(["App", "Counter"])
    } finally {
      await browser.close()
    }
  })
})
