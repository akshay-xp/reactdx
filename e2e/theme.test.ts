import assert from "node:assert/strict"
import { test } from "node:test"
import { defaultTheme } from "../packages/panel/src/themes.ts"
import { type BrowserName, launchWithExtension, openPanel } from "./launch.ts"

const browser = process.env.E2E_BROWSER as BrowserName

for (const kind of ["light", "dark"] as const) {
  // Firefox can't open moz-extension:// frames over BiDi.
  test(`the panel follows the ${kind} DevTools theme`, {
    skip: browser !== "chrome",
  }, async () => {
    const { browser: chrome } = await launchWithExtension("chrome", undefined, {
      devtoolsTheme: kind,
    })
    try {
      const panel = await openPanel(chrome)
      await panel.waitForSelector("[data-testid=panel-root]")
      assert.deepEqual(
        await panel.evaluate(() => {
          const html = document.documentElement
          return {
            theme: html.dataset.theme,
            colorScheme: getComputedStyle(html).colorScheme,
            bg: getComputedStyle(html).getPropertyValue("--theme-bg"),
          }
        }),
        {
          theme: `devtools-${kind}`,
          colorScheme: kind,
          bg: defaultTheme(kind).colors.bg,
        },
      )
    } finally {
      await chrome.close()
    }
  })
}
