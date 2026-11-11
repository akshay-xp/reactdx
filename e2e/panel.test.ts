import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { type Copy, panelFor, parseCopies, total, until } from "./panel-text.ts"
import { plainPage } from "./plain.ts"

const name = process.env.E2E_BROWSER as BrowserName
const plainUrl = plainPage()

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
          name,
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
