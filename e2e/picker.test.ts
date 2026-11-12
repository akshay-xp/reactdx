import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { type PanelText, panelFor, parseCopies, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"
const URL_18 = "http://localhost:5218"
const PICK = "Pick element"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

// Polls an async check until it holds or 5 s pass; returns the last value.
async function poll<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  const deadline = Date.now() + 5000
  let value = await read()
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    value = await read()
  }
  return value
}

async function pickerOn(panel: PanelText) {
  const text = await until(panel, (t) =>
    (parseCopies(t)[0]?.names ?? []).includes("Counter"),
  )
  assert.ok(parseCopies(text)[0]?.names.includes("Counter"), text)
  await panel.press(PICK)
  assert.equal(await poll(() => panel.pressed(PICK), Boolean), true)
}

test("a pick selects the clicked component and doesn't click the page", {
  skip,
}, async () => {
  const { browser, page, panel } = await panelFor(name, URL_18, "after")
  try {
    await page.waitForSelector("[data-testid=counter]")
    await pickerOn(panel)
    await page.click("[data-testid=counter]")
    assert.equal(await poll(panel.selected, (s) => s === "Counter"), "Counter")
    assert.equal(
      await page.$eval("[data-testid=counter]", (el) => el.textContent),
      "Count: 0",
    )
    assert.equal(
      await poll(
        () => panel.pressed(PICK),
        (p) => !p,
      ),
      false,
    )
  } finally {
    await browser.close()
  }
})
