import { type TreeKind, type TreeOp, treeBatch } from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { TreeView } from "../src/TreeView"
import { createTreeStore } from "../src/tree"

const add = (
  id: number,
  parentId: number,
  name: string,
  index = 0,
  kind: TreeKind = "function",
  key: string | null = null,
): TreeOp => ({
  op: "add",
  id,
  parentId,
  rootId: 1,
  kind,
  name,
  key,
  index,
})

const store = (ops: TreeOp[]) => {
  const tree = createTreeStore()
  tree.apply(treeBatch(1, [{ op: "reset" }, ...ops]))
  return tree
}

const view = (ops: TreeOp[]) => {
  const tree = store(ops)
  const { container } = render(() => <TreeView tree={tree} rootId={1} />)
  const nodes = () => [...container.querySelectorAll("[data-testid=node]")]
  return { tree, container, nodes }
}

test("only a window of a large tree is in the DOM", () => {
  const children = Array.from({ length: 1000 }, (_, i) =>
    add(i + 2, 1, `Cell${i}`, i),
  )
  const { container, nodes } = view([add(1, 0, "App"), ...children])
  expect(nodes().length).toBeLessThan(100)
  expect(nodes()[0]?.textContent).toBe("App")
  const spacer = container.querySelector("[data-testid=tree] > div")
  expect((spacer as HTMLElement).style.height).toBe("20020px")
})

test("rows show a kind badge, the key and a text-free toggle", () => {
  const { nodes } = view([
    add(1, 0, "App"),
    add(2, 1, "Memoized", 0, "memo", "a"),
    add(3, 1, "Fwd", 1, "forwardRef"),
  ])
  expect(nodes().map((n) => n.textContent)).toEqual([
    "App",
    'Memoized memo key="a"',
    "Fwd forwardRef",
  ])
  const toggles = nodes().map((n) => n.querySelector("[data-testid=toggle]"))
  expect(toggles.map((t) => t !== null)).toEqual([true, false, false])
  expect(toggles[0]?.textContent).toBe("")
})

test("keys render as text, never markup", () => {
  const { container } = view([
    add(1, 0, "App", 0, "function", "<img src=x onerror=alert(1)>"),
  ])
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain('key="<img src=x onerror=alert(1)>"')
})

// App > div > [A > span > B, C]
const small = [
  add(1, 0, "App"),
  add(2, 1, "div", 0, "host"),
  add(3, 2, "A", 0, "memo", "k"),
  add(4, 3, "span", 0, "host"),
  add(5, 4, "B"),
  add(6, 2, "C", 1),
]

test("clicking a row selects it; clicking its toggle collapses it", () => {
  const { nodes } = view(small)
  const row = (name: string) =>
    nodes().find((n) => n.textContent?.split(" ")[0] === name) as HTMLElement
  fireEvent.click(row("A"))
  expect(nodes().map((n) => n.getAttribute("aria-selected"))).toEqual([
    "false",
    "true",
    "false",
    "false",
  ])
  expect(row("A").classList).toContain("bg-selected")
  for (const testid of ["badge", "key"]) {
    const part = row("A").querySelector(`[data-testid=${testid}]`)
    expect(part?.classList).toContain("text-fg")
    expect(part?.classList).not.toContain("text-muted")
  }
  fireEvent.click(row("App").querySelector("[data-testid=toggle]") as Element)
  expect(nodes().map((n) => n.textContent)).toEqual(["App"])
})

test("keys on the tree move the selection", () => {
  const { tree, container, nodes } = view(small)
  const scroller = container.querySelector("[data-testid=tree]") as Element
  tree.select(1)
  const down = new KeyboardEvent("keydown", {
    key: "ArrowDown",
    bubbles: true,
    cancelable: true,
  })
  scroller.dispatchEvent(down)
  expect(down.defaultPrevented).toBe(true)
  expect(nodes()[1]?.getAttribute("aria-selected")).toBe("true")
  const other = new KeyboardEvent("keydown", {
    key: "a",
    bubbles: true,
    cancelable: true,
  })
  scroller.dispatchEvent(other)
  expect(other.defaultPrevented).toBe(false)
})
