import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, parseCopies, selectListed, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const only = process.env.E2E_FIXTURE
const fixtures = [
  { fixture: "18", script: "fixture:18", port: 5218 },
  { fixture: "19", script: "fixture:19", port: 5219 },
].filter((f) => only === undefined || f.fixture === only)

const stops: (() => void)[] = []
// Node 24 hangs on a file with hooks and no tests.
if (fixtures.length) {
  before(async () => {
    for (const { script, port } of fixtures)
      stops.push(await startFixture(script, port))
  })
  after(() => {
    for (const stop of stops) stop()
  })
}

for (const { fixture, port } of fixtures)
  test(`${fixture}: the inspector says why each component rendered`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/insight.html`,
      "after",
    )
    const shows = async (...parts: string[]) => {
      const text = await until(panel.inspector, (t) =>
        parts.every((part) => t.includes(part)),
      )
      for (const part of parts) assert.ok(text.includes(part), text)
    }
    try {
      await page.waitForSelector("[data-testid=insight]")
      // The page's first commit comes before the agent watches: nothing yet.
      await selectListed(panel, "Shown", (t) =>
        t.includes("No renders since DevTools opened."),
      )
      // The full reasons are folded under Renders; it stays open from here.
      await panel.key("Renders", "ArrowRight")
      await shows("No renders recorded since DevTools opened.")
      await page.click("[data-testid=bump]")
      await shows("because props count changed (1 → 2).")
      await shows("Props changed", "count: 1 → 2")
      // A memo child given an inline object and callback: new references.
      await selectListed(panel, "Styled", (t) =>
        t.includes("data: {count: 1} → {count: 2}"),
      )
      await shows(
        'style: {color: "red"} → {color: "red"} same value, new reference',
        "new function",
      )
      await shows(
        "because props style, onPick and data changed.",
        "style is a new object with the same value each render.",
      )
      const styled = await panel.inspector()
      assert.ok(!/\{count: 2\} (same value|new function)/.test(styled), styled)
      await page.click("[data-testid=add]")
      await selectListed(panel, "Late", (t) => t.includes("Mounted"))

      // Mounted with Late, after the panel opened: its mount is recorded too.
      await selectListed(panel, "Stepped", (t) => t.includes("Mounted"))
      for (let i = 0; i < 3; i++) await page.click("[data-testid=step]")
      await shows("4 renders recorded", "State #1: 2 → 3")
      await selectListed(panel, "Plain", (t) => t.includes("Parent rendered"))
      await shows(
        "because its parent Insight rendered. None of its props changed.",
      )
      await panel.press("Force re-render")
      await shows("Forced to render", "Forced")
      // The parent's name selects it.
      await panel.press("Insight")
      await until(panel.inspector, (t) => t.startsWith("Insight "))
      assert.ok((await panel.inspector()).startsWith("Insight "))

      await selectListed(panel, "Stateful")
      await page.click("[data-testid=state]")
      await shows("because State #1 changed (0 → 1).")
      await shows("State changed", "State #1: 0 → 1")

      await selectListed(panel, "Counter")
      await page.click("[data-testid=count]")
      await shows("Triggered by Counter (State #1: 3 → 4)")

      await selectListed(panel, "Reader")
      await page.click("[data-testid=theme]")
      await shows("because Theme changed.")
      await shows("Context changed", 'Theme: "dark" → "light"')

      await selectListed(panel, "Effects")
      await page.click("[data-testid=b]")
      await shows("Effects ran", "Effect #3: deps [1] changed", "[1]: 1 → 2")
      await shows("Effect #5: no deps")
      const effects = await panel.inspector()
      assert.ok(!effects.includes("Effect #4"), effects)

      await page.click("[data-testid=rekey]")
      await selectListed(panel, "Item", (t) =>
        t.includes("Remounted: key changed (a → b)"),
      )
      await shows("ago: key changed (a → b).")
      await page.click("[data-testid=wrap]")
      await selectListed(panel, "Inner", (t) =>
        t.includes("Remounted: ancestor section remounted"),
      )
      await shows("ago: section remounted.")
      await panel.press("section")
      await until(panel.inspector, (t) => t.startsWith("section "))
      assert.ok((await panel.inspector()).startsWith("section "))
    } finally {
      await browser.close()
    }
  })

for (const { fixture, port } of fixtures)
  test(`${fixture}: Updates lists causes, groups bursts and links to components`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/insight.html`,
      "after",
    )
    const inspectorShows = async (part: string) => {
      const text = await until(panel.inspector, (t) => t.includes(part))
      assert.ok(text.includes(part), text)
    }
    const panelShows = async (part: string) => {
      const text = await until(panel, (t) => t.includes(part))
      assert.ok(text.includes(part), text)
    }
    const inspectorLacks = async (part: string) => {
      const text = await until(panel.inspector, (t) => !t.includes(part))
      assert.ok(!text.includes(part), text)
    }
    const rows = async (check: (rows: string[]) => boolean) => {
      const deadline = Date.now() + 5000
      let list = await panel.commits()
      while (!check(list) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        list = await panel.commits()
      }
      assert.ok(check(list), JSON.stringify(list))
      return list
    }
    try {
      await page.waitForSelector("[data-testid=insight]")
      await selectListed(panel, "Counter")
      await panel.key("Renders", "ArrowRight")
      await page.click("[data-testid=count]")
      await page.click("[data-testid=count]")
      await inspectorShows("2 renders recorded")

      await panel.tab("Updates")
      // Two clicks with the same cause: one group.
      await rows((list) => /^Counter · 2 updates/.test(list[0] ?? ""))
      // The newest: Counter's second update (its group opens on the pick).
      await panel.key("Updates", "Home")
      await panelShows("Counter set State #1: 4 → 5")
      await panelShows("Counter State changed")
      // Its name opens Counter, the inspector pinned to that update.
      await panel.press("Counter")
      await inspectorShows("Show latest")
      await inspectorShows("State #1: 4 → 5")
      await selectListed(panel, "Shown", (t) =>
        t.includes("Didn't render in this update."),
      )
      await panel.press("Show latest")
      await inspectorLacks("Didn't render in this update.")

      // An update Counter didn't render in, for the filter to leave out.
      await page.click("[data-testid=state]")
      await selectListed(panel, "Counter", (t) =>
        t.includes("2 renders recorded"),
      )
      await panel.press("2 renders recorded")
      await panelShows("Pick an update to see what rendered and why.")
      assert.equal(await panel.pressed("Only Counter"), true)
      // Counter's two updates, as their group.
      await rows((list) => list.length === 1)
      await panel.key("Updates", "End")
      await panelShows("Counter set State #1: 3 → 4")
      await panel.key("Updates", "Escape")
      await panelShows("Pick an update to see what rendered and why.")
      await panel.press("Only Counter")
      await rows((list) => list.length === 2)

      // A burst of typing in the list: one group, its renders mostly wasted.
      await page.click("[data-testid=list]")
      await page.waitForSelector("[data-testid=search]")
      await page.type("[data-testid=search]", "abcd")
      await rows((list) => /^Products · 4 updates/.test(list[0] ?? ""))
      await page.click("[data-testid=count]")
      await rows((list) => /^Counter: 5 → 6/.test(list[0] ?? ""))
      await panel.key("Updates", "Home")
      await panel.key("Updates", "ArrowDown")
      await panelShows('Products set State #1: "abc" → "abcd"')
      await panelShows("40 wasted, hidden")
      assert.ok(!(await panel()).includes("Product Parent rendered"))
      await panel.press("Hide renders with no reason")
      await panelShows("Product ×40 Parent rendered")

      // Clear starts the list over.
      await panel.press("Clear")
      await panelShows("No updates since DevTools opened.")
      await page.click("[data-testid=count]")
      await rows((list) => list.length === 1)
    } finally {
      await browser.close()
    }
  })

