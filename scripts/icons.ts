import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Resvg } from "@resvg/resvg-js"

// Placeholder art (branding is M9): one SVG, a color per toolbar state.
const COLORS = {
  none: "#9aa0a6",
  development: "#0b57d0",
  production: "#188038",
}
const SIZES = [16, 32, 48, 128]

const app = path.resolve(import.meta.dirname, "../apps/extension")
const svg = readFileSync(path.join(app, "icon.svg"), "utf8")
const out = path.join(app, "public/icon")
mkdirSync(out, { recursive: true })
for (const [state, color] of Object.entries(COLORS)) {
  for (const size of SIZES) {
    const png = new Resvg(svg.replaceAll("{{color}}", color), {
      fitTo: { mode: "width", value: size },
    })
      .render()
      .asPng()
    writeFileSync(path.join(out, `${state}-${size}.png`), png)
  }
}
