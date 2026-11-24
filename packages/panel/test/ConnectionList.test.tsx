import {
  commitsMessage,
  committed,
  countsMessage,
  inspected,
  type RendererView,
  treeBatch,
} from "@reactdx/messages"
import { fireEvent, render, screen, within } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { ConnectionList } from "../src/ConnectionList"
import { createInspectorStore } from "../src/inspection"
import type { Sources } from "../src/source"
import { createTimelineStore } from "../src/timeline"
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
    ["Root 13 updates", "3"],
    ["Root 20 updates", "0"],
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

test("Components and Updates are tabs; the hidden one keeps its state", () => {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      {
        op: "add",
        id: 1,
        parentId: 0,
        rootId: 1,
        kind: "function",
        name: "App",
        key: null,
        index: 0,
      },
    ]),
  )
  tree.select(1)
  const inspector = inspection()
  render(() => (
    <ConnectionList
      tree={tree}
      inspector={inspector}
      timeline={createTimelineStore(() => {}, inspector)}
      sources={sources}
      settings={settings}
      renderers={[copy(1, "19.3.1", 1, [{ id: 1, commits: 1 }])]}
    />
  ))
  const components = screen.getByRole("tab", { name: "Components" })
  const commits = screen.getByRole("tab", { name: "Updates" })
  const panel = (tab: HTMLElement) =>
    document.getElementById(tab.getAttribute("aria-controls") ?? "")
  expect(components.getAttribute("aria-selected")).toBe("true")
  expect(panel(components)?.hidden).toBe(false)
  expect(panel(commits)?.hidden).toBe(true)
  expect(panel(components)?.querySelector("[data-testid=tree]")).not.toBeNull()
  expect(
    panel(components)?.querySelector("[data-testid=inspector]"),
  ).not.toBeNull()
  fireEvent.click(commits)
  expect(commits.getAttribute("aria-selected")).toBe("true")
  expect(panel(commits)?.hidden).toBe(false)
  expect(panel(components)?.hidden).toBe(true)
  expect(tree.selected()).toBe(1)
  fireEvent.keyDown(commits, { key: "ArrowLeft" })
  expect(components.getAttribute("aria-selected")).toBe("true")
  expect(document.activeElement).toBe(components)
})

test("links move between a commit and its components", () => {
  const tree = createTreeStore()
  const add = (id: number, name: string) => ({
    op: "add" as const,
    id,
    parentId: id === 1 ? 0 : 1,
    rootId: 1,
    kind: "function" as const,
    name,
    key: null,
    index: 0,
  })
  tree.apply(treeBatch(1, [{ op: "reset" }, add(1, "App"), add(2, "Counter")]))
  const inspector = inspection()
  const timeline = createTimelineStore(() => {}, inspector)
  render(() => (
    <ConnectionList
      tree={tree}
      inspector={inspector}
      timeline={timeline}
      sources={sources}
      settings={settings}
      renderers={[copy(1, "19.3.1", 1, [{ id: 1, commits: 2 }])]}
    />
  ))
  const tab = (name: string) => screen.getByRole("tab", { name })
  const selectedTab = () =>
    screen
      .getAllByRole("tab")
      .find((t) => t.getAttribute("aria-selected") === "true")
      ?.getAttribute("aria-label")
  timeline.receiveCommits(
    commitsMessage(
      [
        { seq: 4, time: 0, rootId: 1, updaters: [2, 1], renders: 2, wasted: 0 },
        { seq: 7, time: 0, rootId: 1, updaters: [2], renders: 1, wasted: 0 },
      ],
      1,
      false,
    ),
  )
  tree.select(2)
  inspector.inspect(2)
  inspector.receive(
    inspected(2, {
      props: { type: "object", className: "Object", id: 1, size: 0, props: {} },
      render: {
        seq: 4,
        kinds: ["state"],
        updaters: [
          { id: 2, hooks: [] },
          { id: 1, hooks: [] },
        ],
      },
      history: [4],
    }),
  )

  // The full reasons are folded under Renders.
  fireEvent.click(screen.getByRole("treeitem", { name: /^Renders/ }))
  // The tab says how many updates there are.
  expect(tab("Updates").textContent).toBe("Updates2")
  fireEvent.click(screen.getByRole("button", { name: "+1 more" }))
  expect(selectedTab()).toBe("Updates")
  expect(timeline.picked()).toBe(4)

  fireEvent.click(tab("Components"))
  fireEvent.click(screen.getByRole("button", { name: "1 render recorded" }))
  expect(selectedTab()).toBe("Updates")
  expect(screen.getByRole("button", { name: "Only Counter" }).ariaPressed).toBe(
    "true",
  )

  timeline.receiveCommitted(committed(4, [{ id: 2, kinds: ["state"] }], []))
  tree.select(1)
  const detail = screen.getByTestId("commit-detail")
  fireEvent.click(within(detail).getByRole("button", { name: "Counter" }))
  expect(selectedTab()).toBe("Components")
  expect(tree.selected()).toBe(2)

  fireEvent.click(screen.getByRole("button", { name: "Show latest" }))
  expect(timeline.picked()).toBeUndefined()
  expect(inspector.pinned()).toBeUndefined()
})

