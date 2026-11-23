import {
  expanded,
  inspected,
  type TreeKind,
  treeBatch,
  type Value,
  valueStored,
} from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { createSignal } from "solid-js"
import { expect, test, vi } from "vitest"
import { Inspector } from "../src/Inspector"
import { createInspectorStore, type InspectorCommand } from "../src/inspection"
import type { Sources } from "../src/source"
import { createTreeStore } from "../src/tree"
import { previewText } from "../src/value"

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
  const copied: string[] = []
  const inspector = createInspectorStore(
    (command) => sent.push(command),
    (text) => copied.push(text),
  )
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
  return { tree, inspector, sent, copied, select, ...view }
}

const sections = (container: Element) =>
  [...container.querySelectorAll("[data-testid=section]")].map(
    (section) => section.querySelector("button")?.textContent,
  )
const rows = (container: Element) =>
  [...container.querySelectorAll("[data-testid=value]")].map(
    (row) => row.textContent,
  )

test("empty states say what to do; the first offers the picker", () => {
  const { container, inspector, tree, select, getByRole } = setup()
  expect(container.textContent).toBe(
    "Select a component to inspect it.Click it in the tree, or pick it on the page.Pick an element",
  )
  const pick = getByRole("button", { name: "Pick an element" })
  fireEvent.click(pick)
  expect(tree.picking()).toBe(true)
  expect(pick.getAttribute("aria-pressed")).toBe("true")
  expect(pick.textContent).toBe("Click an element on the page")
  fireEvent.click(pick)
  expect(tree.picking()).toBe(false)
  select()
  inspector.receive(inspected(3, null))
  expect(container.textContent).toBe(
    "This component unmounted.Select another in the tree.",
  )
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
  expect(sections(container)).toEqual(["Why did this render", "Props", "State"])
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
  expect(getByLabelText("Search keys and values")).toBeTruthy()
  // Matches the value, case ignored.
  search(container, "count")
  expect(rows(container)).toEqual(['label: "Count"'])
  expect(sections(container)).toEqual(["Props"])
  search(container, "step")
  expect(rows(container)).toEqual(["step: 1"])
  search(container, "zzz")
  expect(rows(container)).toEqual([])
  expect(container.textContent).toContain("No matches")

  fireEvent.keyDown(getByLabelText("Search keys and values"), { key: "Escape" })
  expect(rows(container)).toEqual(['label: "Count"', "step: 1", "ticks: 2"])
  expect(sections(container)).toEqual(["Why did this render", "Props", "State"])
  search(container, "zzz")
  fireEvent.click(getByLabelText("Clear value search"))
  expect(rows(container)).toEqual(['label: "Count"', "step: 1", "ticks: 2"])
  expect(
    (getByLabelText("Search keys and values") as HTMLInputElement).value,
  ).toBe("")
})

test("empty sections aren't shown", () => {
  const { container, inspector, select } = setup("class")
  select()
  inspector.receive(inspected(3, { props: object({}) }))
  expect(sections(container)).toEqual(["Why did this render"])
})

test("a section header collapses and expands it", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1 }) }))
  const header = [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[data-testid=section] button",
    ),
  ].find((button) => button.textContent === "Props") as HTMLButtonElement
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

test("search reaches loaded values, expanding their ancestors only while it filters", () => {
  const { container, inspector, select, sent, getByRole } = setup()
  select()
  const ref: Value = {
    type: "ref",
    id: 9,
    preview: { type: "object", className: "Object", size: 1 },
  }
  inspector.receive(
    inspected(3, {
      props: object({
        a: object({ b: object({ c: "needle" }, { id: 6 }) }, { id: 5 }),
        deep: ref,
        other: 1,
      }),
    }),
  )
  // A ref the page already sent, closed again: loaded, so searched.
  fireEvent.click(toggle(container, "deep") as Element)
  inspector.receiveExpanded(
    expanded(9, 0, object({ hidden: "pin" }, { id: 9 })),
  )
  fireEvent.click(toggle(container, "deep") as Element)
  const before = sent.length

  search(container, "needle")
  expect(rows(container)).toEqual([
    "a: {b: {...}}",
    'b: {c: "needle"}',
    'c: "needle"',
  ])
  search(container, "pin")
  expect(rows(container)).toEqual(["deep: {...}", 'hidden: "pin"'])
  expect(sent.length).toBe(before)

  // Clearing restores the user's state: everything closed.
  search(container, "")
  expect(rows(container)).toEqual(["a: {b: {...}}", "deep: {...}", "other: 1"])

  // A collapsed section opens while filtering, and is collapsed again after.
  fireEvent.click(getByRole("treeitem", { name: "Props" }))
  expect(rows(container)).toEqual([])
  search(container, "other")
  expect(rows(container)).toEqual(["other: 1"])
  search(container, "")
  expect(rows(container)).toEqual([])
})

