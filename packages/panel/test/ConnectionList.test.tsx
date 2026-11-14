import { type RendererView, treeBatch } from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { ConnectionList } from "../src/ConnectionList"
import { createInspectorStore } from "../src/inspection"
import type { Sources } from "../src/source"
import { createTreeStore } from "../src/tree"

const inspection = () =>
  createInspectorStore(
    () => {},
    () => {},
  )
const settings = { hookNames: () => false, setHookNames: () => {} }
const sources: Sources = {
  resolve: async () => null,
  open: async () => "opened",
  hookName: async () => null,
}

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
  const { container } = render(() => (
    <ConnectionList
      tree={createTreeStore()}
      inspector={inspection()}
      sources={sources}
      settings={settings}
      renderers={[]}
    />
  ))
  expect(container.textContent).toBe("No React on this page")
})

test("a page open since before the install asks for a reload", () => {
  let reloads = 0
  const { container } = render(() => (
    <ConnectionList
      tree={createTreeStore()}
      inspector={inspection()}
      sources={sources}
      settings={settings}
      renderers={[]}
      stale
      onReload={() => reloads++}
    />
  ))
  expect(container.textContent).toBe(
    "Reload this page to inspect React.It was open before ReactDX was installed or updated.Reload page",
  )
  // Centered like the inspector's empty states, the reload icon above.
  expect(container.querySelector("[data-testid=empty] svg")).not.toBeNull()
  fireEvent.click(container.querySelector("button") as Element)
  expect(reloads).toBe(1)
})

test("only production React", () => {
  const { container } = render(() => (
    <ConnectionList
      tree={createTreeStore()}
      inspector={inspection()}
      sources={sources}
      settings={settings}
      renderers={[copy(1, "19.3.1", 0)]}
    />
  ))
  expect(container.textContent).toBe(
    "Production build of React 19.3.1. ReactDX inspects development builds.",
  )
})

test("each React copy with its roots and commit counts", () => {
  const { container } = render(() => (
    <ConnectionList
      tree={createTreeStore()}
      inspector={inspection()}
      sources={sources}
      settings={settings}
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
    <ConnectionList
      tree={createTreeStore()}
      inspector={inspection()}
      sources={sources}
      settings={settings}
      renderers={[copy(1, "<img src=x onerror=alert(1)>", 1)]}
    />
  ))
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>")
})

test("uses theme token classes only", () => {
  const { container } = render(() => (
    <ConnectionList
      tree={createTreeStore()}
      inspector={inspection()}
      sources={sources}
      settings={settings}
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

test("development roots list their components; production roots don't", () => {
  const tree = createTreeStore()
  const node = (id: number, parentId: number, name: string, rootId = 1) => ({
    op: "add" as const,
    id,
    parentId,
    rootId,
    kind: "function" as const,
    name,
    key: null,
    index: 0,
  })
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      node(1, 0, "App"),
      node(2, 1, "Counter"),
      node(3, 2, "<img src=x>"),
      node(4, 0, "Overlay", 2),
    ]),
  )
  const { container } = render(() => (
    <ConnectionList
      tree={tree}
      inspector={inspection()}
      sources={sources}
      settings={settings}
      renderers={[
        copy(1, "19.3.1", 1, [{ id: 1, commits: 1 }]),
        copy(2, "19.3.1", 0, [{ id: 2, commits: 1 }]),
      ]}
    />
  ))
  const nodes = [
    ...container.querySelectorAll<HTMLElement>("[data-testid=node]"),
  ]
  expect(nodes.map((el) => el.textContent)).toEqual([
    "App",
    "Counter",
    "<img src=x>",
  ])
  const indent = (el?: HTMLElement) =>
    Number.parseFloat(el?.style.paddingLeft ?? "")
  expect(indent(nodes[1])).toBeGreaterThan(indent(nodes[0]))
  expect(container.querySelector("img")).toBeNull()
})

test("the tree toolbar shows only above development copies", () => {
  const search = (renderers: RendererView[]) =>
    render(() => (
      <ConnectionList
        tree={createTreeStore()}
        inspector={inspection()}
        sources={sources}
        settings={settings}
        renderers={renderers}
      />
    )).container.querySelector("[data-testid=search]")
  expect(search([])).toBeNull()
  expect(search([copy(1, "19.3.1", 0)])).toBeNull()
  expect(search([copy(1, "18.3.1", 1, [{ id: 1, commits: 0 }])])).not.toBeNull()
})

test("the inspector sits beside the trees, below them when narrow", () => {
  const view = (renderers: RendererView[]) =>
    render(() => (
      <ConnectionList
        tree={createTreeStore()}
        inspector={inspection()}
        sources={sources}
        settings={settings}
        renderers={renderers}
      />
    )).container
  const split = view([
    copy(1, "18.3.1", 1, [{ id: 1, commits: 0 }]),
  ]).querySelector("[data-testid=split]")
  expect(split).not.toBeNull()
  expect(split?.classList).toContain("flex-col")
  expect(split?.classList).toContain("sm:flex-row")
  expect(split?.lastElementChild?.getAttribute("data-testid")).toBe("inspector")
  expect(
    split?.firstElementChild?.querySelector("[data-testid=tree]"),
  ).not.toBeNull()
  expect(view([]).querySelector("[data-testid=inspector]")).toBeNull()
  expect(
    view([copy(1, "19.3.1", 0)]).querySelector("[data-testid=inspector]"),
  ).toBeNull()
})
