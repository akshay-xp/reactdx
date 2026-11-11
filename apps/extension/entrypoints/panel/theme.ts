import type { ThemeKind } from "@reactdx/panel/themes"

const toThemeKind = (name: string | undefined): ThemeKind =>
  name === "dark" ? "dark" : "light"

export function getTheme(): ThemeKind {
  return toThemeKind(browser.devtools.panels.themeName)
}

type ThemeEvent = {
  addListener(listener: (name: string) => void): void
}

export function onThemeChanged(cb: (kind: ThemeKind) => void) {
  // Firefox only. Chrome has no theme event, and its panel iframe's
  // prefers-color-scheme flips during load (seen in SnapQL's e2e), so it can't
  // stand in for one: Chrome keeps the load-time theme until the panel reopens.
  const event = (browser.devtools.panels as { onThemeChanged?: ThemeEvent })
    .onThemeChanged
  event?.addListener((name) => cb(toThemeKind(name)))
}
