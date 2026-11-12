import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, parseCopies, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const only = process.env.E2E_FIXTURE
const fixtures = [
  { fixture: "18", script: "fixture:18", port: 5218 },
  { fixture: "19", script: "fixture:19", port: 5219 },
  { fixture: "next", script: "fixture:next", port: 5220 },
].filter((f) => only === undefined || f.fixture === only)

const stops: (() => void)[] = []
before(async () => {
  for (const { script, port } of fixtures)
    stops.push(await startFixture(script, port))
})
after(() => {
  for (const stop of stops) stop()
})

for (const { fixture, port } of fixtures)
  test(`${fixture}: the inspector shows the selection's props, live`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=counter]")
      // Next's tree is taller than the panel: its components are at the end.
      const read = async () => {
        await panel.end()
        return panel()
      }
      const listed = await until(read, (t) =>
        parseCopies(t).some((c) => c.names.includes("Counter")),
      )
      assert.ok(
        parseCopies(listed).some((c) => c.names.includes("Counter")),
        listed,
      )
      await panel.select("Counter")
      const props = await until(
        panel.inspector,
        (t) => t.includes('label: "Count"') && t.includes("State: 0"),
      )
      assert.ok(props.includes('label: "Count"'), props)
      assert.ok(props.includes("State: 0"), props)
      await page.click("[data-testid=counter]")
      const state = await until(panel.inspector, (t) => t.includes("State: 1"))
      assert.ok(state.includes("State: 1"), state)

      await panel.press("Show DOM elements")
      await until(read, (t) => t.includes("button"))
      await panel.select("button")
      const before = 'children: ["Count", ": ", 1]'
      const shown = await until(panel.inspector, (t) => t.includes(before))
      assert.ok(shown.includes(before), shown)

      await page.click("[data-testid=counter]")
      const after = 'children: ["Count", ": ", 2]'
      const live = await until(panel.inspector, (t) => t.includes(after))
      assert.ok(live.includes(after), live)

      // Vite's Counter is rendered by App; Next's by the Page Server Component,
      // which isn't in the tree.
      await panel.select("Counter")
      const owner = fixture === "next" ? "Page" : "App"
      const owners = await until(panel.inspector, (t) =>
        t.includes(`Rendered by ${owner}`),
      )
      assert.ok(owners.includes(`Rendered by ${owner}`), owners)
      if (fixture !== "next") {
        await panel.press("App")
        // App has nothing else to show: its inspector is its header alone.
        const header = await until(panel.inspector, (t) => /^App( |$)/.test(t))
        assert.match(header, /^App( |$)/)
        assert.equal(await panel.selected(), "App")
      }
    } finally {
      await browser.close()
    }
  })

// Every top-level hook in fixtures/vite/src/hooks.jsx, as the inspector shows it.
const HOOKS = [
  "State: 1",
  'Reducer: "r"',
  "Ref: {a: 1}",
  "Memo: 3",
  "Callback: ƒ",
  "Effect: [1]",
  "LayoutEffect",
  "InsertionEffect: []",
  "ImperativeHandle: {focus: ƒ focus()}",
  'DeferredValue: "d"',
  "Transition: false",
  'SyncExternalStore: "s"',
  "Id: ",
  'Context(Theme): "dark"',
  'useCart: "2 items"',
  // The Context section.
  'Context Theme: "dark"',
]
const HOOKS_19 = [
  "Use: 5",
  'ActionState: "a"',
  'Optimistic: "o"',
  "FormStatus: {",
  "EffectEvent: ƒ",
]

for (const { fixture, port } of fixtures.filter((f) => f.fixture !== "next"))
  test(`${fixture}: every hook type shows with its value`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/hooks.html`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=hooks]")
      await until(panel, (t) =>
        parseCopies(t).some((c) => c.names.includes("Hooks")),
      )
      await panel.select("Hooks")
      const expected = fixture === "19" ? [...HOOKS, ...HOOKS_19] : HOOKS
      const text = await until(panel.inspector, (t) =>
        expected.every((hook) => t.includes(hook)),
      )
      for (const hook of expected)
        assert.ok(text.includes(hook), `${hook} in ${text}`)
    } finally {
      await browser.close()
    }
  })
