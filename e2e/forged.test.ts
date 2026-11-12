import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"
import { openPanelText, parseCopies, until } from "./panel-text.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip =
  process.env.E2E_FIXTURE !== undefined && process.env.E2E_FIXTURE !== "18"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:18", 5218)
})
after(() => stop?.())

const xss = (round: number) => `<img src=x onerror=alert(${round})>`

// Valid-shaped tree batches: one out of step, then a whole forged tree whose seq the
// agent won't follow, so only the panel asking for a resync brings the real tree back.
function forgeTree() {
  const tree = (seq: number, ops: unknown[]) =>
    window.postMessage({ source: "reactdx", type: "tree", seq, ops }, "*")
  tree(99, [{ op: "remove", id: 1 }])
  tree(1e6, [
    { op: "reset" },
    {
      op: "add",
      id: 1e6,
      parentId: 0,
      rootId: 1,
      kind: "function",
      name: "<img src=x onerror=alert(3)>",
      key: null,
      index: 0,
    },
  ])
}

// Any page script can post into the window the relay listens on. Each round ends
// with its own forged renderer, so the panel showing it means the round was processed.
function forge(round: number) {
  const post = (data: unknown) => window.postMessage(data, "*")
  post(null)
  post("reactdx")
  post({ source: "reactdx", type: "renderer", id: "1", version: 18 })
  post({ source: "reactdx", type: "renderer", id: 2, version: "x".repeat(1e6) })
  post({ source: "reactdx", type: "unknown" })
  const tree = (seq: number, ops: unknown[]) =>
    post({ source: "reactdx", type: "tree", seq, ops })
  tree(1, [{ op: "add", id: "1" }])
  tree(1, Array(2001).fill({ op: "reset" }))
  // Commands meant for the agent: a resync, and one it doesn't know.
  post({ source: "reactdx-relay", type: "watch" })
  post({ source: "reactdx-relay", type: "explode" })
  post({
    source: "reactdx",
    type: "snapshot",
    roots: Array.from({ length: 1000 }, (_, i) => ({
      rendererId: 1,
      id: i + 1,
      commits: 0,
    })),
  })
  post({
    source: "reactdx",
    type: "renderer",
    id: 59 + round,
    version: `<img src=x onerror=alert(${round})>`,
    bundleType: 1,
    rendererPackageName: "react-dom",
  })
}

test("forged page messages can't break the relay or the panel", {
  skip,
}, async () => {
  const { browser } = await launchWithExtension(name)
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    // The relay's document_start listener can attach after this script runs (always
    // in Chrome), so repeat round 1 over the first 50 ms, still before React loads.
    await page.evaluateOnNewDocument(
      `for (const ms of [0, 5, 20, 50]) setTimeout(() => (${forge})(1), ms)`,
    )
    await page.goto("http://localhost:5218")
    await page.waitForSelector("[data-testid=counter]")
    const panel = await openPanelText(name, browser)
    const real = (text: string) =>
      parseCopies(text).find((c) => c.heading.startsWith("React 18.3.1"))
    await until(panel, (t) => (real(t)?.commits.length ?? 0) > 0)

    await page.evaluate(forge, 2)
    // Firefox mirrors the panel's accessibility tree asynchronously, so poll for a whole list.
    const text = await until(
      panel,
      (t) => t.includes(`React ${xss(2)}`) && real(t) !== undefined,
    )
    // The 1,000-root snapshot was dropped: only the real root is listed.
    assert.deepEqual(real(text)?.commits.length, 1, text)
    // The valid-shaped forged renderer is shown, as text.
    for (const round of [1, 2])
      assert.ok(
        text.includes(`React ${xss(round)} development react-dom`),
        text,
      )
    if (name === "chrome") {
      const frame = await openPanel(browser)
      assert.equal(await frame.$("img"), null)
    }

    await page.evaluate(forgeTree)
    // The forged tree shows until the next real batch puts the panel out of step.
    await until(panel, (t) => real(t)?.names.includes(xss(3)) ?? false)
    if (name === "chrome")
      assert.equal(await (await openPanel(browser)).$("img"), null)

    // The real tree comes back (the panel asks for a resync), and stays live.
    const names = (t: string) => JSON.stringify(real(t)?.names)
    for (const expected of [
      ["App", "Counter", "Clicked"],
      ["App", "Counter"],
    ]) {
      const before = real(await panel())?.commits[0] ?? 0
      await page.$eval("[data-testid=counter]", (el) =>
        (el as HTMLElement).click(),
      )
      const done = (t: string) =>
        (real(t)?.commits[0] ?? 0) > before &&
        names(t) === JSON.stringify(expected)
      const after = await until(panel, done, 5000)
      assert.ok(done(after), after)
    }
  } finally {
    await browser.close()
  }
})

