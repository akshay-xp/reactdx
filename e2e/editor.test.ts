import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { BrowserName } from "./launch.ts"
import { panelFor, parseCopies, until } from "./panel-text.ts"

// Opening goes through the dev server, which launches the editor its env names:
// a stub (e2e/editor/code) that records its arguments. Named `code`, both Vite
// and Next pass it `file:line:column`. Chrome only: Firefox's panel is out of reach.
const name = process.env.E2E_BROWSER as BrowserName
const only = process.env.E2E_FIXTURE
const repo = path.resolve(import.meta.dirname, "..")
const vite = path.join(repo, "fixtures/vite/src/Counter.jsx:13:7")
const fixtures = [
  { fixture: "18", script: "fixture:18", port: 5218, opens: vite },
  { fixture: "19", script: "fixture:19", port: 5219, opens: vite },
  {
    fixture: "next",
    script: "fixture:next",
    port: 5220,
    opens: path.join(repo, "fixtures/next/app/Counter.jsx:15:7"),
  },
  // A static server: neither endpoint answers, so the location is copied.
  { fixture: "multi", script: "fixture:multi", port: 5221, opens: undefined },
].filter((f) => name === "chrome" && (only === undefined || f.fixture === only))

const logs = mkdtempSync(path.join(tmpdir(), "reactdx-editor-"))
const log = path.join(logs, "launched.txt")
const stops: (() => void)[] = []
// Node 24 hangs on a file with hooks and no tests (Firefox, --fixture=prod).
if (fixtures.length) {
  before(async () => {
    const stub = path.join(import.meta.dirname, "editor/code")
    Object.assign(process.env, {
      LAUNCH_EDITOR: stub,
      REACT_EDITOR: stub,
      REACTDX_EDITOR_LOG: log,
    })
    for (const { script, port } of fixtures)
      stops.push(await startFixture(script, port))
  })
  after(() => {
    for (const stop of stops) stop()
    rmSync(logs, { recursive: true, force: true })
  })
}

const launched = async () => {
  try {
    return readFileSync(log, "utf8")
  } catch {
    return ""
  }
}

for (const { fixture, port, opens } of fixtures)
  test(`${fixture}: Open in editor reaches the dev server, else copies`, async () => {
    const { browser, page, panel } = await panelFor(
      name,
      `http://localhost:${port}`,
      "after",
    )
    try {
      await page.waitForSelector("[data-testid=counter]")
      // Next's tree is taller than the panel, and still filling in: wait for
      // Counter at its end before selecting it.
      await until(
        async () => {
          await panel.end()
          return panel()
        },
        (t) => parseCopies(t).some((c) => c.names.includes("Counter")),
      )
      await panel.select("Counter")
      const frame = panel.frame
      assert.ok(frame)
      const button = "[data-testid=source] button"
      await frame.waitForSelector(button)
      const title = await frame.$eval("[data-testid=source] [title]", (el) =>
        el.getAttribute("title"),
      )
      await frame.evaluate(() =>
        document.addEventListener("copy", (event) => {
          const area = event.target as HTMLTextAreaElement
          document.body.dataset.copied = area.value
        }),
      )
      // A trusted click (copying needs a user gesture), found afresh: a re-send
      // can re-render the row.
      await frame.click(button)
      if (opens) {
        const text = await until(launched, (t) => t.includes(opens))
        assert.ok(text.includes(opens), `log never contained ${opens}: ${text}`)
      } else {
        const inspector = await until(panel.inspector, (t) =>
          t.includes("Copied"),
        )
        assert.ok(inspector.includes("Copied"), inspector)
        const copied = await frame.evaluate(() => document.body.dataset.copied)
        assert.equal(copied, title)
      }
    } finally {
      await browser.close()
    }
  })
