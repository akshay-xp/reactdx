import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import type { Frame } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"
import { plainPage } from "./plain.ts"

const name = process.env.E2E_BROWSER as BrowserName
const plainUrl = plainPage()

type Listed = { heading: string; commits: number[] }

const listed = (panel: Frame) =>
  panel.$$eval("[data-testid=renderer]", (copies) =>
    copies.map((copy) => ({
      heading: copy.querySelector("h2")?.textContent ?? "",
      commits: [...copy.querySelectorAll("[data-testid=root]")].map((root) =>
        Number(root.getAttribute("data-commits")),
      ),
    })),
  )

const total = (copies: Listed[]) =>
  copies.flatMap((c) => c.commits).reduce((a, b) => a + b, 0)

// Opens the panel before or after the page loads; with one tab, DevTools has one window.
async function panelFor(url: string, order: "before" | "after") {
  const { browser } = await launchWithExtension(name)
  const [page] = await browser.pages()
  if (!page) throw new Error("no page")
  let panel: Frame | undefined
  if (order === "before") panel = await openPanel(browser)
  await page.goto(url)
  if (order === "after") panel = await openPanel(browser)
  if (!panel) throw new Error("no panel")
  return { browser, page, panel }
}

// Firefox loads the panel in an extension process that tests can't read yet (#21 Task 6).
const skip = name !== "chrome"

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
      test(`lists each React copy and counts commits (DevTools opened ${order} load)`, {
        skip,
      }, async () => {
        const { browser, page, panel } = await panelFor(
          `http://localhost:${port}`,
          order,
        )
        try {
          await page.waitForSelector("[data-testid=counter]")
          await panel.waitForFunction(
            (n) =>
              document.querySelectorAll("[data-testid=renderer]").length === n,
            { timeout: 5000 },
            expected.length,
          )
          const copies = await listed(panel)
          assert.equal(copies.length, expected.length, JSON.stringify(copies))
          for (const [i, pattern] of expected.entries())
            assert.match(copies[i]?.heading ?? "", pattern)
          for (const copy of copies.filter((c) =>
            c.heading.includes("development"),
          ))
            assert.ok(copy.commits.length >= 1, JSON.stringify(copies))
          const before = total(copies)
          await page.$eval("[data-testid=counter]", (el) =>
            (el as HTMLElement).click(),
          )
          await panel.waitForFunction(
            (n) =>
              [...document.querySelectorAll("[data-testid=root]")]
                .map((r) => Number(r.getAttribute("data-commits")))
                .reduce((a, b) => a + b, 0) > n,
            { timeout: 2000 },
            before,
          )
        } finally {
          await browser.close()
        }
      })
    }
  })
}

test("a page without React says so", { skip }, async () => {
  const { browser, panel } = await panelFor(plainUrl(), "after")
  try {
    await panel.waitForFunction(
      () => document.body.textContent?.includes("No React on this page"),
      { timeout: 5000 },
    )
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

  test("production React shows the notice", { skip }, async () => {
    const { browser, panel } = await panelFor("http://localhost:5222", "after")
    try {
      await panel.waitForFunction(
        () =>
          document.body.textContent?.includes(
            "Production build of React 19.3.1. ReactDX inspects development builds.",
          ),
        { timeout: 5000 },
      )
    } finally {
      await browser.close()
    }
  })
})
