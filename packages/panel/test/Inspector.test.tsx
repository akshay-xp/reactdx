import {
  expanded,
  inspected,
  type TreeKind,
  treeBatch,
  type Value,
} from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { expect, test } from "vitest"
import { Inspector } from "../src/Inspector"
import { createInspectorStore, type InspectorCommand } from "../src/inspection"
import type { Sources } from "../src/source"
import { createTreeStore } from "../src/tree"

const object = (
  props: Record<string, Value>,
  extra: Record<string, unknown> = {},
): Value => ({
  type: "object",
  className: "Object",
  id: 1,
  size: Object.keys(props).length,
  props,
  ...extra,
})

// One selected node (id 3) and an inspector for it.
// Settings held in a signal, as main.tsx holds them (stored there).
function createSettings(hookNames = false) {
  const [on, set] = createSignal(hookNames)
  return { hookNames: on, setHookNames: set }
}

// Sources that resolve nothing and open everything, unless a test says otherwise.
const noSources: Sources = {
  resolve: async () => null,
  open: async () => "opened",
  hookName: async () => null,
}

function setup(
  kind: TreeKind = "function",
  key: string | null = null,
  sources = noSources,
  settings = createSettings(),
) {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      {
        op: "add",
        id: 3,
        parentId: 0,
        rootId: 1,
        kind,
        name: "Counter",
        key,
        index: 0,
      },
    ]),
  )
  const sent: InspectorCommand[] = []
  const inspector = createInspectorStore((command) => sent.push(command))
  const view = render(() => (
    <Inspector
      tree={tree}
      inspector={inspector}
      sources={sources}
      settings={settings}
    />
  ))
  const select = () => {
    tree.select(3)
    inspector.inspect(3)
  }
  return { tree, inspector, sent, select, ...view }
}

const sections = (container: Element) =>
  [...container.querySelectorAll("[data-testid=section]")].map(
    (section) => section.querySelector("button")?.textContent,
  )
const rows = (container: Element) =>
  [...container.querySelectorAll("[data-testid=value]")].map(
    (row) => row.textContent,
  )

test("empty states", () => {
  const { container, inspector, select } = setup()
  expect(container.textContent).toBe("Select a component to inspect it.")
  select()
  inspector.receive(inspected(3, null))
  expect(container.textContent).toBe("This component unmounted.")
})

test("the header names the node, its kind and key", () => {
  const { getByTestId, select } = setup("memo", "a")
  select()
  expect(getByTestId("inspector-header").textContent).toBe('Countermemokey="a"')
})

test("Props then State, one row per value", () => {
  const { container, inspector, select } = setup("class")
  select()
  inspector.receive(
    inspected(3, {
      props: object({ label: "Count", step: 1 }),
      state: object({ ticks: 2 }),
    }),
  )
  expect(sections(container)).toEqual(["Props", "State"])
  expect(rows(container)).toEqual(['label: "Count"', "step: 1", "ticks: 2"])
})

test("object keys and contexts read alphabetically; hooks, arrays and maps keep their order", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        zoom: 1,
        Alpha: 2,
        list: { type: "array", id: 6, length: 2, items: ["z", "a"] },
        map: {
          type: "map",
          id: 7,
          size: 2,
          entries: [
            ["z", 1],
            ["a", 2],
          ],
        },
      }),
      hooks: [
        { name: "State", value: 0 },
        { name: "Memo", value: object({ y: 1, x: 2 }, { id: 8 }) },
      ],
      contexts: [
        { name: "Theme", value: "dark" },
        { name: "Auth", value: null },
      ],
    }),
  )
  expect(rows(container)).toEqual([
    "Alpha: 2",
    'list: ["z", "a"]',
    "map: Map(2)",
    "zoom: 1",
    "State: 0",
    "Memo: {x: 2, y: 1}",
    "Auth: null",
    'Theme: "dark"',
  ])
  for (const name of ["list", "map", "Memo"])
    fireEvent.click(toggle(container, name) as Element)
  expect(rows(container)).toEqual([
    "Alpha: 2",
    'list: ["z", "a"]',
    '0: "z"',
    '1: "a"',
    "map: Map(2)",
    '"z" => 1',
    '"a" => 2',
    "zoom: 1",
    "State: 0",
    "Memo: {x: 2, y: 1}",
    "x: 2",
    "y: 1",
    "Auth: null",
    'Theme: "dark"',
  ])
})