test("a legend under the trees says what the numbers count", () => {
  const { container } = render(() => (
    <ConnectionList
      tree={createTreeStore()}
      inspector={inspection()}
      sources={sources}
      settings={settings}
      renderers={[copy(1, "18.3.1", 1, [{ id: 1, commits: 3 }])]}
    />
  ))
  const legend = screen.getByText("Numbers: renders since DevTools opened")
  const trees = container.querySelector("[data-testid=trees]") as Element
  expect(
    trees.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

test("a new update keeps the Components tab as it was: nothing remounts", () => {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      {
        op: "add",
        id: 1,
        parentId: 0,
        rootId: 1,
        kind: "function",
        name: "App",
        key: null,
        index: 0,
      },
    ]),
  )
  const inspector = inspection()
  const timeline = createTimelineStore(() => {}, inspector)
  render(() => (
    <ConnectionList
      tree={tree}
      inspector={inspector}
      timeline={timeline}
      sources={sources}
      settings={settings}
      renderers={[copy(1, "19.3.1", 1, [{ id: 1, commits: 2 }])]}
    />
  ))
  tree.select(1)
  inspector.inspect(1)
  inspector.receive(
    inspected(1, {
      props: { type: "object", className: "Object", id: 1, size: 0, props: {} },
    }),
  )
  const renders = () => screen.getByRole("treeitem", { name: "Renders" })
  fireEvent.click(renders())
  expect(renders().getAttribute("aria-expanded")).toBe("true")
  timeline.receiveCommits(
    commitsMessage(
      [{ seq: 1, time: 0, rootId: 1, updaters: [], renders: 1, wasted: 0 }],
      1,
      false,
    ),
  )
  expect(screen.getByRole("tab", { name: "Updates" }).textContent).toBe(
    "Updates1",
  )
  expect(renders().getAttribute("aria-expanded")).toBe("true")
})

// Reading the tab list built every tab's content again, TreeView included:
// each update walked the whole tree once per copy (10 times on bench.html).
test("an update walks the tree once: no throwaway copies of the tabs", () => {
  const tree = createTreeStore()
  const add = (id: number, parentId: number, name: string, index = 0) =>
    ({
      op: "add",
      id,
      parentId,
      rootId: 1,
      kind: "function",
      name,
      key: null,
      index,
    }) as const
  tree.apply(treeBatch(1, [{ op: "reset" }, add(1, 0, "App")]))
  const inspector = inspection()
  const timeline = createTimelineStore(() => {}, inspector)
  const rows = tree.rows
  let walks = 0
  tree.rows = (rootId) => {
    walks++
    return rows(rootId)
  }
  render(() => (
    <ConnectionList
      tree={tree}
      inspector={inspector}
      timeline={timeline}
      sources={sources}
      settings={settings}
      renderers={[copy(1, "19.3.1", 1, [{ id: 1, commits: 1 }])]}
    />
  ))
  walks = 0
  tree.apply(treeBatch(2, [add(2, 1, "Extra")]))
  timeline.receiveCommits(
    commitsMessage(
      [{ seq: 1, time: 0, rootId: 1, updaters: [], renders: 1, wasted: 0 }],
      1,
      false,
    ),
  )
  tree.receiveCounts(countsMessage([{ id: 2, renders: 1, wasted: 0 }]))
  expect(walks).toBe(1)
})
