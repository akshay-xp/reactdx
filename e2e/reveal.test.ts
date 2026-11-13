import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Frame, Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { type PanelText, panelFor, until } from "./panel-text.ts"

// Chrome: layout, read from the panel's document. Next's tree is deeper than the
// pane, both ways.
const name = process.env.E2E_BROWSER as BrowserName
const skip =
  name !== "chrome" ||
  (process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "next")
const URL_NEXT = "http://localhost:5220"
const SELECTED = "[data-testid=node][aria-selected=true]"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:next", 5220)
})
after(() => stop?.())

async function nextPanel() {
  const { browser, page, panel } = await panelFor(name, URL_NEXT, "after")
  await page.waitForSelector("[data-testid=counter]")
  await panel.end()
  await until(panel, (t) => t.includes("Counter"))
  const frame = panel.frame
  if (!frame) throw new Error("no panel frame")
  return { browser, page, panel, frame }
}

const toTopLeft = (frame: Frame) =>
  frame.evaluate(() => {
    const pane = document.querySelector("[data-testid=trees]") as HTMLElement
    pane.scrollTop = 0
    pane.scrollLeft = 0
  })

async function pickCounter(page: Page, panel: PanelText, frame: Frame) {
  await panel.press("Pick element")
  await page.click("[data-testid=counter]")
  await frame.waitForFunction(
    (selected) =>
      document.querySelector(`${selected} [data-testid=name]`)?.textContent ===
      "Counter",
    { timeout: 5000 },
    SELECTED,
  )
}

// Where the selected row sits in the pane's view, after a frame for the scroll
// to settle. Its content runs from the toggle (start) to its last part (end:
// name, badge or key).
const view = (frame: Frame) =>
  frame.evaluate(async (selected) => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const pane = document.querySelector("[data-testid=trees]") as HTMLElement
    const box = pane.getBoundingClientRect()
    const row = document.querySelector(selected) as HTMLElement
    const name = (
      row.querySelector("[data-testid=name]") as HTMLElement
    ).getBoundingClientRect()
    const start = (
      row.querySelector("[data-toggle]") as HTMLElement
    ).getBoundingClientRect()
    const end = (row.lastElementChild as HTMLElement).getBoundingClientRect()
    return {
      // A row clear of the bottom edge, where an overlay scrollbar sits (macOS
      // draws the horizontal one over the content).
      clear: name.bottom - box.top <= pane.clientHeight - 20 + 1,
      vertical: name.top >= box.top && name.bottom <= box.bottom,
      start: start.left >= box.left,
      // Clear of the right edge, where macOS draws the vertical scrollbar over
      // the content.
      end: end.right <= box.left + pane.clientWidth - 20 + 1,
    }
  }, SELECTED)

test("a pick inside a collapsed subtree shows its row, scrolled into view both ways", {
  skip,
}, async () => {
  const { browser, page, panel, frame } = await nextPanel()
  try {
    // Collapse the tree's first row (Counter is inside it) and go to the top left.
    await toTopLeft(frame)
    await frame.evaluate(() =>
      (
        document.querySelector(
          "[data-testid=node] [data-toggle]",
        ) as HTMLElement
      ).click(),
    )
    await pickCounter(page, panel, frame)
    assert.deepEqual(await view(frame), {
      clear: true,
      vertical: true,
      start: true,
      end: true,
    })
  } finally {
    await browser.close()
  }
})

test("picking the selected component again scrolls to it again", {
  skip,
}, async () => {
  const { browser, page, panel, frame } = await nextPanel()
  try {
    await pickCounter(page, panel, frame)
    await toTopLeft(frame)
    await pickCounter(page, panel, frame)
    assert.deepEqual(await view(frame), {
      clear: true,
      vertical: true,
      start: true,
      end: true,
    })
  } finally {
    await browser.close()
  }
})

test("a row wider than the pane is scrolled to its start", {
  skip,
}, async () => {
  const { browser, frame } = await nextPanel()
  try {
    // Narrower than the deep SegmentTrieNode row with its key.
    await frame.evaluate(() => {
      const pane = document.querySelector("[data-testid=trees]") as HTMLElement
      pane.style.width = "200px"
    })
    await toTopLeft(frame)
    // Scrolled far right first: the start is out of view to the left.
    await frame.evaluate(() => {
      const pane = document.querySelector("[data-testid=trees]") as HTMLElement
      pane.scrollLeft = pane.scrollWidth
    })
    await frame.type("[data-testid=search]", "SegmentTrieNode")
    const shown = await view(frame)
    assert.deepEqual(
      { start: shown.start, end: shown.end },
      { start: true, end: false },
      JSON.stringify(shown),
    )
  } finally {
    await browser.close()
  }
})
