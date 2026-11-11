import assert from "node:assert/strict"
import { globSync, readFileSync } from "node:fs"
import path from "node:path"
import { after, before, describe, test } from "node:test"
import puppeteer, { type Browser, type Page } from "puppeteer"
import { startFixture } from "./start.ts"

let browser: Browser
before(async () => (browser = await puppeteer.launch()))
after(() => browser.close())

const text = (page: Page, selector: string) =>
  page.$eval(selector, (el) => el.textContent)

async function expectCounter(page: Page, scope: string) {
  const counter = `${scope} [data-testid=counter]`
  assert.equal(await text(page, counter), "Count: 0")
  await page.click(counter)
  await page.waitForFunction(
    (s) => document.querySelector(s)?.textContent === "Count: 1",
    {},
    counter,
  )
}

for (const [script, port, version] of [
  ["fixture:18", 5218, /^18\.3\./],
  ["fixture:19", 5219, /^19\./],
] as const) {
  describe(script, () => {
    let stop: (() => void) | undefined
    before(async () => (stop = await startFixture(script, port)))
    after(() => stop?.())

    test("shows its React version and a working counter", async () => {
      const page = await browser.newPage()
      await page.goto(`http://localhost:${port}`)
      await page.waitForSelector("[data-testid=react-version]")
      assert.match((await text(page, "[data-testid=react-version]"))!, version)
      await expectCounter(page, "body")
      await page.close()
    })
  })
}

describe("fixture:next", () => {
  let stop: (() => void) | undefined
  before(async () => (stop = await startFixture("fixture:next", 5220)))
  after(() => stop?.())

  test("renders a Server Component and a client counter on React 19", async () => {
    const page = await browser.newPage()
    await page.goto("http://localhost:5220")
    await page.waitForSelector("[data-testid=react-version]")
    assert.ok(
      await page.$("[data-testid=server]"),
      "Server Component output missing",
    )
    assert.match((await text(page, "[data-testid=react-version]"))!, /^19\./)
    await expectCounter(page, "body")
    await page.close()
  })
})

describe("fixture:multi", () => {
  let stop: (() => void) | undefined
  before(async () => (stop = await startFixture("fixture:multi", 5221)))
  after(() => stop?.())

  test("runs a React 18 root and a React 19 root side by side", async () => {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on(
      "console",
      (message) => message.type() === "error" && errors.push(message.text()),
    )
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto("http://localhost:5221")
    await page.waitForSelector(
      "[data-testid=root-19] [data-testid=react-version]",
    )
    assert.match(
      (await text(page, "[data-testid=root-18] [data-testid=react-version]"))!,
      /^18\.3\./,
    )
    assert.match(
      (await text(page, "[data-testid=root-19] [data-testid=react-version]"))!,
      /^19\./,
    )
    await expectCounter(page, "[data-testid=root-18]")
    assert.equal(
      await text(page, "[data-testid=root-19] [data-testid=counter]"),
      "Count: 0",
    )
    await expectCounter(page, "[data-testid=root-19]")
    assert.deepEqual(errors, [])
    await page.close()
  })
})

test("React is a dependency of fixtures only", () => {
  const repo = path.resolve(import.meta.dirname, "..")
  for (const file of globSync(
    ["packages/*/package.json", "apps/*/package.json"],
    { cwd: repo },
  )) {
    const pkg = JSON.parse(readFileSync(path.join(repo, file), "utf8"))
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ]) {
      const react = Object.keys(pkg[field] ?? {}).filter((name) =>
        /^react(-dom)?(-\d+)?$/.test(name),
      )
      assert.deepEqual(react, [], `${file} ${field}`)
    }
  }
})
