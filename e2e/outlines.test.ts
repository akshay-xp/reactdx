import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import {
  covers,
  outlines,
  overlayPage,
  rectOf,
  summary,
  untilOutlines,
} from "./shadows.ts"

// Suspense outlines on the page (M7 #82): the toolbar toggle draws each
// waiting boundary's outline at its fallback, then the arrived one for 2 s.
const name = process.env.E2E_BROWSER as BrowserName
const only = process.env.E2E_FIXTURE
const fixtures = [
  { fixture: "18", script: "fixture:18", port: 5218 },
  { fixture: "19", script: "fixture:19", port: 5219 },
  { fixture: "next", script: "fixture:next", port: 5220 },
].filter((f) => only === undefined || f.fixture === only)

const stops: (() => void)[] = []
// Node 24 hangs on a file with hooks and no tests (--fixture=multi or prod).
if (fixtures.length) {
  before(async () => {
    for (const { script, port } of fixtures)
      stops.push(await startFixture(script, port))
  })
  after(() => {
    for (const stop of stops) stop()
  })
}

const TOGGLE = "Outline Suspense on the page"

// Firefox mirrors the button, and its pressed state, a moment late.
async function untilPressed(
  panel: { pressed(name: string): Promise<boolean> },
  want: boolean,
  toggle = TOGGLE,
) {
  const read = () => panel.pressed(toggle).catch(() => undefined)
  const deadline = Date.now() + 5000
  while ((await read()) !== want && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(await panel.pressed(toggle), want)
}

// Polls until an outline sits on the element `selector` matches (read while
// it's there, as a fallback goes once its content arrives); returns it.
async function outlinedAt(page: Page, selector: string, ms = 5000) {
  const deadline = Date.now() + ms
  let drawn = await outlines(page)
  while (Date.now() < deadline) {
    const rect = await rectOf(page, selector).catch(() => undefined)
    drawn = await outlines(page)
    const outline = rect && drawn.find((o) => covers(o, rect))
    if (outline) return outline
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(`no outline on ${selector}: ${JSON.stringify(drawn)}`)
}

const suspensePage = (port: number) =>
  overlayPage(
    name,
    `http://localhost:${port}/suspense.html`,
    "[data-testid=again]",
    "SuspensePage",
  )

for (const { fixture, port } of fixtures.filter((f) => f.fixture !== "next"))
  test(`${fixture}: the toggle outlines a waiting boundary, then its arrival, through a reload`, async () => {
    const { browser, page, panel } = await suspensePage(port)
    try {
      await untilPressed(panel, false)
      await page.waitForSelector("[data-testid=comments]", { timeout: 6000 })
      await panel.press(TOGGLE)
      await untilPressed(panel, true)
      await page.click("[data-testid=again]")
      const waiting = await outlinedAt(
        page,
        "[data-testid=comments-fallback]",
        1000,
      )
      assert.equal(waiting.style, "waiting")
      assert.match(
        waiting.label,
        fixture === "18"
          ? /^waiting (\d+ ms|\d\.\ds) · thrown by Comments$/
          : /^waiting (\d+ ms|\d\.\ds) · in Comments$/,
      )
      await page.waitForSelector("[data-testid=comments]", { timeout: 6000 })
      const [arrived] = await untilOutlines(page, (d) =>
        d.some((o) => o.style === "arrived"),
      )
      assert.match(arrived?.label ?? "", /^arrived in \d\.\ds$/)
      await untilOutlines(page, (d) => d.length === 0, 3000)

      // A new document starts with outlines off; the panel turns them on again.
      await page.reload()
      await outlinedAt(page, "[data-testid=comments-fallback]")
      await untilPressed(panel, true)
    } finally {
      await browser.close()
    }
  })

// Flash renders (#91): a render outlines the component for 1 s.
const FLASH = "Flash renders on the page"
for (const { fixture, port } of fixtures.filter((f) => f.fixture !== "next"))
  test(`${fixture}: flash renders outlines a rendered component, takes no click, fades, and heats up`, async () => {
    const { browser, page, panel } = await overlayPage(
      name,
      `http://localhost:${port}/`,
    )
    try {
      await panel.press(FLASH)
      await untilPressed(panel, true, FLASH)
      await page.click("[data-testid=counter]")
      const outline = await outlinedAt(page, "[data-testid=counter]", 1000)
      assert.equal(outline.style, "render")
      assert.equal(outline.label, "Counter")
      const hit = await page.evaluate(
        (x, y) => document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        outline.left + outline.width / 2,
        outline.top + outline.height / 2,
      )
      assert.equal(hit, "counter")
      await untilOutlines(page, (d) => d.length === 0, 2000)

      // Hotter with more renders in a second.
      for (let i = 0; i < 3; i++) await page.click("[data-testid=counter]")
      const [hot] = await untilOutlines(page, (d) =>
        d.some((o) => o.label === "Counter ×3"),
      )
      assert.equal(hot?.heat, "1")
    } finally {
      await browser.close()
    }
  })

for (const { port } of fixtures.filter((f) => f.fixture === "19"))
  test("19: closing the panel removes the outlines", async () => {
    const { browser, page, panel } = await suspensePage(port)
    try {
      await page.waitForSelector("[data-testid=comments]", { timeout: 6000 })
      await panel.press(TOGGLE)
      await page.click("[data-testid=again]")
      await outlinedAt(page, "[data-testid=comments-fallback]")
      await panel.close()
      await untilOutlines(page, (d) => d.length === 0)
    } finally {
      await browser.close()
    }
  })

if (fixtures.some((f) => f.fixture === "next"))
  test("next: a boundary waiting on a Server Component is labeled with it, by navigation", async () => {
    const { browser, page, panel } = await overlayPage(
      name,
      "http://localhost:5220",
    )
    try {
      await panel.press(TOGGLE)
      await page.click("a[href='/shop/slow']")
      await untilOutlines(
        page,
        (d) => d.some((o) => /^waiting .* · Reviews \(server\)$/.test(o.label)),
        10_000,
      )
    } finally {
      await browser.close()
    }
  })

for (const { port } of fixtures.filter((f) => f.fixture === "19"))
  test("19: outlines take no click and follow a scroll and a commit that moves the fallback", async () => {
    const { browser, page, panel } = await suspensePage(port)
    try {
      await page.waitForSelector("[data-testid=grow]")
      await page.waitForSelector("[data-testid=comments]", { timeout: 6000 })
      await panel.press(TOGGLE)
      await page.click("[data-testid=again]")
      const fallback = "[data-testid=comments-fallback]"
      const outline = await outlinedAt(page, fallback, 1000)
      const hit = await page.evaluate(
        (x, y) => document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        outline.left + outline.width / 2,
        outline.top + outline.height / 2,
      )
      assert.equal(hit, "comments-fallback")
      await page.evaluate(() => window.scrollBy(0, 150))
      const scrolled = await outlinedAt(page, fallback, 500)
      assert.ok(Math.abs(scrolled.top - (outline.top - 150)) <= 1)
      await page.click("[data-testid=grow]")
      const moved = await outlinedAt(page, fallback, 500)
      assert.ok(moved.top > scrolled.top + 100, JSON.stringify(moved))
    } finally {
      await browser.close()
    }
  })

if (fixtures.some((f) => f.fixture === "next"))
  test("next: client islands on /shop are lit, the wrapper dashed, hovered and picked", async () => {
    const { browser, page, panel } = await overlayPage(
      name,
      "http://localhost:5220/shop",
      "[data-testid=recommendations]",
      "Shop",
    )
    try {
      await panel.press("Light client islands")
      const drawn = await untilOutlines(
        page,
        (d) =>
          d.some((o) => /^AddToCart · \d+\.\d KB$/.test(o.label)) &&
          d.some((o) => o.label.startsWith("CartCount · ")) &&
          d.some((o) => o.style === "wrapper"),
        10_000,
      )
      assert.deepEqual(
        drawn.map((o) => [o.style, o.label.split(" · ")[0]]).sort(),
        [
          ["island", "AddToCart"],
          ["island", "CartCount"],
          ["wrapper", "ThemeProvider"],
        ],
      )
      assert.match(
        drawn.find((o) => o.style === "wrapper")?.label ?? "",
        /^ThemeProvider · .* · wraps server content$/,
      )
      const { text, dim } = await summary(page)
      assert.match(text ?? "", /^3 client islands · \d+\.\d KB of props$/)
      assert.ok(dim)

      const cart = drawn.find((o) => o.label.startsWith("AddToCart")) as {
        left: number
        top: number
        width: number
        height: number
      }
      const x = cart.left + cart.width / 2
      const y = cart.top + cart.height / 2
      await page.mouse.move(x, y)
      await untilOutlines(page, (d) =>
        d.some((o) => /^AddToCart · .* · from ProductDetails$/.test(o.label)),
      )
      await page.mouse.click(x, y)
      const deadline = Date.now() + 5000
      while ((await panel.selected()) !== "AddToCart" && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(await panel.selected(), "AddToCart")
    } finally {
      await browser.close()
    }
  })

for (const { port } of fixtures.filter((f) => f.fixture === "19"))
  test("19: the islands mode is unavailable without Server Components, and says why", async () => {
    const { browser, panel } = await suspensePage(port)
    try {
      assert.deepEqual(await panel.described("Light client islands"), {
        disabled: true,
        description: "No Server Components on this page",
      })
    } finally {
      await browser.close()
    }
  })
