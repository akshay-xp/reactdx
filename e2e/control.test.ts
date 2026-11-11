// TEMPORARY (PR #23 investigation): does Next fail to hydrate with RDT alone on CI?
import { after, before, test } from "node:test"
import { startFixture } from "../fixtures/start.ts"
import { type BrowserName, launchWithExtension } from "./launch.ts"
import { preloadHook } from "./preload.ts"
import { ensureRdt } from "./rdt.ts"

const name = process.env.E2E_BROWSER as BrowserName
const skip = process.env.E2E_FIXTURE !== "next" || name !== "chrome"

let stop: (() => void) | undefined
before(async () => {
  if (!skip) stop = await startFixture("fixture:next", 5220)
})
after(() => stop?.())

async function hydrates(rdt: string, withReactdx: boolean) {
  const { browser } = await launchWithExtension(name, [rdt])
  try {
    const page = await browser.newPage()
    if (withReactdx)
      await page.evaluateOnNewDocument(await preloadHook("first"))
    await page.goto("http://localhost:5220")
    await page.waitForSelector("[data-testid=counter]")
    return await page
      .waitForFunction(
        () =>
          Object.keys(
            document.querySelector("[data-testid=counter]") ?? {},
          ).some((k) => k.startsWith("__reactFiber$")),
        { timeout: 30_000 },
      )
      .then(
        () => true,
        () => false,
      )
  } finally {
    await browser.close()
  }
}

test("control: Next hydration with RDT alone vs RDT plus ReactDX", {
  skip,
  timeout: 900_000,
}, async () => {
  const rdt = await ensureRdt(name)
  const counts = { rdtAlone: 0, rdtPlusReactdx: 0 }
  for (let i = 0; i < 8; i++) {
    if (await hydrates(rdt, false)) counts.rdtAlone++
    if (await hydrates(rdt, true)) counts.rdtPlusReactdx++
  }
  console.log(`CONTROL hydrated out of 8: ${JSON.stringify(counts)}`)
})
