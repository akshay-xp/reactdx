import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import type { HookRecord } from "../packages/page/src/hook.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

let extension: Awaited<ReturnType<typeof launchWithExtension>>
before(
  async () =>
    (extension = await launchWithExtension(
      process.env.E2E_BROWSER as BrowserName,
    )),
)
after(() => extension?.browser.close())

for (const [script, port, renderers] of [
  ["fixture:18", 5218, 1],
  ["fixture:19", 5219, 1],
  ["fixture:next", 5220, 2], // the dev overlay brings its own production react-dom
  ["fixture:multi", 5221, 2],
] as const) {
  if (
    process.env.E2E_FIXTURE &&
    script !== `fixture:${process.env.E2E_FIXTURE}`
  )
    continue
  describe(script, () => {
    let stop: (() => void) | undefined
    before(async () => (stop = await startFixture(script, port)))
    after(() => stop?.())

    test("React registers with our hook", async () => {
      const page = await extension.browser.newPage()
      const messages: string[] = []
      page.on("console", (message) => messages.push(message.text()))
      await page.goto(`http://localhost:${port}`)
      await page.waitForSelector("[data-testid=counter]")
      assert.deepEqual(
        await page.evaluate(() => ({
          own: Object.hasOwn(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__"),
          renderers: (window as unknown as Record<symbol, HookRecord>)[
            Symbol.for("reactdx")
          ]?.renderers.size,
        })),
        { own: false, renderers },
      )
      assert.deepEqual(
        messages.filter((text) => text.includes("Download the React DevTools")),
        [],
      )
      await page.close()
    })
  })
}

test("the devtools page creates the ReactDX panel", async () => {
  assert.equal(await extension.panelCreated(), true)
  // Firefox can't open moz-extension:// frames over BiDi, so only Chrome renders the panel here.
  if (process.env.E2E_BROWSER !== "chrome") return
  const panel = await openPanel(extension.browser)
  assert.ok(await panel.waitForSelector("[data-testid=panel-root]"))
})