test("the search query is kept for the next component", () => {
  const { container, inspector, select, tree, getByLabelText } = setup()
  tree.apply(
    treeBatch(2, [
      {
        op: "add",
        id: 4,
        parentId: 0,
        rootId: 1,
        kind: "function",
        name: "Other",
        key: null,
        index: 1,
      },
    ]),
  )
  select()
  inspector.receive(inspected(3, { props: object({ label: "Count" }) }))
  search(container, "count")
  tree.select(4)
  inspector.inspect(4)
  inspector.receive(inspected(4, { props: object({ count: 1, other: 2 }) }))
  expect(rows(container)).toEqual(["count: 1"])
  // Through "Select a component" and back.
  tree.clear()
  tree.apply(treeBatch(3, [{ op: "reset" }]))
  expect(container.textContent).toMatch(/^Select a component to inspect it\./)
  tree.apply(
    treeBatch(4, [
      {
        op: "add",
        id: 3,
        parentId: 0,
        rootId: 1,
        kind: "function",
        name: "Counter",
        key: null,
        index: 0,
      },
    ]),
  )
  select()
  inspector.receive(inspected(3, { props: object({ label: "Count", x: 1 }) }))
  expect(
    (getByLabelText("Search keys and values") as HTMLInputElement).value,
  ).toBe("count")
  expect(rows(container)).toEqual(['label: "Count"'])
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
  expect(sections(container)).toEqual(["Why did this render", "Hooks"])
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

test("search filters hooks by name, value and sub-hooks, and owners by name", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      hooks: [
        ...hooks,
        {
          name: "useForm",
          value: "f",
          hooks: [{ name: "Reducer", value: 1 }],
        },
      ],
      owners: [
        { id: null, name: "App" },
        { id: null, name: "Page" },
      ],
    }),
  )
  const owners = () =>
    [...container.querySelectorAll("[data-testid=owner]")].map(
      (el) => el.textContent,
    )
  search(container, "cart")
  expect(rows(container)).toEqual(['useCart: "2 items"'])
  search(container, "effect")
  expect(rows(container)).toEqual(["Effect"])
  // A sub-hook's match shows its custom hook, open.
  search(container, "reducer")
  expect(rows(container)).toEqual(['useForm: "f"', "Reducer: 1"])
  expect(sections(container)).toEqual(["Hooks"])
  search(container, "app")
  expect(rows(container)).toEqual([])
  expect(owners()).toEqual(["App"])
  expect(sections(container)).toEqual(["Rendered by"])
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
  expect(sections(container)).toEqual(["Why did this render", "Hooks"])
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
  expect(sections(container)).toEqual([
    "Why did this render",
    "Hooks",
    "Context",
  ])
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
  expect(sections(container)).toEqual([
    "Why did this render",
    "Props",
    "Rendered by",
  ])
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
  expect(sections(container)).toEqual(["Why did this render", "Props"])
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

test("the source row scrolls with the sections, first above them", async () => {
  const { container, inspector, select } = setup(
    "function",
    null,
    resolving(counterAt),
  )
  select()
  inspector.receive(
    inspected(3, {
      props: object({ a: 1 }),
      source: frame,
    }),
  )
  await settled()
  const scroller = container.querySelector("[data-testid=section]")
    ?.parentElement as HTMLElement
  expect(scroller.firstElementChild?.getAttribute("data-testid")).toBe("source")
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
  inspector.open({ root: { hook: [1] }, keys: [] })
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

// Right-clicks the row reading `text` and returns the menu's item labels.
const menuOn = (container: Element, text: string) => {
  const row = [...container.querySelectorAll("[data-testid=value]")].find(
    (r) => r.textContent === text,
  )
  fireEvent.contextMenu(row as Element, { clientX: 10, clientY: 20 })
  return [...document.querySelectorAll("[role=menuitem]")].map(
    (item) => item.textContent,
  )
}
const choose = (label: string) =>
  fireEvent.click(
    [...document.querySelectorAll("[role=menuitem]")].find(
      (item) => item.textContent === label,
    ) as Element,
  )
const menu = () => document.querySelector("[role=menu]")

test("right-clicking a row offers Copy key, Copy value and Store as global variable", () => {
  const { container, inspector, sent, copied, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        label: "Count",
        list: { type: "array", id: 6, length: 1, items: ["a"] },
      }),
    }),
  )
  expect(menuOn(container, 'label: "Count"')).toEqual([
    "Copy key",
    "Copy value",
    "Store as global variable",
    // A prop can be renamed and deleted (#53).
    "Rename key",
    "Delete",
  ])
  choose("Copy key")
  expect(copied).toEqual(["label"])
  expect(menu()).toBeNull()
  // The page copies or stores the value: the panel's may be cut short.
  menuOn(container, 'label: "Count"')
  choose("Copy value")
  fireEvent.click(toggle(container, "list") as Element)
  menuOn(container, '0: "a"')
  choose("Store as global variable")
  expect(sent.slice(-2)).toEqual([
    { type: "copy-value", target: { objectId: 1, key: "label" } },
    { type: "store-value", target: { objectId: 6, key: 0 } },
  ])
})

