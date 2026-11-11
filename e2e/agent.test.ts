import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, describe, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension } from "./launch.ts"

const name = process.env.E2E_BROWSER as BrowserName
let extension: Awaited<ReturnType<typeof launchWithExtension>>
const plain = createServer((_, response) =>
  response
    .writeHead(200, { "content-type": "text/html" })
    .end("<p>No React here</p>"),
)
let plainUrl = ""

before(async () => {
  await new Promise<void>((resolve) => plain.listen(0, resolve))
  plainUrl = `http://localhost:${(plain.address() as AddressInfo).port}/`
  extension = await launchWithExtension(name)
})
after(async () => {
  await extension?.browser.close()
  plain.close()
})

const agentFlag = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as Record<symbol, unknown>)[
        Symbol.for("reactdx.agent")
      ],
  )

test("no agent on a page without React", async () => {
  const page = await extension.browser.newPage()
  await page.goto(plainUrl)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  assert.equal(await agentFlag(page), undefined)
  await page.close()
})

for (const [script, port, injected] of [
  ["fixture:18", 5218, true],
  ["fixture:19", 5219, true],
  ["fixture:next", 5220, true],
  ["fixture:multi", 5221, true],
  ["fixture:prod", 5222, undefined],
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

    test(
      injected
        ? "the agent is injected once development React connects"
        : "no agent for production React",
      async () => {
        const page = await extension.browser.newPage()
        await page.goto(`http://localhost:${port}`)
        await page.waitForSelector("[data-testid=counter]")
        if (injected)
          await page
            .waitForFunction(
              () =>
                (window as unknown as Record<symbol, unknown>)[
                  Symbol.for("reactdx.agent")
                ] === true,
              { timeout: 5000 },
            )
            .catch(() => {})
        else await new Promise((resolve) => setTimeout(resolve, 1000))
        assert.equal(await agentFlag(page), injected)
        await page.close()
      },
    )
  })
}