const search = (container: Element, text: string) =>
  fireEvent.input(
    container.querySelector("[data-testid=inspector-search]") as Element,
    { target: { value: text } },
  )

test("search hides rows whose name and value don't match; clearing restores them", () => {
  const { container, inspector, select, getByLabelText } = setup("class")
  select()
  inspector.receive(
    inspected(3, {
      props: object({ label: "Count", step: 1 }),
      state: object({ ticks: 2 }),
    }),
  )
  expect(getByLabelText("Search values")).toBeTruthy()
  // Matches the value, case ignored.
  search(container, "count")
  expect(rows(container)).toEqual(['label: "Count"'])
  expect(sections(container)).toEqual(["Props"])
  search(container, "step")
  expect(rows(container)).toEqual(["step: 1"])
  search(container, "zzz")
  expect(rows(container)).toEqual([])
  expect(container.textContent).toContain("No matches")

  fireEvent.keyDown(getByLabelText("Search values"), { key: "Escape" })
  expect(rows(container)).toEqual(['label: "Count"', "step: 1", "ticks: 2"])
  expect(sections(container)).toEqual(["Props", "State"])
  search(container, "zzz")
  fireEvent.click(getByLabelText("Clear value search"))
  expect(rows(container)).toEqual(['label: "Count"', "step: 1", "ticks: 2"])
  expect((getByLabelText("Search values") as HTMLInputElement).value).toBe("")
})

test("empty sections aren't shown", () => {
  const { container, inspector, select } = setup("class")
  select()
  inspector.receive(inspected(3, { props: object({}) }))
  expect(sections(container)).toEqual([])
})

test("a section header collapses and expands it", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1 }) }))
  const header = container.querySelector(
    "[data-testid=section] button",
  ) as HTMLButtonElement
  expect(header.getAttribute("aria-expanded")).toBe("true")
  fireEvent.click(header)
  expect(header.getAttribute("aria-expanded")).toBe("false")
  expect(rows(container)).toEqual([])
  fireEvent.click(header)
  expect(rows(container)).toEqual(["a: 1"])
})

const toggle = (container: Element, name: string) => {
  const row = [...container.querySelectorAll("[data-testid=value]")].find(
    (el) => el.textContent?.startsWith(`${name}:`),
  )
  return row?.querySelector("[data-testid=value-toggle]") ?? null
}

test("an inline object opens in place without asking the page", () => {
  const { container, inspector, select, sent } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({ user: object({ name: "Ada" }, { id: 2 }) }),
    }),
  )
  const button = toggle(container, "user")
  expect(button).not.toBeNull()
  fireEvent.click(button as Element)
  expect(rows(container)).toEqual(['user: {name: "Ada"}', 'name: "Ada"'])
  expect(sent.filter((c) => c.type === "expand")).toEqual([])
  fireEvent.click(button as Element)
  expect(rows(container)).toEqual(['user: {name: "Ada"}'])
})

test("a ref asks the page and shows its contents when they arrive", () => {
  const { container, inspector, select, sent } = setup()
  select()
  const ref: Value = {
    type: "ref",
    id: 9,
    preview: { type: "object", className: "Object", size: 1 },
  }
  inspector.receive(inspected(3, { props: object({ deep: ref }) }))
  fireEvent.click(toggle(container, "deep") as Element)
  expect(sent.at(-1)).toEqual({ type: "expand", objectId: 9, offset: 0 })
  inspector.receiveExpanded(expanded(9, 0, object({ c: 1 }, { id: 9 })))
  expect(rows(container)).toEqual(["deep: {...}", "c: 1"])
})