test("hook and context rows name the hook by call path and the context by read order", () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      hooks,
      contexts: [
        { name: "Zoom", value: 1 },
        { name: "Auth", value: 2 },
      ],
    }),
  )
  fireEvent.click(toggle(container, "useCart") as Element)
  menuOn(container, "State: 2")
  choose("Copy value")
  menuOn(container, 'useCart: "2 items"')
  choose("Copy value")
  // Auth reads second, though it's listed first.
  menuOn(container, "Auth: 2")
  choose("Copy value")
  expect(sent.slice(-3)).toEqual([
    { type: "copy-value", target: { hook: [1, 0] } },
    { type: "copy-value", target: { hook: [1] } },
    { type: "copy-value", target: { context: 1 } },
  ])
  // A hook without a value has only its name to copy.
  expect(menuOn(container, "Effect")).toEqual(["Copy key"])
})

test("Escape or a press outside closes the menu", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1 }) }))
  menuOn(container, "a: 1")
  // Focused, so the keyboard works it at once.
  expect(document.activeElement?.textContent).toBe("Copy key")
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" })
  expect(menu()).toBeNull()
  menuOn(container, "a: 1")
  fireEvent.pointerDown(document.body)
  expect(menu()).toBeNull()
})

test("a stored value's global is named for a few seconds", () => {
  vi.useFakeTimers()
  try {
    const { container, inspector, select } = setup()
    select()
    inspector.receive(inspected(3, { props: object({ a: 1 }) }))
    menuOn(container, "a: 1")
    choose("Store as global variable")
    inspector.receiveValueStored(valueStored("$reactdx1"))
    const status = container.querySelector("[role=status]")
    expect(status?.textContent).toBe(
      "Stored as $reactdx1. Use it in the Console.",
    )
    vi.advanceTimersByTime(4000)
    expect(status?.textContent).toBe("")
  } finally {
    vi.useRealTimers()
  }
})

test("a key with a dot and the nested keys it spells open and close independently", () => {
  const { container, inspector, select } = setup()
  select()
  const inline = (id: number, props: Record<string, Value>) =>
    object(props, { id })
  inspector.receive(
    inspected(3, {
      props: object({
        "a.b": inline(2, { x: 1 }),
        a: inline(3, { b: inline(4, { y: 2 }) }),
      }),
    }),
  )
  fireEvent.click(toggle(container, "a") as Element)
  fireEvent.click(toggle(container, "b") as Element)
  expect(toggle(container, "a.b")?.getAttribute("aria-expanded")).toBe("false")
  expect(rows(container)).not.toContain("x: 1")
  fireEvent.click(toggle(container, "a.b") as Element)
  fireEvent.click(toggle(container, "b") as Element)
  expect(rows(container)).toContain("x: 1")
  expect(rows(container)).not.toContain("y: 2")
})

// The value row reading `text`.
const rowOf = (container: Element, text: string) =>
  [...container.querySelectorAll<HTMLElement>("[data-testid=value]")].find(
    (row) => row.textContent === text,
  ) as HTMLElement
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key, ...init })

test("rows are one tab stop; Up, Down, Home and End move focus", async () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1, b: 2, c: 3 }) }))
  // The tab stop follows rendered rows (a MutationObserver, a microtask later).
  await settled()
  const tabs = () =>
    [...container.querySelectorAll("[data-testid=value]")].map((row) =>
      row.getAttribute("tabindex"),
    )
  // The Props header holds it until a row is focused (it's a row too).
  expect(tabs()).toEqual(["-1", "-1", "-1"])
  rowOf(container, "a: 1").focus()
  press("ArrowDown")
  expect(document.activeElement).toBe(rowOf(container, "b: 2"))
  expect(tabs()).toEqual(["-1", "0", "-1"])
  press("End")
  expect(document.activeElement).toBe(rowOf(container, "c: 3"))
  press("ArrowUp")
  press("ArrowUp")
  expect(document.activeElement).toBe(rowOf(container, "a: 1"))
  press("Home")
  // The first row of the tree: the first section's header.
  expect(document.activeElement?.textContent).toBe("Why did this render")
})

