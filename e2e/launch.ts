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
// `devtools: false` (Chrome) keeps DevTools closed, which Chrome needs to prerender.
export function launchWithExtension(
  name: BrowserName,
  extensions = [reactdxBuild(name)],
  options: { devtoolsTheme?: "light" | "dark"; devtools?: boolean } = {},
): Promise<{
  browser: Browser
  panelCreated(): Promise<boolean>
}> {
  return name === "chrome"
    ? launchChrome(extensions, options.devtoolsTheme, options.devtools ?? true)
    : launchFirefox(extensions)
}

async function launchChrome(
  extensions: string[],
  devtoolsTheme: "light" | "dark" | undefined,
  openDevtools: boolean,
) {
  const userDataDir = devtoolsTheme && themedProfile(devtoolsTheme)
  const browser = await puppeteer.launch({
    headless: false,
    devtools: openDevtools,
    pipe: true,
    // Empty: nothing at launch, but browser.installExtension works later.
    enableExtensions: extensions.length ? extensions : true,
    userDataDir,
  })
  if (userDataDir)
    browser.on("disconnected", () =>
      // Chrome can still be writing into the profile as it exits (ENOTEMPTY).
      rmSync(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      }),
    )
  if (!openDevtools || !extensions.includes(reactdxBuild("chrome")))
    return { browser, panelCreated: async () => false }
  const devtools = await browser.waitForTarget(
    (target) => target.url().endsWith("/devtools.html"),
    // Slow CI runners take longer than 10 s to open DevTools.
    { timeout: 30_000 },
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
    // Lets e2e/toolbar.ts read the toolbar from the browser's own UI.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
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

const DEVTOOLS = "devtools://devtools/bundled/devtools_app.html"
const SHOW_REACTDX = `import("./ui/legacy/legacy.js").then(({ InspectorView }) => {
  const view = InspectorView.InspectorView.instance()
  const id = view.tabbedPane.tabIds().find((id) => id.includes("ReactDX"))
  return id && view.showPanel(id).then(() => true)
})`

// Chrome only: selects the ReactDX tab in the open DevTools window and returns the panel frame.
// showPanel can hang in a freshly opened DevTools (on CI, after another one closed)
// and a second call goes through, so each try is short. A just-opened target can
// throw "Requesting main frame too early!".
export async function openPanel(browser: Browser): Promise<Frame> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const targets = browser
      .targets()
      .filter((t) => t.url().startsWith(DEVTOOLS))
      .reverse()
    for (const target of targets) {
      const devtools = await (async () => {
        const page = await target.asPage()
        await page.waitForFunction(SHOW_REACTDX, { timeout: 3_000 })
        return page
      })().catch(() => undefined)
      if (devtools)
        return devtools.waitForFrame((f) => f.url().endsWith("/panel.html"))
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const urls = browser.targets().map((t) => `${t.type()} ${t.url()}`)
  throw new Error(`no DevTools showed ReactDX: ${urls.join(", ")}`)
}
