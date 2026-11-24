import { chromium, type Page } from "@playwright/test"

declare global {
  interface Window {
    __bench(mode: "all" | "one", iterations: number): number[]
    __reactdxRendered?: number
  }
}

export type Case = {
  name: string
  extension?: string
  args?: string[]
  ready: (page: Page) => Promise<unknown>
}

// Opens the bench page in a fresh headed context with only the case's
// extension, waits until it's ready, runs `use`, and closes the browser.
export async function withBench<T>(
  benchCase: Case,
  port: number,
  use: (page: Page) => Promise<T>,
) {
  const extensionArgs = benchCase.extension
    ? [
        `--disable-extensions-except=${benchCase.extension}`,
        `--load-extension=${benchCase.extension}`,
      ]
    : []
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: false,
    args: [
      ...extensionArgs,
      ...(benchCase.args ?? []),
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  })
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    // RDT registers its hook script from its service worker, so the first load can beat it.
    for (let attempt = 1; ; attempt++) {
      await page.goto(`http://localhost:${port}/bench.html`)
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="cell"]').length === 10000,
      )
      try {
        await benchCase.ready(page)
        break
      } catch (error) {
        if (attempt === 5) throw error
        await page.waitForTimeout(1000)
      }
    }
    return await use(page)
  } finally {
    await context.close()
  }
}

// Vite's React Refresh runtime creates a hook without checkDCE when no devtools hook exists.
export const hookKind = (page: Page) =>
  page.evaluate(() => {
    const hook: object | undefined = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
    if (!hook) return "none"
    if ("_isBippyHook" in hook) return "bippy"
    if ("getFiberRoots" in hook) return "rdt"
    return "checkDCE" in hook ? "bare" : "react-refresh"
  })

export const expectHook = async (page: Page, expected: string) => {
  const kind = await hookKind(page)
  if (kind !== expected)
    throw new Error(`expected ${expected} hook, found ${kind}`)
}

// RDT's backend is attached once DevTools has opened for the tab.
export const rdtAttached = (page: Page) =>
  page.waitForFunction(
    () =>
      (
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ as
          | { rendererInterfaces?: Map<unknown, unknown> }
          | undefined
      )?.rendererInterfaces?.size,
    null,
    { timeout: 20000 },
  )