for (const { fixture, port } of fixtures)
  test(`${fixture}: the tree counts renders and folds a long list`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/insight.html`,
      "after",
    )
    const shows = async (
      part: string,
      read = panel as () => Promise<string>,
    ) => {
      const text = await until(read, (t) => t.includes(part))
      assert.ok(text.includes(part), text)
    }
    try {
      await page.waitForSelector("[data-testid=insight]")
      // Watched before the list mounts, so its mount counts.
      await until(panel, (t) =>
        parseCopies(t).some((c) => c.names.includes("Insight")),
      )
      await page.click("[data-testid=list]")
      await page.waitForSelector("[data-testid=search]")
      await page.type("[data-testid=search]", "abc")
      // A mount and 3 keystrokes each, the keystrokes for nothing.
      await shows("Product ×40 · 120 wasted")
      await panel.select("Product")
      await panel.key("Product", "ArrowRight")
      await shows('Product key="0" 4')
      await panel.key("Product", "ArrowLeft")
      await until(panel, (t) => !t.includes('Product key="0"'))

      // A pick inside the closed group opens it on the picked row.
      await panel.press("Pick element")
      await until(
        async () => String(await panel.pressed("Pick element")),
        (t) => t === "true",
      )
      const products = await page.$$("[data-testid=product]")
      await products[6]?.click()
      await shows('Product key="6"', panel.inspector)
      await shows(
        "3 of its 4 renders were like this. Wrap Product in memo() to skip them.",
        panel.inspector,
      )
      await shows('Product key="6" 4')
    } finally {
      await browser.close()
    }
  })
