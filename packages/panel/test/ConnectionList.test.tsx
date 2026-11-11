import type { RendererView } from "@reactdx/messages"
import { render } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { ConnectionList } from "../src/ConnectionList"

const copy = (
  id: number,
  version: string,
  bundleType: number,
  roots: RendererView["roots"] = [],
): RendererView => ({
  id,
  version,
  bundleType,
  rendererPackageName: "react-dom",
  roots,
})

test("no React", () => {
  const { container } = render(() => <ConnectionList renderers={[]} />)
  expect(container.textContent).toBe("No React on this page")
})

test("only production React", () => {
  const { container } = render(() => (
    <ConnectionList renderers={[copy(1, "19.3.1", 0)]} />
  ))
  expect(container.textContent).toBe(
    "Production build of React 19.3.1. ReactDX inspects development builds.",
  )
})

test("each React copy with its roots and commit counts", () => {
  const { container } = render(() => (
    <ConnectionList
      renderers={[
        copy(1, "18.3.1", 1, [{ id: 1, commits: 3 }]),
        copy(2, "19.0.0", 0, [{ id: 2, commits: 0 }]),
      ]}
    />
  ))
  const copies = [...container.querySelectorAll("[data-testid=renderer]")]
  expect(copies.map((el) => el.querySelector("h2")?.textContent)).toEqual([
    "React 18.3.1 development react-dom",
    "React 19.0.0 production react-dom",
  ])
  const roots = [...container.querySelectorAll("[data-testid=root]")]
  expect(
    roots.map((el) => [el.textContent, el.getAttribute("data-commits")]),
  ).toEqual([
    ["Root 13 commits", "3"],
    ["Root 20 commits", "0"],
  ])
})

test("page data renders as text, never markup", () => {
  const { container } = render(() => (
    <ConnectionList renderers={[copy(1, "<img src=x onerror=alert(1)>", 1)]} />
  ))
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>")
})

test("uses theme token classes only", () => {
  const { container } = render(() => (
    <ConnectionList
      renderers={[copy(1, "18.3.1", 1, [{ id: 1, commits: 0 }])]}
    />
  ))
  const classes = [...container.querySelectorAll("[class]")].flatMap((el) => [
    ...el.classList,
  ])
  // Tailwind palette colors and arbitrary values bypass the theme.
  const palette =
    /-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$|-(white|black)$|-\[/
  expect(classes.filter((c) => palette.test(c))).toEqual([])
  expect(classes).toContain("border-border")
})
