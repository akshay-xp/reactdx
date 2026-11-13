import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, until } from "./panel-text.ts"

// Chrome: layout, read from the panel's document. Next's tree is deeper than the
// pane, both ways.
const name = process.env.E2E_BROWSER as BrowserName
const skip =
  name !== "chrome" ||
  (process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "next")
const URL_NEXT = "http://localhost:5220"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:next", 5220)
})
after(() => stop?.())

test("a pick inside a collapsed subtree shows its row, scrolled into view both ways", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_NEXT, "after")
  try {
    await page.waitForSelector("[data-testid=counter]")
    await panel.end()
    await until(panel, (t) => t.includes("Counter"))
    const frame = panel.frame
    if (!frame) throw new Error("no panel frame")
    // Collapse the tree's first row (Counter is inside it) and go to the top left.
    await frame.evaluate(() => {
      const pane = document.querySelector("[data-testid=trees]") as HTMLElement
      pane.scrollTop = 0
      pane.scrollLeft = 0
    })
    await frame.evaluate(() =>
      (
        document.querySelector(
          "[data-testid=node] [data-toggle]",
        ) as HTMLElement
      ).click(),
    )
    await panel.press("Pick element")
    await page.click("[data-testid=counter]")
    await frame.waitForFunction(
      () =>
        document.querySelector(
          "[data-testid=node][aria-selected=true] [data-testid=name]",
        )?.textContent === "Counter",
      { timeout: 5000 },
    )
    // A frame for the scroll to settle.
    await frame.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    )
    const view = await frame.evaluate(() => {
      const pane = (
        document.querySelector("[data-testid=trees]") as HTMLElement
      ).getBoundingClientRect()
      const name = (
        document.querySelector(
          "[data-testid=node][aria-selected=true] [data-testid=name]",
        ) as HTMLElement
      ).getBoundingClientRect()
      const box = document.querySelector("[data-testid=trees]") as HTMLElement
      return {
        // A row clear of the bottom edge, where an overlay scrollbar sits
        // (macOS draws the horizontal one over the content).
        clear: name.bottom - pane.top <= box.clientHeight - 20 + 1,
        vertical: name.top >= pane.top && name.bottom <= pane.bottom,
        horizontal: name.left >= pane.left && name.right <= pane.right,
      }
    })
    assert.deepEqual(view, { clear: true, vertical: true, horizontal: true })
  } finally {
    await browser.close()
  }
})
