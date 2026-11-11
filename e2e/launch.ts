import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import puppeteer, { type Browser, type Frame } from "puppeteer"

export type BrowserName = "chrome" | "firefox"

const PANEL_CREATED = "[reactdx] panel created"
const output = path.resolve(import.meta.dirname, "../apps/extension/.output")

export const reactdxBuild = (name: BrowserName) =>
  path.join(output, `${name}-mv3`)

// DevTools pages only exist in a headed browser, so both launch headed with DevTools open.
// The panel helpers need the ReactDX build among the extensions (the default).
export function launchWithExtension(
  name: BrowserName,
  extensions = [reactdxBuild(name)],
  options: { devtoolsTheme?: "light" | "dark" } = {},
): Promise<{
  browser: Browser
  panelCreated(): Promise<boolean>
}> {
  return name === "chrome"
    ? launchChrome(extensions, options.devtoolsTheme)
    : launchFirefox(extensions)
}

async function launchChrome(
  extensions: string[],
  devtoolsTheme?: "light" | "dark",
) {
  const userDataDir = devtoolsTheme && themedProfile(devtoolsTheme)
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    pipe: true,
    enableExtensions: extensions,
    userDataDir,
  })
  if (userDataDir)
    browser.on("disconnected", () =>
      rmSync(userDataDir, { recursive: true, force: true }),
    )
  if (!extensions.includes(reactdxBuild("chrome")))
    return { browser, panelCreated: async () => false }
  const devtools = await browser.waitForTarget(
    (target) => target.url().endsWith("/devtools.html"),
    { timeout: 10_000 },
  )
  return {
    browser,
    async panelCreated() {
      const session = await devtools.createCDPSession()
      const logs: string[] = []
      session.on("Runtime.consoleAPICalled", (event) =>
        logs.push(...event.args.map((arg) => String(arg.value))),
      )
      // Enabling the Runtime domain replays messages logged before we attached.
      await session.send("Runtime.enable")
      return poll(() => logs.includes(PANEL_CREATED), 2_000)
    },
  }
}

async function launchFirefox(extensions: string[]) {
  const browser = await puppeteer.launch({
    browser: "firefox",
    headless: false,
    args: ["-devtools"],
    // The devtools page's console is only reachable as Firefox's stdout.
    extraPrefsFirefox: {
      "devtools.console.stdout.chrome": true,
      "devtools.console.stdout.content": true,
    },
  })
  let stdout = ""
  browser.process()?.stdout?.on("data", (chunk) => (stdout += chunk))
  for (const extension of extensions) await browser.installExtension(extension)
  return {
    browser,
    panelCreated: () => poll(() => stdout.includes(PANEL_CREATED), 10_000),
  }
}

async function poll(check: () => boolean, timeout: number) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return true
}

// DevTools settings are JSON strings inside the profile's preferences.
function themedProfile(theme: "light" | "dark") {
  const dir = mkdtempSync(path.join(tmpdir(), "reactdx-e2e-"))
  mkdirSync(path.join(dir, "Default"))
  writeFileSync(
    path.join(dir, "Default", "Preferences"),
    JSON.stringify({
      devtools: {
        preferences: {
          "ui-theme": JSON.stringify(theme === "dark" ? "dark" : "default"),
        },
      },
    }),
  )
  return dir
}

// Chrome only: selects the ReactDX tab in the open DevTools window and returns the panel frame.
export async function openPanel(browser: Browser): Promise<Frame> {
  const target = await browser.waitForTarget((t) =>
    t.url().startsWith("devtools://devtools/bundled/devtools_app.html"),
  )
  const devtools = await target.asPage()
  await devtools.waitForFunction(
    `import("./ui/legacy/legacy.js").then(({ InspectorView }) => {
      const view = InspectorView.InspectorView.instance()
      const id = view.tabbedPane.tabIds().find((id) => id.includes("ReactDX"))
      return id && view.showPanel(id).then(() => true)
    })`,
  )
  return devtools.waitForFrame((f) => f.url().endsWith("/panel.html"))
}
