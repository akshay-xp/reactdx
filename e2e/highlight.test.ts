import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { overlayPage, styles, waitForOverlays } from "./shadows.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"
const URL_18 = "http://localhost:5218"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

test("hovering a row highlights its component; leaving removes it", {
  skip,
}, async () => {
  const { browser, page, panel } = await overlayPage(name, URL_18)
  try {
    await panel.hover("Counter")
    const shown = await waitForOverlays(page, 1)
    assert.equal(shown.boxes.length, 1, JSON.stringify(shown))
    const [box] = shown.boxes
    for (const side of ["left", "top", "width", "height"] as const)
      assert.ok(
        Math.abs((box?.[side] ?? Number.NaN) - shown.button[side]) <= 1,
        `${side}: ${JSON.stringify(shown)}`,
      )
    assert.equal(shown.label, "Counter")
    await panel.leave()
    await waitForOverlays(page, 0)
  } finally {
    await browser.close()
  }
})

test("the overlay changes no page element's computed style", {
  skip,
}, async () => {
  const { browser, page, panel } = await overlayPage(name, URL_18)
  try {
    const before = await styles(page)
    await panel.hover("Counter")
    await waitForOverlays(page, 1)
    assert.deepEqual(await styles(page), before)
  } finally {
    await browser.close()
  }
})

test("closing the panel removes the overlay", { skip }, async () => {
  const { browser, page, panel } = await overlayPage(name, URL_18)
  try {
    await panel.hover("Counter")
    await waitForOverlays(page, 1)
    await panel.close()
    await waitForOverlays(page, 0)
  } finally {
    await browser.close()
  }
})