test("a paged value shows more on request", () => {
  const { container, inspector, select, sent } = setup()
  select()
  const list: Value = {
    type: "array",
    id: 4,
    length: 250,
    items: [1, 2],
    nextOffset: 2,
  }
  inspector.receive(inspected(3, { props: object({ list }) }))
  fireEvent.click(toggle(container, "list") as Element)
  expect(rows(container)).toEqual(["list: Array(250)", "0: 1", "1: 2"])
  const more = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Show more (248 left)",
  )
  fireEvent.click(more as Element)
  expect(sent.at(-1)).toEqual({ type: "expand", objectId: 4, offset: 2 })
  inspector.receiveExpanded(
    expanded(4, 2, { type: "array", id: 4, length: 250, items: [3] }),
  )
  expect(rows(container)).toEqual(["list: Array(250)", "0: 1", "1: 2", "2: 3"])
})

test("map entries read key => value; circular refs don't open", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        map: { type: "map", id: 5, size: 1, entries: [["k", 1]] },
        self: { type: "ref", id: 1, circular: true },
      }),
    }),
  )
  expect(toggle(container, "self")).toBeNull()
  fireEvent.click(toggle(container, "map") as Element)
  expect(rows(container)).toEqual([
    "map: Map(1)",
    '"k" => 1',
    "self: [circular]",
  ])
})

test("an open value stays open across a re-send", () => {
  const { container, inspector, select } = setup()
  select()
  const send = (name: string) =>
    inspector.receive(
      inspected(3, { props: object({ user: object({ name }, { id: 2 }) }) }),
    )
  send("Ada")
  fireEvent.click(toggle(container, "user") as Element)
  send("Grace")
  expect(rows(container)).toEqual(['user: {name: "Grace"}', 'name: "Grace"'])
})

const hooks = [
  { name: "State", value: 0 },
  { name: "useCart", value: "2 items", hooks: [{ name: "State", value: 2 }] },
  { name: "Effect" },
]

test("Hooks list each hook; custom hooks open to theirs", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({}), hooks }))
  expect(sections(container)).toEqual(["Hooks"])
  expect(rows(container)).toEqual(["State: 0", 'useCart: "2 items"', "Effect"])
  fireEvent.click(toggle(container, "useCart") as Element)
  expect(rows(container)).toEqual([
    "State: 0",
    'useCart: "2 items"',
    "State: 2",
    "Effect",
  ])
  inspector.receive(inspected(3, { props: object({}), hooks }))
  expect(rows(container)).toContain("State: 2")
})

test("a hook's object value opens like a prop", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      hooks: [{ name: "Ref", value: object({ a: 1 }, { id: 4 }) }],
    }),
  )
  fireEvent.click(toggle(container, "Ref") as Element)
  expect(rows(container)).toEqual(["Ref: {a: 1}", "a: 1"])
})

test("hooks that couldn't be read say why", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, { props: object({}), hooks: [], hooksError: "boom" }),
  )
  expect(sections(container)).toEqual(["Hooks"])
  expect(container.textContent).toContain("Couldn't read hooks: boom")
})

test("Context lists each context read, after Hooks", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      hooks: [{ name: "State", value: 0 }],
      contexts: [
        { name: "Theme", value: "dark" },
        { name: "Context", value: object({ a: 1 }, { id: 5 }) },
      ],
    }),
  )
  expect(sections(container)).toEqual(["Hooks", "Context"])
  expect(rows(container)).toEqual([
    "State: 0",
    "Context: {a: 1}",
    'Theme: "dark"',
  ])
  fireEvent.click(toggle(container, "Context") as Element)
  expect(rows(container)).toContain("a: 1")
})

