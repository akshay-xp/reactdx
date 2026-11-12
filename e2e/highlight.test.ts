import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension } from "./launch.ts"
import { openPanelText, parseCopies, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"
const URL_18 = "http://localhost:5218"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

type Shadows = Window & { __shadows: ShadowRoot[] }

// The overlay's shadow root is closed; the agent runs in the page's world, so a
// wrapped attachShadow (as any page script could do) keeps a handle on it.
async function highlightPage() {
  const { browser } = await launchWithExtension(name)
  const [page] = await browser.pages()
  if (!page) throw new Error("no page")
  await page.evaluateOnNewDocument(() => {
    const shadows: ShadowRoot[] = []
    ;(window as unknown as Shadows).__shadows = shadows
    const attach = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) {
      const root = attach.call(this, init)
      shadows.push(root)
      return root
    }
  })
  await page.goto(URL_18)
  await page.waitForSelector("[data-testid=counter]")
  const panel = await openPanelText(name, browser)
  const text = await until(panel, (t) =>
    (parseCopies(t)[0]?.names ?? []).includes("Counter"),
  )
  assert.ok(parseCopies(text)[0]?.names.includes("Counter"), text)
  return { browser, page, panel }
}

// The connected overlay hosts, and for the first its boxes and label.
const overlays = (page: Page) =>
  page.evaluate(() => {
    const roots = (window as unknown as Shadows).__shadows.filter(
      (root) => root.host.isConnected,
    )
    const rect = (el: Element) => {
      const { left, top, width, height } = el.getBoundingClientRect()
      return { left, top, width, height }
    }
    const [first] = roots
    return {
      count: roots.length,
      boxes: [...(first?.querySelectorAll("[data-box]") ?? [])].map(rect),
      label: first?.textContent ?? "",
      button: rect(
        document.querySelector("[data-testid=counter]") as HTMLElement,
      ),
    }
  })

const waitFor = async (page: Page, count: number) => {
  const deadline = Date.now() + 5000
  let state = await overlays(page)
  while (state.count !== count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    state = await overlays(page)
  }
  assert.equal(state.count, count, JSON.stringify(state))
  return state
}

test("hovering a row highlights its component; leaving removes it", {
  skip,
}, async () => {
  const { browser, page, panel } = await highlightPage()
  try {
    await panel.hover("Counter")
    const shown = await waitFor(page, 1)
    assert.equal(shown.boxes.length, 1, JSON.stringify(shown))
    const [box] = shown.boxes
    for (const side of ["left", "top", "width", "height"] as const)
      assert.ok(
        Math.abs((box?.[side] ?? Number.NaN) - shown.button[side]) <= 1,
        `${side}: ${JSON.stringify(shown)}`,
      )
    assert.equal(shown.label, "Counter")
    await panel.leave()
    await waitFor(page, 0)
  } finally {
    await browser.close()
  }
})

// Every page element's computed style, the overlay's host left out.
const styles = (page: Page) =>
  page.evaluate(() => {
    const hosts = new Set(
      (window as unknown as Shadows).__shadows.map((root) => root.host),
    )
    return [...document.querySelectorAll("*")]
      .filter((el) => !hosts.has(el))
      .map((el) => {
        const style = getComputedStyle(el)
        return [...style].map(
          (prop) => `${prop}:${style.getPropertyValue(prop)}`,
        )
      })
  })

test("the overlay changes no page element's computed style", {
  skip,
}, async () => {
  const { browser, page, panel } = await highlightPage()
  try {
    const before = await styles(page)
    await panel.hover("Counter")
    await waitFor(page, 1)
    assert.deepEqual(await styles(page), before)
  } finally {
    await browser.close()
  }
})