test("Right and Left open, close and move between levels", async () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({ obj: object({ x: 1 }, { id: 2 }), n: 1 }),
      hooks,
    }),
  )
  await settled()
  const obj = () =>
    [...container.querySelectorAll<HTMLElement>("[data-testid=value]")].find(
      (row) => row.textContent?.startsWith("obj:"),
    ) as HTMLElement
  const expanded = () =>
    obj()
      .querySelector("[data-testid=value-toggle]")
      ?.getAttribute("aria-expanded")
  obj().focus()
  press("ArrowRight")
  expect(expanded()).toBe("true")
  expect(document.activeElement).toBe(obj())
  press("ArrowRight")
  expect(document.activeElement).toBe(rowOf(container, "x: 1"))
  press("ArrowLeft")
  expect(document.activeElement).toBe(obj())
  press("ArrowLeft")
  expect(expanded()).toBe("false")
  // Nothing to open: up to its section's header.
  press("ArrowLeft")
  expect(document.activeElement?.textContent).toBe("Props")
  rowOf(container, "n: 1").focus()
  press("ArrowRight")
  expect(document.activeElement).toBe(rowOf(container, "n: 1"))
  // A custom hook opens to its hooks.
  const cart = () =>
    [...container.querySelectorAll<HTMLElement>("[data-testid=value]")].find(
      (row) => row.textContent?.startsWith("useCart"),
    ) as HTMLElement
  cart().focus()
  press("ArrowRight")
  press("ArrowRight")
  expect(document.activeElement).toBe(rowOf(container, "State: 2"))
  press("ArrowLeft")
  expect(document.activeElement).toBe(cart())
})

test("section headers are rows: Tab reaches each section's rows by arrows, Left and Right close and open it", async () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1 }), hooks }))
  await settled()
  const header = (name: string) =>
    [...container.querySelectorAll<HTMLElement>("[role=treeitem]")].find(
      (row) => row.tagName === "BUTTON" && row.textContent === name,
    ) as HTMLElement
  const stops = () =>
    [...container.querySelectorAll<HTMLElement>("[tabindex='0']")].filter(
      (el) => el.closest("[role=tree]"),
    )
  // One stop for the whole tree: the first header until a row is focused.
  expect(stops()).toEqual([header("Why did this render")])
  rowOf(container, "a: 1").focus()
  press("ArrowDown")
  expect(document.activeElement).toBe(header("Hooks"))
  press("ArrowDown")
  expect(document.activeElement).toBe(rowOf(container, "State: 0"))
  press("ArrowLeft")
  expect(document.activeElement).toBe(header("Hooks"))
  press("ArrowLeft")
  expect(header("Hooks").getAttribute("aria-expanded")).toBe("false")
  expect(rowOf(container, "State: 0")).toBeUndefined()
  press("ArrowRight")
  expect(header("Hooks").getAttribute("aria-expanded")).toBe("true")
  press("ArrowRight")
  expect(document.activeElement).toBe(rowOf(container, "State: 0"))
  expect(stops()).toEqual([rowOf(container, "State: 0")])
})

test("an editable value is marked (on hover or focus); a read-only one isn't", async () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({ a: 1 }),
      hooks: [...hooks, { name: "Ref", value: 5 }],
    }),
  )
  await settled()
  const marked = (text: string) =>
    rowOf(container, text)
      .querySelector("[data-value]")
      ?.classList.contains("editable-value")
  expect(marked("a: 1")).toBe(true)
  expect(marked("State: 0")).toBe(true)
  expect(marked("Ref: 5")).toBe(false)
})

test("the row menu opens from the keyboard and gives focus back", async () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1 }) }))
  await settled()
  const labels = () =>
    [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)
  rowOf(container, "a: 1").focus()
  press("F10", { shiftKey: true })
  expect(labels()).toEqual([
    "Copy key",
    "Copy value",
    "Store as global variable",
    "Rename key",
    "Delete",
  ])
  expect(document.activeElement?.textContent).toBe("Copy key")
  press("Escape")
  expect(menu()).toBeNull()
  expect(document.activeElement).toBe(rowOf(container, "a: 1"))
  press("ContextMenu")
  expect(labels()).toHaveLength(5)
  choose("Copy key")
  expect(document.activeElement).toBe(rowOf(container, "a: 1"))
})

test("focus stays on its row across a re-send", async () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ a: 1, b: 2 }) }))
  await settled()
  rowOf(container, "b: 2").focus()
  inspector.receive(inspected(3, { props: object({ a: 1, b: 3 }) }))
  await settled()
  expect(document.activeElement).toBe(rowOf(container, "b: 3"))
  // Focus elsewhere isn't pulled in.
  const outside = document.createElement("button")
  document.body.append(outside)
  outside.focus()
  inspector.receive(inspected(3, { props: object({ a: 1, b: 4 }) }))
  await settled()
  expect(document.activeElement).toBe(outside)
  outside.remove()
})

// The value part of the row reading `text` (after its key).
const valuePart = (container: Element, text: string) =>
  rowOf(container, text).querySelectorAll("[data-search-text]")[1] as Element
