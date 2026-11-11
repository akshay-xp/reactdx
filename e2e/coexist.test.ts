import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import type { Page } from "puppeteer"
import { startFixture } from "../fixtures/start.ts"
import type { HookRecord } from "../packages/page/src/hook.ts"
import {
  type BrowserName,
  launchWithExtension,
  reactdxBuild,
} from "./launch.ts"
import { preloadHook } from "./preload.ts"
import { ensureRdt } from "./rdt.ts"

const browserName = process.env.E2E_BROWSER as BrowserName

type RdtHook = {
  rendererInterfaces?: Map<number, unknown>
  getFiberRoots?: (id: number) => Set<unknown>
}

declare global {
  interface Window {
    __commits?: number
  }
}

const status = () => {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ as RdtHook | undefined
  const ids = [...(hook?.rendererInterfaces?.keys() ?? [])]
  const record = (window as unknown as Record<symbol, HookRecord | undefined>)[
    Symbol.for("reactdx")
  ]
  return {
    first: Object.hasOwn(Window.prototype, "__REACT_DEVTOOLS_GLOBAL_HOOK__")
      ? "reactdx"
      : "rdt",
    rdt: ids.length,
    // Roots only exist for DOM renderers (not the Server Components client).
    domRoots: ids
      .filter(
        (id) => record?.renderers.get(id)?.rendererPackageName === "react-dom",
      )
      .map((id) => hook?.getFiberRoots?.(id).size ?? 0),
    ours: record?.renderers.size ?? 0,
  }
}

// RDT registers its hook script from its service worker, so a load can miss it.
async function openWithRdt(page: Page, port: number) {
  for (let attempt = 1; ; attempt++) {
    await page.goto(`http://localhost:${port}`)
    await page.waitForSelector("[data-testid=counter]")
    const result = await page.evaluate(status)
    if (result.rdt > 0 || attempt === 5) return result
  }
}

async function commitsAfterClick(page: Page) {
  await page.evaluate(() => {
    const record = (window as unknown as Record<symbol, HookRecord>)[
      Symbol.for("reactdx")
    ]
    record?.listeners.add(() => {
      window.__commits = (window.__commits ?? 0) + 1
    })
  })
  // A DOM click, not page.click: Puppeteer's click first waits for an IntersectionObserver
  // frame, and a page hidden behind the DevTools window sometimes renders none (about 1 in 60
  // launches, with or without extensions), which hung the test until the protocol timeout.
  await page.$eval("[data-testid=counter]", (el) => (el as HTMLElement).click())
  await page.waitForFunction(() => (window.__commits ?? 0) > 0, {
    timeout: 5000,
  })
}

for (const [script, port, renderers] of [
  ["fixture:18", 5218, 1],
  ["fixture:19", 5219, 1],
  // RDT's hook has supportsFlight, so Next's Server Components client also registers.
  ["fixture:next", 5220, 3],
  ["fixture:multi", 5221, 2],
] as const) {
  if (
    process.env.E2E_FIXTURE &&
    script !== `fixture:${process.env.E2E_FIXTURE}`
  )
    continue
  describe(`${script} with RDT`, () => {
    let stop: (() => void) | undefined
    let rdt: string
    before(async () => {
      rdt = await ensureRdt(browserName)
      stop = await startFixture(script, port)
    })
    after(() => stop?.())

    // Forced orders prove each install path; the shipped build gets whatever order
    // the browser gives (Chrome 157 under Puppeteer: RDT first; Firefox 159: ReactDX first).
    for (const [name, extensions, preload, first] of [
      ["ReactDX first, then RDT", () => [rdt], "first", "reactdx"],
      ["RDT first, then ReactDX", () => [rdt], "after-rdt", "rdt"],
      [
        "the shipped build with RDT",
        () => [reactdxBuild(browserName), rdt],
        null,
        null,
      ],
    ] as const) {
      test(`${name}: both work`, async () => {
        const { browser } = await launchWithExtension(browserName, [
          ...extensions(),
        ])
        try {
          const page = await browser.newPage()
          if (preload)
            await page.evaluateOnNewDocument(await preloadHook(preload))
          const result = await openWithRdt(page, port)
          const detail = JSON.stringify(result)
          if (first) assert.equal(result.first, first, detail)
          assert.equal(result.rdt, renderers, detail)
          assert.ok(
            result.domRoots.length > 0 && result.domRoots.every((n) => n > 0),
            detail,
          )
          assert.equal(result.ours, renderers, detail)
          await commitsAfterClick(page)
        } finally {
          await browser.close()
        }
      })
    }
  })
}
