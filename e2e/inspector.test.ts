import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { openPanelText, panelFor, selectListed, until } from "./panel-text.ts"

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

for (const { fixture, port } of fixtures)
  test(`${fixture}: the inspector shows the selection's props, live`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=counter]")
      const props = await selectListed(
        panel,
        "Counter",
        (t) => t.includes('label: "Count"') && t.includes("State: 0"),
      )
      assert.ok(props.includes('label: "Count"'), props)
      assert.ok(props.includes("State: 0"), props)

      // Where Counter's first element is written (fixtures/*/Counter.jsx).
      const source = fixture === "next" ? "Counter.jsx:15" : "Counter.jsx:13"
      const located = await until(panel.inspector, (t) => t.includes(source))
      assert.ok(located.includes(source), located)
      await page.click("[data-testid=counter]")
      const state = await until(panel.inspector, (t) => t.includes("State: 1"))
      assert.ok(state.includes("State: 1"), state)

      await panel.press("Show DOM elements")
      const before = 'children: ["Count", ": ", 1]'
      const shown = await selectListed(panel, "button", (t) =>
        t.includes(before),
      )
      assert.ok(shown.includes(before), shown)

      await page.click("[data-testid=counter]")
      const after = 'children: ["Count", ": ", 2]'
      const live = await until(panel.inspector, (t) => t.includes(after))
      assert.ok(live.includes(after), live)

      // Vite's Counter is rendered by App; Next's by the Page Server Component,
      // which isn't in the tree.
      const owner = fixture === "next" ? "Page" : "App"
      const owners = await selectListed(panel, "Counter", (t) =>
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
      // The Context section, alphabetical: 19's form status context (named
      // Context) reads before Theme.
      const expected =
        fixture === "19"
          ? [...HOOKS, ...HOOKS_19, "Context Context: {", '} Theme: "dark"']
          : [...HOOKS, 'Context Theme: "dark"']
      const text = await selectListed(panel, "Hooks", (t) =>
        expected.every((hook) => t.includes(hook)),
      ).catch((error: Error) => error.message)
      for (const hook of expected)
        assert.ok(text.includes(hook), `${hook} in ${text}`)
    } finally {
      await browser.close()
    }
  })

for (const { fixture, port } of fixtures.filter((f) => f.fixture !== "next"))
  test(`${fixture}: inspector search filters rows and highlights matches`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}/hooks.html`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=hooks]")
      await selectListed(panel, "Hooks", (t) => t.includes("State: 1"))
      await panel.type("Search values", "dark")
      const found = await until(
        panel.inspector,
        (t) => t.includes('Theme: "dark"') && !t.includes("State: 1"),
      )
      assert.ok(found.includes('Context(Theme): "dark"'), found)
      assert.ok(found.includes('Theme: "dark"'), found)
      assert.ok(!found.includes("State: 1"), found)
      if (name === "chrome")
        assert.ok(
          ((await panel.frame?.evaluate(
            () => CSS.highlights.get("reactdx-search")?.size ?? 0,
          )) ?? 0) >= 2,
        )
      await panel.type("Search values", "")
      const cleared = await until(panel.inspector, (t) =>
        t.includes("State: 1"),
      )
      assert.ok(cleared.includes("State: 1"), cleared)
    } finally {
      await browser.close()
    }
  })

// Hook names are opt-in: off, the parser chunk (hook-names) never loads.
const NAMED = [
  "State(one): 1",
  "Ref(box): {a: 1}",
  "Ref(handle)",
  'useCart(cart): "2 items"',
]
for (const { port } of fixtures.filter((f) => f.fixture === "19"))
  test("19: Hook names, off by default, name hooks and stay on", async () => {
    const url = `http://localhost:${port}`
    const { browser, page, panel } = await panelFor(name, url, "after")
    try {
      await page.waitForSelector("[data-testid=counter]")
      const off = await selectListed(panel, "Counter", (t) =>
        t.includes("State: 0"),
      )
      assert.ok(off.includes("State: 0"), off)
      assert.equal(await panel.pressed("Hook names"), false)
      // Chrome: the panel's requests. A module loads once, so a request for the
      // parser after the press also proves it hadn't loaded before.
      const requested: string[] = []
      panel.frame?.page().on("request", (r) => requested.push(r.url()))
      const parser = () => requested.some((url) => url.includes("hook-names"))
      if (name === "chrome") assert.equal(parser(), false)

      await panel.press("Hook names")
      const on = await until(panel.inspector, (t) =>
        t.includes("State(count): 0"),
      )
      assert.ok(on.includes("State(count): 0"), on)
      if (name === "chrome") assert.equal(parser(), true)

      await page.goto(`${url}/hooks.html`)
      await page.waitForSelector("[data-testid=hooks]")
      const hooks = await selectListed(panel, "Hooks", (t) =>
        NAMED.every((n) => t.includes(n)),
      )
      for (const named of NAMED) assert.ok(hooks.includes(named), hooks)

      // A new DevTools on a new tab: the setting comes back from storage.
      await panel.close()
      const next = await browser.newPage()
      await next.goto(url)
      await next.waitForSelector("[data-testid=counter]")
      const again = await openPanelText(name, browser)
      const kept = await selectListed(again, "Counter", (t) =>
        t.includes("State(count): 0"),
      )
      assert.ok(kept.includes("State(count): 0"), kept)
      assert.equal(await again.pressed("Hook names"), true)
    } finally {
      await browser.close()
    }
  })

// Chrome: layout, read from the panel's document. Next's tree is deeper than the
// pane is wide, so the pane scrolls sideways.
for (const { port } of fixtures.filter((f) => f.fixture === "next"))
  test("next: the selection spans a wide tree; inspector rows are as tall as tree rows", {
    skip: name !== "chrome",
  }, async () => {
    const { browser, panel } = await panelFor(
      name,
      `http://localhost:${port}`,
      "after",
    )
    try {
      await selectListed(panel, "Counter", (t) => t.includes("State: 0"))
      const layout = await panel.frame?.evaluate(() => {
        const pane = document.querySelector("[data-testid=trees]") as Element
        const row = document.querySelector(
          "[data-testid=node][aria-selected=true]",
        ) as Element
        const height = (el: Element) => el.getBoundingClientRect().height
        const rows = [
          ...document.querySelectorAll(
            "[data-testid=inspector] [data-testid=value], [data-testid=inspector] [data-testid=owner]",
          ),
        ].map(
          (el) =>
            (el.closest("[data-testid=value]") ?? el.parentElement) as Element,
        )
        return {
          wide: pane.scrollWidth > pane.clientWidth,
          // The row's right edge in the pane's content, against the content's
          // width less the copy's 8 px padding (scrollWidth is a whole pixel).
          spans:
            row.getBoundingClientRect().right -
              pane.getBoundingClientRect().left +
              pane.scrollLeft +
              9 >=
            pane.scrollWidth,
          rows: rows.length > 0,
          short: rows.filter((el) => height(el) < height(row)).length,
        }
      })
      assert.deepEqual(layout, {
        wide: true,
        spans: true,
        rows: true,
        short: 0,
      })
    } finally {
      await browser.close()
    }
  })
