import { type TreeKind, type TreeOp, treeBatch } from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { Toolbar } from "../src/Toolbar"
import { TreeView } from "../src/TreeView"
import { createTreeStore } from "../src/tree"

const add = (
  id: number,
  parentId: number,
  name: string,
  index = 0,
  kind: TreeKind = "function",
): TreeOp => ({
  op: "add",
  id,
  parentId,
  rootId: 1,
  kind,
  name,
  key: null,
  index,
})

// App > [Item, div > Item, Item]
const setup = () => {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      add(1, 0, "App"),
      add(2, 1, "Item", 0),
      add(3, 1, "div", 1, "host"),
      add(4, 3, "Item", 0),
      add(5, 1, "Item", 2),
    ]),
  )
  const { container } = render(() => (
    <>
      <Toolbar tree={tree} />
      <TreeView tree={tree} rootId={1} />
    </>
  ))
  const search = container.querySelector(
    "[data-testid=search]",
  ) as HTMLInputElement
  const count = () =>
    container.querySelector("[data-testid=search-count]")?.textContent
  const names = () =>
    [...container.querySelectorAll("[data-testid=name]")].map(
      (n) => n.textContent,
    )
  const type = (value: string) => fireEvent.input(search, { target: { value } })
  return { tree, container, search, count, names, type }
}

test("typing shows the counter; Enter and Shift+Enter cycle", () => {
  const { search, count, type } = setup()
  expect(count()).toBeUndefined()
  type("item")
  expect(count()).toBe("1 of 3")
  fireEvent.keyDown(search, { key: "Enter" })
  expect(count()).toBe("2 of 3")
  fireEvent.keyDown(search, { key: "Enter", shiftKey: true })
  expect(count()).toBe("1 of 3")
  type("zzz")
  expect(count()).toBe("0 of 0")
  type("")
  expect(count()).toBeUndefined()
})

test("the clear button empties the search", () => {
  const { tree, container, search, type } = setup()
  const clear = () =>
    container.querySelector("[aria-label='Clear search']") as Element | null
  expect(clear()).toBeNull()
  type("item")
  fireEvent.click(clear() as Element)
  expect(tree.query()).toBe("")
  expect(search.value).toBe("")
  expect(clear()).toBeNull()
})

test("the Show DOM elements toggle shows and hides host rows", () => {
  const { container, names } = setup()
  const toggle = container.querySelector("[data-testid=show-dom]") as Element
  expect(toggle.tagName).toBe("BUTTON")
  expect(toggle.textContent).toBe("")
  expect(toggle.getAttribute("aria-label")).toBe("Show DOM elements")
  expect(toggle.getAttribute("title")).toBe("Show DOM elements")
  expect(toggle.getAttribute("aria-pressed")).toBe("false")
  expect(names()).not.toContain("div")
  fireEvent.click(toggle)
  expect(toggle.getAttribute("aria-pressed")).toBe("true")
  expect(names()).toContain("div")
  fireEvent.click(toggle)
  expect(names()).not.toContain("div")
})

test("the picker button toggles picking and follows a pick", () => {
  const { tree, container } = setup()
  const pick = container.querySelector("[data-testid=pick]") as Element
  expect(pick).not.toBeNull()
  expect(pick.getAttribute("aria-label")).toBe("Pick element")
  expect(pick.getAttribute("title")).toBe("Pick element")
  expect(pick.getAttribute("aria-pressed")).toBe("false")
  fireEvent.click(pick)
  expect(tree.picking()).toBe(true)
  expect(pick.getAttribute("aria-pressed")).toBe("true")
  fireEvent.click(pick)
  expect(tree.picking()).toBe(false)
  fireEvent.click(pick)
  tree.picked(null)
  expect(pick.getAttribute("aria-pressed")).toBe("false")
})