const editor = (container: Element) =>
  container.querySelector<HTMLInputElement>("[data-testid=value-input]")

test("inline editor: strings and numbers in place, Enter applies, Escape and blur cancel", async () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({ label: "Count", step: 1 }),
      hooks: [
        { name: "State", value: 0 },
        { name: "Ref", value: 1 },
      ],
    }),
  )
  await settled()
  const edits = () => sent.filter((command) => command.type === "edit")
  fireEvent.click(valuePart(container, 'label: "Count"'))
  const input = editor(container) as HTMLInputElement
  expect(input).toBeTruthy()
  expect(input.value).toBe('"Count"')
  expect(document.activeElement).toBe(input)
  fireEvent.input(input, { target: { value: "Total" } })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(edits()).toEqual([
    { type: "edit", id: 3, root: "props", path: ["label"], value: "Total" },
  ])
  expect(editor(container)).toBeNull()
  expect(document.activeElement).toBe(rowOf(container, 'label: "Count"'))

  // Enter or F2 on a focused row opens it; a number stays a number.
  rowOf(container, "step: 1").focus()
  press("Enter")
  fireEvent.input(editor(container) as Element, { target: { value: "5" } })
  fireEvent.keyDown(editor(container) as Element, { key: "Enter" })
  expect(edits().at(-1)).toMatchObject({ path: ["step"], value: 5 })
  rowOf(container, "step: 1").focus()
  press("F2")
  fireEvent.input(editor(container) as Element, { target: { value: "abc" } })
  fireEvent.keyDown(editor(container) as Element, { key: "Enter" })
  expect(container.textContent).toContain("Not a valid value")
  expect(editor(container)).not.toBeNull()
  fireEvent.keyDown(editor(container) as Element, { key: "Escape" })
  expect(editor(container)).toBeNull()
  rowOf(container, "step: 1").focus()
  press("F2")
  fireEvent.blur(editor(container) as Element)
  expect(editor(container)).toBeNull()
  expect(edits()).toHaveLength(2)

  // A state hook is editable at its root; a ref isn't.
  fireEvent.click(valuePart(container, "State: 0"))
  fireEvent.input(editor(container) as Element, { target: { value: "3" } })
  fireEvent.keyDown(editor(container) as Element, { key: "Enter" })
  expect(edits().at(-1)).toEqual({
    type: "edit",
    id: 3,
    root: { hook: [0] },
    path: [],
    value: 3,
  })
  fireEvent.click(valuePart(container, "Ref: 1"))
  expect(editor(container)).toBeNull()
})

test("a boolean flips with its checkbox or Space, shown as the page says", async () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ on: true }) }))
  await settled()
  const edits = () => sent.filter((command) => command.type === "edit")
  const box = () =>
    rowOf(container, "on: true").querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    )
  expect(box()).toBeTruthy()
  expect(box()?.checked).toBe(true)
  fireEvent.click(box() as Element)
  expect(edits()).toEqual([
    { type: "edit", id: 3, root: "props", path: ["on"], value: false },
  ])
  // Not until the page re-sends it.
  expect(box()?.checked).toBe(true)
  rowOf(container, "on: true").focus()
  press(" ")
  expect(edits()).toHaveLength(2)
  expect(edits().at(-1)).toMatchObject({ value: false })
})

test("values edit at any depth through plain objects and arrays; other containers' entries don't", async () => {
  const { container, inspector, sent, select } = setup("class")
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        user: object(
          { address: object({ city: "Paris" }, { id: 11 }) },
          { id: 10 },
        ),
        list: { type: "array", id: 12, length: 3, items: [1, 2, 3] },
        m: { type: "map", id: 13, size: 1, entries: [["k", 1]] },
        pt: object({ x: 1 }, { id: 14, className: "Point" }),
      }),
      state: object({ ticks: 2 }, { id: 15 }),
      hooks: [
        { name: "State", value: object({ a: 1 }, { id: 16 }) },
        { name: "Ref", value: object({ b: 1 }, { id: 17 }) },
      ],
    }),
  )
  await settled()
  const edits = () => sent.filter((command) => command.type === "edit")
  const editTo = (row: string, text: string) => {
    fireEvent.click(valuePart(container, row))
    const input = editor(container) as Element
    expect(input).toBeTruthy()
    fireEvent.input(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: "Enter" })
  }
  for (const name of ["user", "address", "list", "m", "pt", "State"])
    fireEvent.click(toggle(container, name) as Element)
  fireEvent.click(
    [...container.querySelectorAll("[data-testid=value]")]
      .find((row) => row.textContent?.startsWith("Ref"))
      ?.querySelector("[data-testid=value-toggle]") as Element,
  )
  editTo('city: "Paris"', "Lyon")
  editTo("2: 3", "9")
  editTo("ticks: 2", "5")
  editTo("a: 1", "7")
  expect(
    edits().map(({ root, path, value }) => ({ root, path, value })),
  ).toEqual([
    { root: "props", path: ["user", "address", "city"], value: "Lyon" },
    { root: "props", path: ["list", 2], value: 9 },
    { root: "state", path: ["ticks"], value: 5 },
    { root: { hook: [0] }, path: ["a"], value: 7 },
  ])
  for (const row of ['"k" => 1', "x: 1", "b: 1"]) {
    fireEvent.click(valuePart(container, row))
    expect(editor(container)).toBeNull()
  }
})