test("Rendered by lists owners; tree nodes are buttons that select", () => {
  const { container, inspector, select, tree } = setup()
  tree.apply(
    treeBatch(2, [
      {
        op: "add",
        id: 2,
        parentId: 0,
        rootId: 1,
        kind: "function",
        name: "App",
        key: null,
        index: 1,
      },
    ]),
  )
  select()
  inspector.receive(
    inspected(3, {
      props: object({ a: 1 }),
      owners: [
        { id: 2, name: "App" },
        { id: null, name: "Page" },
      ],
    }),
  )
  expect(sections(container)).toEqual(["Props", "Rendered by"])
  const owner = [...container.querySelectorAll("[data-testid=owner]")]
  expect(owner.map((el) => [el.tagName, el.textContent])).toEqual([
    ["BUTTON", "App"],
    ["SPAN", "Page"],
  ])
  fireEvent.click(owner[0] as Element)
  expect(tree.selected()).toBe(2)
})

test("hovering an owner in the tree highlights it, like its tree row; a click clears it", () => {
  const { container, inspector, select, tree } = setup()
  tree.apply(
    treeBatch(2, [
      {
        op: "add",
        id: 2,
        parentId: 0,
        rootId: 1,
        kind: "function",
        name: "App",
        key: null,
        index: 1,
      },
    ]),
  )
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      owners: [
        { id: 2, name: "App" },
        { id: null, name: "Page" },
      ],
    }),
  )
  const [app, page] = container.querySelectorAll("[data-testid=owner]")
  fireEvent.pointerEnter(app as Element)
  expect(tree.hovered()).toBe(2)
  fireEvent.pointerLeave(app as Element)
  expect(tree.hovered()).toBeUndefined()
  fireEvent.pointerEnter(page as Element)
  expect(tree.hovered()).toBeUndefined()
  // A click selects the owner, replacing this list: no leave event will come.
  fireEvent.pointerEnter(app as Element)
  fireEvent.click(app as Element)
  expect(tree.hovered()).toBeUndefined()
})

test("no owners, no Rendered by", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1 }), owners: [] }))
  expect(sections(container)).toEqual(["Props"])
})

const frame = { url: "http://h/src/Counter.jsx", line: 14, column: 47 }
const counterAt = { file: "/a/src/Counter.jsx", line: 13, column: 7 }
const resolving = (to: typeof counterAt | null): Sources => ({
  ...noSources,
  resolve: async () => to,
})
// Lets resolved sources render.
const settled = () => new Promise((resolve) => setTimeout(resolve))

test("the header shows the resolved source, its full location as the title", async () => {
  const { container, inspector, select } = setup(
    "function",
    null,
    resolving(counterAt),
  )
  select()
  inspector.receive(inspected(3, { props: object({}), source: frame }))
  await settled()
  const row = container.querySelector("[data-testid=source]")
  expect(row?.textContent?.startsWith("Counter.jsx:13")).toBe(true)
  expect(row?.querySelector("[title]")?.getAttribute("title")).toBe(
    "/a/src/Counter.jsx:13:7",
  )
  // A re-send keeps it while the same source resolves again.
  inspector.receive(inspected(3, { props: object({}), source: { ...frame } }))
  expect(container.querySelector("[data-testid=source]")).not.toBeNull()
})

test("no source row without a source or a resolved one", async () => {
  const { container, inspector, select } = setup(
    "function",
    null,
    resolving(null),
  )
  select()
  inspector.receive(inspected(3, { props: object({}), source: frame }))
  await settled()
  expect(container.querySelector("[data-testid=source]")).toBeNull()
  inspector.receive(inspected(3, { props: object({}) }))
  await settled()
  expect(container.querySelector("[data-testid=source]")).toBeNull()
})

