import assert from "node:assert/strict"
import type { Page } from "puppeteer"
import { type BrowserName, launchWithExtension } from "./launch.ts"
import { openPanelText, parseCopies, until } from "./panel-text.ts"

type Shadows = Window & { __shadows: ShadowRoot[] }

// The highlight overlay's shadow root is closed; the agent runs in the page's world,
// so a wrapped attachShadow (as any page script could do) keeps a handle on it.
// Opens the page with that preload, then the panel, and waits for the tree.
export async function overlayPage(name: BrowserName, url: string) {
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
  await page.goto(url)
  await page.waitForSelector("[data-testid=counter]")
  const panel = await openPanelText(name, browser)
  const text = await until(panel, (t) =>
    (parseCopies(t)[0]?.names ?? []).includes("Counter"),
  )
  assert.ok(parseCopies(text)[0]?.names.includes("Counter"), text)
  return { browser, page, panel }
}

// The connected overlay hosts, and for the first its boxes and label.
export const overlays = (page: Page) =>
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

// Polls until that many overlay hosts are connected; asserts it.
export async function waitForOverlays(page: Page, count: number) {
  const deadline = Date.now() + 5000
  let state = await overlays(page)
  while (state.count !== count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    state = await overlays(page)
  }
  assert.equal(state.count, count, JSON.stringify(state))
  return state
}

// Every page element's computed style, the overlay's host left out.
export const styles = (page: Page) =>
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