test("a DOM element value is a leaf: its id isn't an object id", async () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        node: { type: "element", tag: "div", id: "main", className: "" },
      }),
    }),
  )
  const row = container.querySelector("[data-testid=value]") as Element
  expect(row.querySelector("[data-testid=value-toggle]")).toBeNull()
})

test("typed edits: text reads as JSON plus markers, so a value can change type", async () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        n: null,
        s: "5",
        u: { type: "undefined" },
        f: 1,
        t: "Count",
        d: { type: "date", iso: "2026-01-01T00:00:00.000Z" },
      }),
    }),
  )
  await settled()
  const last = () => sent.filter((command) => command.type === "edit").at(-1)
  const open = (row: string) => {
    fireEvent.click(valuePart(container, row))
    return editor(container) as HTMLInputElement
  }
  const type = (row: string, text: string) => {
    const input = open(row)
    expect(input).toBeTruthy()
    fireEvent.input(input, { target: { value: text } })
    fireEvent.keyDown(input, { key: "Enter" })
  }
  expect(open('t: "Count"').value).toBe('"Count"')
  fireEvent.keyDown(editor(container) as Element, { key: "Escape" })
  type("n: null", '{"a": 1}')
  expect(last()).toMatchObject({
    path: ["n"],
    value: { type: "object", props: { a: 1 } },
  })
  type('s: "5"', "5")
  expect(last()).toMatchObject({ path: ["s"], value: 5 })
  for (const [text, value] of [
    ["undefined", { type: "undefined" }],
    ["NaN", { type: "number", value: "NaN" }],
    ["-0", { type: "number", value: "-0" }],
  ] as const) {
    type("f: 1", text)
    expect(last()).toMatchObject({ path: ["f"], value })
  }
  type("u: undefined", "2")
  expect(last()).toMatchObject({ path: ["u"], value: 2 })
  // Not JSON: a string over a string, refused over anything else.
  type('t: "Count"', "Total")
  expect(last()).toMatchObject({ path: ["t"], value: "Total" })
  type("f: 1", "abc")
  expect(container.textContent).toContain("Not a valid value")
  expect(editor(container)).not.toBeNull()
  fireEvent.keyDown(editor(container) as Element, { key: "Escape" })
  // Replace only: a date opens empty.
  expect(
    open(`d: ${previewText({ type: "date", iso: "2026-01-01T00:00:00.000Z" })}`)
      .value,
  ).toBe("")
})

test("Rename key and Delete: in the menu of rows under plain containers", async () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        a: 1,
        b: 2,
        list: { type: "array", id: 6, length: 2, items: [1, 2] },
      }),
      hooks: [{ name: "State", value: 0 }],
      contexts: [{ name: "Theme", value: 1 }],
    }),
  )
  await settled()
  const writes = () =>
    sent.filter((c) => c.type === "delete-path" || c.type === "rename-path")
  const copies = ["Copy key", "Copy value", "Store as global variable"]
  expect(menuOn(container, "a: 1")).toEqual([...copies, "Rename key", "Delete"])
  choose("Delete")
  expect(writes()).toEqual([
    { type: "delete-path", id: 3, root: "props", path: ["a"] },
  ])
  fireEvent.click(toggle(container, "list") as Element)
  expect(menuOn(container, "0: 1")).toEqual([...copies, "Delete"])
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" })
  expect(menuOn(container, "State: 0")).toEqual(copies)
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" })
  expect(menuOn(container, "Theme: 1")).toEqual(copies)
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" })

  // Renaming: the key turns into an input; a taken or empty name is refused.
  menuOn(container, "a: 1")
  choose("Rename key")
  const input = () =>
    container.querySelector<HTMLInputElement>("[data-testid=key-input]")
  expect(input()?.value).toBe("a")
  for (const name of ["b", " "]) {
    fireEvent.input(input() as Element, { target: { value: name } })
    fireEvent.keyDown(input() as Element, { key: "Enter" })
    expect(container.textContent).toContain("Not a valid name")
  }
  expect(writes()).toHaveLength(1)
  fireEvent.input(input() as Element, { target: { value: "c" } })
  fireEvent.keyDown(input() as Element, { key: "Enter" })
  expect(writes().at(-1)).toEqual({
    type: "rename-path",
    id: 3,
    root: "props",
    path: ["a"],
    to: "c",
  })
  expect(input()).toBeNull()
  menuOn(container, "a: 1")
  choose("Rename key")
  fireEvent.keyDown(input() as Element, { key: "Escape" })
  expect(input()).toBeNull()
  expect(writes()).toHaveLength(2)
})

