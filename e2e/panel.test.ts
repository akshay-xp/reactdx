import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension } from "./launch.ts"
import {
  type Copy,
  openPanelText,
  type PanelText,
  parseCopies,
  until,
} from "./panel-text.ts"
import { plainPage } from "./plain.ts"

const name = process.env.E2E_BROWSER as BrowserName
const plainUrl = plainPage()

const total = (copies: Copy[]) =>
  copies.flatMap((c) => c.commits).reduce((a, b) => a + b, 0)

// Opens the panel before or after the page loads; with one tab, DevTools has one window.
async function panelFor(url: string, order: "before" | "after") {
  const { browser } = await launchWithExtension(name)
  const [page] = await browser.pages()
  if (!page) throw new Error("no page")
  let panel: PanelText | undefined
  if (order === "before") panel = await openPanelText(name, browser)
  await page.goto(url)
  if (order === "after") panel = await openPanelText(name, browser)
  if (!panel) throw new Error("no panel")
  return { browser, page, panel }
}

for (const [script, port, expected] of [
  ["fixture:18", 5218, [/^React 18\.3\.1 development react-dom$/]],
  ["fixture:19", 5219, [/^React 19\.3\.1 development react-dom$/]],
  [
    "fixture:next",
    5220,
    [
      /^React 19\.3\.0-canary-\S+ development react-dom$/,
      /^React \S+ production react-dom$/,
    ],
  ],
  [
    "fixture:multi",
    5221,
    [
      /^React 18\.3\.1 development react-dom$/,
      /^React 19\.3\.1 development react-dom$/,
    ],
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
      test(`lists each React copy and counts commits (DevTools opened ${order} load)`, async () => {
        const { browser, page, panel } = await panelFor(
          `http://localhost:${port}`,
          order,
        )
        try {
          await page.waitForSelector("[data-testid=counter]")
          // Roots arrive with the agent's next snapshot, after hydration on Next.
          const ready = (copies: Copy[]) =>
            copies.length === expected.length &&
            copies.every(
              (c) => c.heading.includes("production") || c.commits.length > 0,
            )
          const text = await until(panel, (t) => ready(parseCopies(t)))
          const copies = parseCopies(text)
          assert.equal(copies.length, expected.length, text)
          for (const [i, pattern] of expected.entries())
            assert.match(copies[i]?.heading ?? "", pattern)
          for (const copy of copies.filter((c) =>
            c.heading.includes("development"),
          ))
            assert.ok(copy.commits.length >= 1, text)
          const before = total(copies)
          await page.$eval("[data-testid=counter]", (el) =>
            (el as HTMLElement).click(),
          )
          const after = await until(
            panel,
            (t) => total(parseCopies(t)) > before,
            2000,
          )
          assert.ok(total(parseCopies(after)) > before, after)
        } finally {
          await browser.close()
        }
      })
    }
  })
}

test("a page without React says so", async () => {
  const { browser, panel } = await panelFor(plainUrl(), "after")
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
    const { browser, panel } = await panelFor("http://localhost:5222", "after")
    try {
      const notice =
        "Production build of React 19.3.1. ReactDX inspects development builds."
      assert.equal(await until(panel, (t) => t === notice), notice)
    } finally {
      await browser.close()
    }
  })
})