// Inspector traffic a page can forge: one valid-shaped `inspected` for the
// selected node (shown, as text), then malformed ones, each carrying DROPPED, and
// commands the agent must refuse. Runs in the page.
function forgeInspect({ id, valid }: { id: number; valid: boolean }) {
  const post = (data: unknown) => window.postMessage(data, "*")
  const object = (props: Record<string, unknown>) => ({
    type: "object",
    className: "Object",
    id: 1,
    size: Object.keys(props).length,
    props,
  })
  const inspected = (data: Record<string, unknown>) =>
    post({ source: "reactdx", type: "inspected", id, data })
  if (valid) {
    inspected({
      props: object({
        "<img src=x onerror=alert(4)>": "<img src=x onerror=alert(5)>",
      }),
    })
    return
  }
  const nest = (depth: number): unknown[] =>
    depth === 0 ? [] : [{ name: "DROPPED", hooks: nest(depth - 1) }]
  for (const data of [
    { props: { type: "weird", value: "DROPPED" } },
    { props: object({ DROPPED: "x".repeat(1001) }) },
    {
      props: object(
        Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [`DROPPED${i}`, i]),
        ),
      ),
    },
    { props: object({}), hooks: Array(201).fill({ name: "DROPPED" }) },
    { props: object({}), hooks: nest(9) },
    { props: object({}), source: { file: "DROPPED", line: 0, column: 1 } },
    {
      props: object({}),
      hooks: [
        { name: "DROPPED", site: { url: "http://h/a.js", line: 0, column: 1 } },
      ],
    },
  ])
    inspected(data)
  post({
    source: "reactdx",
    type: "expanded",
    objectId: "1",
    offset: 0,
    value: object({ DROPPED: 1 }),
  })
  post({
    source: "reactdx",
    type: "expanded",
    objectId: 1,
    offset: 0,
    value: {
      type: "array",
      id: 1,
      length: 101,
      items: Array(101).fill("DROPPED"),
    },
  })
  const command = (data: Record<string, unknown>) =>
    post({ source: "reactdx-relay", ...data })
  command({ type: "inspect", id: "x" })
  command({ type: "inspect", id: 1e9 })
  command({ type: "expand", objectId: -1, offset: 0 })
  command({ type: "expand", objectId: 1, offset: "a" })
}

type Inspecting = Window & { inspectedId?: number }

test("forged inspect messages and commands break nothing", {
  skip,
}, async () => {
  const { browser } = await launchWithExtension(name)
  try {
    const [page] = await browser.pages()
    if (!page) throw new Error("no page")
    await page.goto("http://localhost:5218")
    await page.waitForSelector("[data-testid=counter]")
    // The agent's replies name the selected node's id.
    await page.evaluate(() =>
      addEventListener("message", ({ data }) => {
        if (data?.source === "reactdx" && data.type === "inspected")
          (window as Inspecting).inspectedId = data.id
      }),
    )
    const panel = await openPanelText(name, browser)
    await until(panel, (t) =>
      parseCopies(t).some((c) => c.names.includes("Counter")),
    )
    await panel.select("Counter")
    const real = await until(panel.inspector, (t) => t.includes("State: 0"))
    assert.ok(real.includes("State: 0"), real)
    const id = await page.evaluate(() => (window as Inspecting).inspectedId)
    assert.ok(id)

    await page.evaluate(forgeInspect, { id, valid: true })
    const forged = (t: string) =>
      t.includes('"<img src=x onerror=alert(5)>"') &&
      t.includes("<img src=x onerror=alert(4)>")
    const shown = await until(panel.inspector, forged)
    assert.ok(forged(shown), shown)

    // Each malformed one is dropped whole: the forged view stays.
    await page.evaluate(forgeInspect, { id, valid: false })
    await new Promise((resolve) => setTimeout(resolve, 500))
    // Firefox mirrors the panel's text asynchronously: poll for a whole read.
    const after = await until(panel.inspector, forged)
    assert.ok(!after.includes("DROPPED"), after)
    assert.ok(forged(after), after)
    if (name === "chrome")
      assert.equal(await (await openPanel(browser)).$("img"), null)

    // The agent and panel still work. A forged inspect command (valid-shaped ids)
    // moves the agent's selection: a page can change its own panel's view, and
    // selecting again brings the real one back, live.
    await panel.select("App")
    await until(panel.inspector, (t) => /^App( |$)/.test(t))
    await panel.select("Counter")
    await until(panel.inspector, (t) => t.includes("State: 0"))
    await page.click("[data-testid=counter]")
    const live = await until(panel.inspector, (t) => t.includes("State: 1"))
    assert.ok(live.includes("State: 1"), live)
  } finally {
    await browser.close()
  }
})