test("Add key and Add item on plain objects and arrays only", async () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({
        o: object({ a: 1, newKey: 2 }, { id: 2 }),
        list: { type: "array", id: 6, length: 2, items: [1, 2] },
        m: { type: "map", id: 7, size: 1, entries: [["k", 1]] },
        pt: object({ x: 1 }, { id: 8, className: "Point" }),
      }),
    }),
  )
  await settled()
  const menuFor = (key: string) => {
    const row = [...container.querySelectorAll("[data-testid=value]")].find(
      (r) => r.textContent?.startsWith(`${key}:`),
    )
    fireEvent.contextMenu(row as Element)
    return [...document.querySelectorAll("[role=menuitem]")].map(
      (item) => item.textContent,
    )
  }
  const edits = () => sent.filter((c) => c.type === "edit")
  expect(menuFor("o")).toContain("Add key")
  choose("Add key")
  expect(menuFor("list")).toContain("Add item")
  choose("Add item")
  expect(edits()).toEqual([
    { type: "edit", id: 3, root: "props", path: ["o", "newKey2"], value: "" },
    {
      type: "edit",
      id: 3,
      root: "props",
      path: ["list", 2],
      value: { type: "undefined" },
    },
  ])
  for (const key of ["m", "pt"]) {
    const items = menuFor(key)
    expect(items).not.toContain("Add key")
    expect(items).not.toContain("Add item")
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" })
  }
})

test("context rows edit through their provider; a default one is read-only and says so", async () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      contexts: [
        { name: "Theme", value: "dark" },
        { name: "Context", value: null, default: true },
      ],
    }),
  )
  await settled()
  fireEvent.click(valuePart(container, 'Theme: "dark"'))
  const input = editor(container) as Element
  expect(input).toBeTruthy()
  fireEvent.input(input, { target: { value: '"light"' } })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(sent.filter((c) => c.type === "edit")).toEqual([
    { type: "edit", id: 3, root: { context: 0 }, path: [], value: "light" },
  ])
  const row = [...container.querySelectorAll("[data-testid=value]")].find((r) =>
    r.textContent?.startsWith("Context:"),
  ) as Element
  const badge = row.querySelector("[data-testid=badge]")
  expect(badge?.textContent).toBe("default")
  expect(badge?.getAttribute("title")).toBe(
    "No provider above: its default value, read-only",
  )
  fireEvent.click(row.querySelector("[data-value]") as Element)
  expect(editor(container)).toBeNull()
})

test("Force re-render in the header, for components but not DOM elements", () => {
  const { container, inspector, sent, select } = setup()
  select()
  inspector.receive(inspected(3, { props: object({}) }))
  const button = () =>
    container.querySelector(
      "[data-testid=inspector-header] [aria-label='Force re-render']",
    )
  expect(button()).toBeTruthy()
  fireEvent.click(button() as Element)
  expect(sent.at(-1)).toEqual({ type: "rerender", id: 3 })
  const host = setup("host")
  host.select()
  host.inspector.receive(inspected(3, { props: object({}) }))
  expect(
    host.container.querySelector("[aria-label='Force re-render']"),
  ).toBeNull()
})

test("Show fallback and Show error: only with a boundary, pressed while forced; turning one on selects the boundary", () => {
  const { container, tree, inspector, sent, select } = setup()
  tree.apply(
    treeBatch(2, [
      {
        op: "add",
        id: 5,
        parentId: 0,
        rootId: 1,
        kind: "suspense",
        name: "Suspense",
        key: null,
        index: 1,
      },
    ]),
  )
  select()
  const toggle = (label: string) =>
    container.querySelector(
      `[data-testid=inspector-header] [aria-label='${label}']`,
    )
  inspector.receive(inspected(3, { props: object({}) }))
  expect(toggle("Show fallback")).toBeNull()
  expect(toggle("Show error")).toBeNull()
  inspector.receive(
    inspected(3, {
      props: object({}),
      boundaries: { fallback: { id: 5, on: false } },
    }),
  )
  expect(toggle("Show fallback")?.getAttribute("aria-pressed")).toBe("false")
  expect(toggle("Show error")).toBeNull()
  fireEvent.click(toggle("Show fallback") as Element)
  expect(sent.at(-1)).toEqual({
    type: "force",
    id: 3,
    kind: "fallback",
    on: true,
  })
  expect(tree.selected()).toBe(5)
  // As main.tsx does on a selection change. The boundary's own inspection:
  // forced, so pressed; a press turns it off.
  inspector.inspect(5)
  inspector.receive(
    inspected(5, {
      props: object({}),
      boundaries: { fallback: { id: 5, on: true } },
    }),
  )
  expect(toggle("Show fallback")?.getAttribute("aria-pressed")).toBe("true")
  fireEvent.click(toggle("Show fallback") as Element)
  expect(sent.at(-1)).toEqual({
    type: "force",
    id: 5,
    kind: "fallback",
    on: false,
  })
})

