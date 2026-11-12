import {
  expanded,
  inspected,
  type TreeKind,
  treeBatch,
  type Value,
} from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { Inspector } from "../src/Inspector"
import { createInspectorStore, type InspectorCommand } from "../src/inspection"
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
function setup(kind: TreeKind = "function", key: string | null = null) {
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
  const view = render(() => <Inspector tree={tree} inspector={inspector} />)
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
