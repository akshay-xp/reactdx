import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"
import { type BrowserName, launchWithExtension } from "./launch.ts"
import { toolbar } from "./toolbar.ts"

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

test("a page without React shows the grey icon", async () => {
  const page = await extension.browser.newPage()
  await page.goto(plainUrl)
  const state = await toolbar(name, extension.browser, page)
  assert.equal(state.title, "ReactDX: no React")
  if (name === "firefox") assert.match(state.icon ?? "", /none-/)
  await page.close()
})
