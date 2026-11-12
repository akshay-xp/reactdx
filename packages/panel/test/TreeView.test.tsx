import { type TreeKind, type TreeOp, treeBatch } from "@reactdx/messages"
import { render } from "@solidjs/testing-library"
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
