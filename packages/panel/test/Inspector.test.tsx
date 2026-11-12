import {
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