test("Open in editor opens the resolved location; a copy offers VS Code for an absolute path", async () => {
  const opened: (typeof counterAt)[] = []
  let result: "opened" | "copied" = "opened"
  // Each frame maps one line up, so another frame is another location.
  const sources: Sources = {
    ...noSources,
    resolve: async (source) => ({ ...counterAt, line: source.line - 1 }),
    open: async (location) => {
      opened.push(location)
      return result
    },
  }
  const { getByRole, queryByText, queryByRole, inspector, select } = setup(
    "function",
    null,
    sources,
  )
  select()
  inspector.receive(inspected(3, { props: object({}), source: frame }))
  await settled()
  fireEvent.click(getByRole("button", { name: "Open in editor" }))
  await settled()
  expect(opened).toEqual([counterAt])
  expect(queryByText("Copied")).toBeNull()
  result = "copied"
  fireEvent.click(getByRole("button", { name: "Open in editor" }))
  await settled()
  expect(queryByText("Copied")).not.toBeNull()
  expect(queryByRole("link", { name: "VS Code" })?.getAttribute("href")).toBe(
    "vscode://file/a/src/Counter.jsx:13:7",
  )
  // Another source clears it.
  inspector.receive(
    inspected(3, { props: object({}), source: { ...frame, line: 20 } }),
  )
  await settled()
  expect(queryByText("Copied")).toBeNull()
})

test("a copied relative path offers no VS Code link", async () => {
  const sources: Sources = {
    ...noSources,
    resolve: async () => ({ ...counterAt, file: "src/Counter.jsx" }),
    open: async () => "copied",
  }
  const { getByRole, queryByText, queryByRole, inspector, select } = setup(
    "function",
    null,
    sources,
  )
  select()
  inspector.receive(inspected(3, { props: object({}), source: frame }))
  await settled()
  fireEvent.click(getByRole("button", { name: "Open in editor" }))
  await settled()
  expect(queryByText("Copied")).not.toBeNull()
  expect(queryByRole("link", { name: "VS Code" })).toBeNull()
})

test("the Hook names toggle shows and changes the setting", () => {
  const settings = createSettings()
  const { getByRole, select } = setup("function", null, noSources, settings)
  select()
  const toggle = getByRole("button", { name: "Hook names" })
  expect(toggle.getAttribute("aria-pressed")).toBe("false")
  fireEvent.click(toggle)
  expect(settings.hookNames()).toBe(true)
  expect(toggle.getAttribute("aria-pressed")).toBe("true")
})

test("with Hook names on, sited hooks show the variable they're assigned to", async () => {
  const site = (line: number) => ({ url: "http://h/App.jsx", line, column: 3 })
  const asked: number[] = []
  const sources: Sources = {
    ...noSources,
    hookName: async ({ line }) => {
      asked.push(line)
      return line === 3 ? "count" : line === 4 ? "cart" : null
    },
  }
  const settings = createSettings()
  const { container, inspector, select } = setup(
    "function",
    null,
    sources,
    settings,
  )
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      hooks: [
        { name: "State", value: 1, site: site(3) },
        {
          name: "useCart",
          value: "2 items",
          site: site(4),
          hooks: [{ name: "State", value: 2, site: site(9) }],
        },
        { name: "Effect" },
      ],
    }),
  )
  inspector.open("Hooks.1")
  await settled()
  expect(rows(container)).toEqual([
    "State: 1",
    'useCart: "2 items"',
    "State: 2",
    "Effect",
  ])
  expect(asked).toEqual([])
  settings.setHookNames(true)
  await settled()
  expect(rows(container)).toEqual([
    "State(count): 1",
    'useCart(cart): "2 items"',
    "State: 2",
    "Effect",
  ])
})

test("another source never shows the previous one's location while it resolves", async () => {
  const other = { ...frame, url: "http://h/src/Other.jsx" }
  const sources: Sources = {
    ...noSources,
    // The other source never resolves.
    resolve: (source) =>
      "url" in source && source.url === other.url
        ? new Promise(() => {})
        : Promise.resolve(counterAt),
  }
  const { container, inspector, select } = setup("function", null, sources)
  select()
  inspector.receive(inspected(3, { props: object({}), source: frame }))
  await settled()
  expect(container.querySelector("[data-testid=source]")).not.toBeNull()
  inspector.receive(inspected(3, { props: object({}), source: other }))
  await settled()
  expect(container.querySelector("[data-testid=source]")).toBeNull()
})
