import { describe, expect, it } from "vitest"
import {
  applyTheme,
  type ColorToken,
  colorTokens,
  defaultTheme,
  themes,
  themeVars,
} from "../src/themes"

// WCAG relative luminance of a #rrggbb color.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const textTokens: ColorToken[] = [
  "fg",
  "muted",
  "error",
  "success",
  "accent",
  "syntax-key",
  "syntax-string",
  "syntax-number",
]

describe("themes", () => {
  it("defaults to the DevTools theme of the same kind", () => {
    expect(defaultTheme("light").id).toBe("devtools-light")
    expect(defaultTheme("dark").id).toBe("devtools-dark")
  })

  it("has SnapQL's tokens and values", () => {
    expect(colorTokens).toEqual([
      "bg",
      "fg",
      "muted",
      "border",
      "selected",
      "error",
      "surface",
      "accent",
      "success",
      "syntax-key",
      "syntax-string",
      "syntax-number",
      "highlight",
    ])
    expect(defaultTheme("light").colors).toEqual({
      bg: "#ffffff",
      fg: "#1f1f1f",
      muted: "#5f6368",
      border: "#e3e3e3",
      selected: "#d3e3fd",
      error: "#b3261e",
      surface: "#f1f3f4",
      accent: "#0b57d0",
      success: "#188038",
      "syntax-key": "#0b57d0",
      "syntax-string": "#a8461b",
      "syntax-number": "#6a3fb8",
      highlight: "#fde293",
    })
    expect(defaultTheme("dark").colors).toEqual({
      bg: "#282828",
      fg: "#e3e3e3",
      muted: "#8f8f8f",
      border: "#3d3d3d",
      selected: "#004a77",
      error: "#f2b8b5",
      surface: "#1f1f1f",
      accent: "#7cacf8",
      success: "#81c995",
      "syntax-key": "#7cacf8",
      "syntax-string": "#f2a275",
      "syntax-number": "#b39dff",
      highlight: "#594500",
    })
  })

  it("keeps text at 4.5:1 contrast on bg and surface", () => {
    for (const theme of themes) {
      for (const token of textTokens) {
        for (const ground of ["bg", "surface"] as const) {
          const ratio = contrast(theme.colors[token], theme.colors[ground])
          expect(
            Math.floor(ratio * 100) / 100,
            `${theme.id} ${token} on ${ground}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  // Search matches paint fg on the highlight background (::highlight).
  it("keeps fg at 4.5:1 contrast on highlight", () => {
    for (const theme of themes) {
      const ratio = contrast(theme.colors.fg, theme.colors.highlight)
      expect(Math.floor(ratio * 100) / 100, theme.id).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })

  it("has unique ids", () => {
    const ids = themes.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("turns every color token into one CSS variable", () => {
    for (const theme of themes) {
      expect(themeVars(theme)).toEqual(
        Object.fromEntries(
          colorTokens.map((token) => [`--theme-${token}`, theme.colors[token]]),
        ),
      )
    }
  })

  it("applies a theme to the root element", () => {
    for (const theme of themes) {
      const root = document.createElement("html")
      applyTheme(theme, root)
      for (const [name, value] of Object.entries(themeVars(theme))) {
        expect(root.style.getPropertyValue(name), name).toBe(value)
      }
      expect(root.dataset.theme).toBe(theme.id)
      expect(root.dataset.themeKind).toBe(theme.kind)
      expect(root.style.colorScheme).toBe(theme.kind)
    }
  })

  it("replaces the previous theme", () => {
    const root = document.createElement("html")
    applyTheme(defaultTheme("dark"), root)
    applyTheme(defaultTheme("light"), root)
    expect(root.style.getPropertyValue("--theme-bg")).toBe("#ffffff")
    expect(root.dataset.theme).toBe("devtools-light")
    expect(root.style.colorScheme).toBe("light")
  })
})