test("a context hook's value opens its Context row's editor (Hooks shows it collapsed too); a default one's doesn't", async () => {
  const { container, inspector, getByRole, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      hooks: [
        { name: "Context(Theme)", value: "dark", context: 0 },
        { name: "Context", value: null, context: 1 },
      ],
      contexts: [
        { name: "Theme", value: "dark" },
        { name: "Context", value: null, default: true },
      ],
    }),
  )
  await settled()
  const hook = (text: string) => rowOf(container, text)
  const marked = (text: string) =>
    hook(text)
      .querySelector("[data-value]")
      ?.classList.contains("editable-value")
  expect(marked('Context(Theme): "dark"')).toBe(true)
  expect(marked("Context: null")).toBe(false)
  fireEvent.click(getByRole("treeitem", { name: "Context" }))
  fireEvent.click(valuePart(container, 'Context(Theme): "dark"'))
  const input = editor(container) as HTMLInputElement
  expect(input?.getAttribute("aria-label")).toBe("Edit Theme")
  expect(document.activeElement).toBe(input)
  fireEvent.keyDown(input, { key: "Escape" })
  expect(document.activeElement).toBe(rowOf(container, 'Theme: "dark"'))
  hook('Context(Theme): "dark"').focus()
  press("Enter")
  expect(editor(container)?.getAttribute("aria-label")).toBe("Edit Theme")
})

const reasons = (container: Element) =>
  [...container.querySelectorAll("[data-testid=reason]")].map(
    (row) => row.textContent,
  )

test("Why did this render comes first, with the latest render's reasons", () => {
  const { container, inspector, select, getByRole } = setup()
  select()
  inspector.receive(inspected(3, { props: object({ step: 1 }) }))
  expect(sections(container)).toEqual(["Why did this render", "Props"])
  expect(container.textContent).toContain(
    "No renders recorded since DevTools opened.",
  )
  for (const [kind, text] of [
    ["mount", "Mounted"],
    ["parent", "Parent rendered"],
    ["force", "Forced"],
  ] as const) {
    inspector.receive(
      inspected(3, {
        props: object({ step: 1 }),
        render: { seq: 1, kinds: [kind] },
      }),
    )
    expect(reasons(container)).toEqual([text])
  }
  fireEvent.click(getByRole("treeitem", { name: /Why did this render/ }))
  expect(reasons(container)).toEqual([])
})

const changes = (container: Element) =>
  [...container.querySelectorAll("[data-testid=change]")].map(
    (row) => row.textContent,
  )

test("a render's changes read old → new, under their reason", () => {
  const { container, inspector, select } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({ count: 2 }),
      hooks: [
        { name: "Ref", value: 1 },
        { name: "State", value: 1 },
      ],
      contexts: [{ name: "Theme", value: "light" }],
      render: {
        seq: 2,
        kinds: ["props", "state", "context"],
        props: [{ key: "count", old: 1, new: 2 }],
        hooks: [{ hook: [1], old: 0, new: 1 }],
        contexts: [{ context: 0, old: "dark", new: "light" }],
      },
    }),
  )
  expect(reasons(container)).toEqual([
    "Props changed",
    "State changed",
    "Context changed",
  ])
  expect(changes(container)).toEqual([
    "count: 1 → 2",
    "State #2: 0 → 1",
    'Theme: "dark" → "light"',
  ])
  inspector.receive(
    inspected(3, {
      props: object({}),
      state: object({ ticks: 1 }),
      render: {
        seq: 3,
        kinds: ["state"],
        state: [{ key: "ticks", old: 0, new: 1 }],
      },
    }),
  )
  expect(changes(container)).toEqual(["ticks: 0 → 1"])
})

test("a change holding an object opens to Before and After", () => {
  const { container, inspector, select, getByTestId } = setup()
  select()
  inspector.receive(
    inspected(3, {
      props: object({}),
      render: {
        seq: 2,
        kinds: ["props"],
        props: [
          {
            key: "user",
            old: object({ name: "Ada" }),
            new: object({ name: "Grace" }, { id: 2 }),
          },
        ],
      },
    }),
  )
  expect(changes(container)).toEqual(['user: {name: "Ada"} → {name: "Grace"}'])
  fireEvent.click(getByTestId("value-toggle"))
  expect(rows(container)).toEqual([
    'Before: {name: "Ada"}',
    'After: {name: "Grace"}',
  ])
})
