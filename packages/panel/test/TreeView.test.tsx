import {
  countsMessage,
  type TreeKind,
  type TreeOp,
  treeBatch,
} from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { expect, test, vi } from "vitest"
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

test("search matches are marked", () => {
  const { tree, nodes } = view(small)
  const name = (n: Element) => n.querySelector("[data-testid=name]")
  const marked = () =>
    nodes()
      .filter((n) => n.getAttribute("data-match") === "true")
      .map((n) => name(n)?.textContent)
  expect(marked()).toEqual([])
  tree.setQuery("a")
  expect(marked()).toEqual(["App", "A"])
  const app = name(nodes()[0] as Element)
  expect(app?.classList).toContain("text-fg")
  expect(app?.classList).not.toContain("text-accent")
  tree.step(1)
  expect(name(nodes()[0] as Element)?.classList).toContain("text-accent")
})

test("hovering a row sets hovered; leaving the tree clears it", () => {
  const { tree, container, nodes } = view(small)
  const name = (i: number) =>
    nodes()[i]?.querySelector("[data-testid=name]") as Element
  fireEvent.pointerOver(name(1))
  expect(tree.hovered()).toBe(3)
  fireEvent.pointerOver(name(0))
  expect(tree.hovered()).toBe(1)
  fireEvent.pointerLeave(
    container.querySelector("[data-testid=tree]") as Element,
  )
  expect(tree.hovered()).toBeUndefined()
  fireEvent.pointerOver(name(1))
  tree.clear()
  expect(tree.hovered()).toBeUndefined()
})

test("a tree renders the rows in its pane's view: 400 px is 20 rows plus overscan", () => {
  // jsdom has no layout: every box is 400 px tall and at the top.
  const clientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  )
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  })
  try {
    const tree = createTreeStore()
    const { container } = render(() => (
      <div data-testid="trees">
        <TreeView tree={tree} rootId={1} />
      </div>
    ))
    tree.apply(
      treeBatch(1, [
        { op: "reset" },
        ...Array.from({ length: 100 }, (_, i) => add(i + 1, 0, `Row${i}`, i)),
      ]),
    )
    expect(container.querySelectorAll("[data-testid=node]").length).toBe(30)
  } finally {
    if (clientHeight)
      Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight)
  }
})

test("a row shows its render count past one, and a mark while just rendered", () => {
  vi.useFakeTimers()
  try {
    const { tree, nodes } = view([add(1, 0, "App"), add(2, 1, "A")])
    tree.receiveCounts(
      countsMessage([
        { id: 1, renders: 4, wasted: 0 },
        { id: 2, renders: 1, wasted: 0 },
      ]),
    )
    const [app, a] = nodes()
    expect(app?.querySelector("[data-testid=renders]")?.textContent).toBe("4")
    expect(a?.querySelector("[data-testid=renders]")).toBeNull()
    expect(app?.hasAttribute("data-recent")).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(nodes()[0]?.hasAttribute("data-recent")).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

// The page sends counts on every flush: rebuilding the rows for them replaced
// every row element, which a 10,000-row tree can't afford.
test("counts and their fade update the rows in place", () => {
  vi.useFakeTimers()
  try {
    const { tree, nodes } = view([add(1, 0, "App"), add(2, 1, "A")])
    const before = nodes()
    tree.receiveCounts(countsMessage([{ id: 2, renders: 2, wasted: 0 }]))
    vi.advanceTimersByTime(1000)
    expect(
      nodes()[1]?.querySelector("[data-testid=renders]")?.textContent,
    ).toBe("2")
    expect(nodes().every((node, i) => node === before[i])).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test("a group row shows its size and wasted renders, and opens to its members", () => {
  const rowsOps = [0, 1, 2, 3, 4].map((i) =>
    add(2 + i, 1, "Row", i, "function", `r${i}`),
  )
  const { tree, nodes } = view([add(1, 0, "App"), ...rowsOps])
  tree.receiveCounts(
    countsMessage([2, 3, 4, 5, 6].map((id) => ({ id, renders: 3, wasted: 2 }))),
  )
  const group = nodes()[1] as HTMLElement
  expect(group.querySelector("[data-testid=name]")?.textContent).toBe("Row")
  expect(group.querySelector("[data-testid=group]")?.textContent).toBe(
    "×5 · 10 wasted",
  )
  expect(group.querySelector("[data-testid=key]")).toBeNull()
  fireEvent.pointerOver(group)
  expect(tree.hovered()).toBeUndefined()
  fireEvent.click(group.querySelector("[data-toggle]") as Element)
  expect(nodes()).toHaveLength(7)
})

test("a Server Component row has a server badge and works like any row", () => {
  const { tree, container, nodes } = view([
    add(1, 0, "Shop", 0, "server"),
    add(2, 1, "Cart"),
  ])
  expect(nodes().map((n) => n.textContent)).toEqual([
    "Shop server",
    "Cart client",
  ])
  const badge = () =>
    nodes()[0]?.querySelector("[data-testid=badge]") as Element
  expect(badge().className).toContain("text-server")
  fireEvent.click(nodes()[0] as Element)
  expect(tree.selected()).toBe(1)
  expect(badge().className).toContain("text-fg")
  expect(badge().className).not.toContain("text-server")
  fireEvent.keyDown(container.querySelector("[data-testid=tree]") as Element, {
    key: "ArrowDown",
  })
  expect(tree.selected()).toBe(2)
  tree.setQuery("shop")
  expect(tree.matches()).toEqual([1])
})

test("the first client component under a server row is marked client", () => {
  const { nodes } = view([
    add(1, 0, "Shop", 0, "server"),
    add(2, 1, "AddToCart", 0, "lazy"),
    add(3, 2, "Inner"),
  ])
  expect(nodes().map((n) => n.textContent)).toEqual([
    "Shop server",
    "AddToCart lazy client",
    "Inner",
  ])
  const mark = nodes()[1]?.querySelector("[data-testid=client]") as Element
  expect(mark.className).toContain("text-client")
  fireEvent.click(nodes()[1] as Element)
  expect(mark.className).toContain("text-fg")
})

test("a Suspense row says how long it has waited, then how long it took", () => {
  const { tree, nodes } = view([add(1, 0, "Suspense", 0, "suspense")])
  tree.apply(
    treeBatch(2, [{ op: "suspense", id: 1, state: "waiting", ms: 1200 }]),
  )
  expect(nodes().map((n) => n.textContent)).toEqual(["Suspense waiting 1.2s"])
  const chip = () => nodes()[0]?.querySelector("[data-testid=wait]") as Element
  expect(chip().className).toContain("text-waiting")
  tree.apply(
    treeBatch(3, [{ op: "suspense", id: 1, state: "arrived", ms: 840 }]),
  )
  expect(nodes().map((n) => n.textContent)).toEqual([
    "Suspense arrived in 840 ms",
  ])
  expect(chip().className).toContain("text-muted")
})
