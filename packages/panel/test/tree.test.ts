import { type TreeKind, type TreeOp, treeBatch } from "@reactdx/messages"
import { expect, test } from "vitest"
import { createTreeStore } from "../src/tree"

const add = (
  id: number,
  parentId: number,
  name: string,
  index = 0,
  kind: TreeKind = "function",
  rootId = 1,
): TreeOp => ({
  op: "add",
  id,
  parentId,
  rootId,
  kind,
  name,
  key: null,
  index,
})

// Root 1: App > div > [A > span > B, C]; root 2: D.
const resync = treeBatch(1, [
  { op: "reset" },
  add(1, 0, "App"),
  add(2, 1, "div", 0, "host"),
  add(3, 2, "A"),
  add(4, 3, "span", 0, "host"),
  add(5, 4, "B"),
  add(6, 2, "C", 1),
  add(7, 0, "D", 0, "function", 2),
])

const names = (rows: { name: string; depth: number }[]) =>
  rows.map(({ name, depth }) => `${depth} ${name}`)

test("rows are depth-first with host nodes hidden", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "2 B", "1 C"])
  expect(tree.rows(1).map((row) => row.id)).toEqual([1, 3, 5, 6])
  expect(names(tree.rows(2))).toEqual(["0 D"])
})

test("removes, reorders, renames and resets apply", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.apply(
    treeBatch(2, [{ op: "reorder", rootId: 1, parentId: 2, children: [6, 3] }]),
  )
  expect(names(tree.rows(1))).toEqual(["0 App", "1 C", "1 A", "2 B"])
  tree.apply(treeBatch(3, [{ op: "rename", id: 6, name: "Renamed" }]))
  tree.apply(treeBatch(4, [{ op: "remove", id: 3 }]))
  expect(names(tree.rows(1))).toEqual(["0 App", "1 Renamed"])
  tree.apply(treeBatch(1, [{ op: "reset" }, add(9, 0, "Other")]))
  expect(names(tree.rows(1))).toEqual(["0 Other"])
  expect(tree.rows(2)).toEqual([])
})

test("a seq gap asks for a resync once, then waits for a reset", () => {
  const tree = createTreeStore()
  expect(tree.apply(resync)).toBe(false)
  const before = tree.rows(1)
  expect(tree.apply(treeBatch(3, [{ op: "remove", id: 3 }]))).toBe(true)
  expect(tree.rows(1)).toEqual(before)
  expect(tree.apply(treeBatch(4, [{ op: "remove", id: 3 }]))).toBe(false)
  expect(tree.rows(1)).toEqual(before)
  expect(tree.apply(resync)).toBe(false)
  expect(tree.apply(treeBatch(2, [{ op: "remove", id: 3 }]))).toBe(false)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 C"])
})

test.each<[string, TreeOp]>([
  ["a remove", { op: "remove", id: 999 }],
  ["a rename", { op: "rename", id: 999, name: "X" }],
  ["a reorder", { op: "reorder", rootId: 1, parentId: 999, children: [] }],
  ["an add", add(10, 999, "X")],
])("%s of an unknown id asks for a resync", (_, op) => {
  const tree = createTreeStore()
  tree.apply(resync)
  expect(tree.apply(treeBatch(2, [op]))).toBe(true)
})

test("rows carry kind, key and expand state", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  const [app, a, b] = tree.rows(1)
  expect(app).toMatchObject({
    kind: "function",
    key: null,
    expandable: true,
    expanded: true,
  })
  expect(a?.expandable).toBe(true)
  expect(b?.expandable).toBe(false)
})

test("collapsing hides descendants; expanding restores them", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.toggle(1)
  expect(names(tree.rows(1))).toEqual(["0 App"])
  expect(tree.rows(1)[0]?.expanded).toBe(false)
  tree.toggle(1)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "2 B", "1 C"])
  tree.toggle(3)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "1 C"])
})

test("selection survives commits that keep the node, clears when it's gone", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.select(5)
  tree.apply(treeBatch(2, [{ op: "rename", id: 6, name: "Renamed" }]))
  tree.apply(
    treeBatch(3, [{ op: "reorder", rootId: 1, parentId: 2, children: [6, 3] }]),
  )
  expect(tree.selected()).toBe(5)
  tree.apply(treeBatch(4, [{ op: "remove", id: 3 }]))
  expect(tree.selected()).toBeUndefined()

  tree.select(6)
  tree.apply(resync)
  expect(tree.selected()).toBe(6)
  tree.clear()
  expect(tree.selected()).toBeUndefined()
})

test("Up, Down, Home and End move through the root's rows", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  const press = (key: string) => {
    expect(tree.key(1, key)).toBe(true)
    return tree.selected()
  }
  expect(press("ArrowDown")).toBe(1)
  expect(press("ArrowDown")).toBe(3)
  expect(press("ArrowDown")).toBe(5)
  expect(press("ArrowDown")).toBe(6)
  expect(press("ArrowDown")).toBe(6)
  tree.select(3)
  expect(press("ArrowUp")).toBe(1)
  expect(press("ArrowUp")).toBe(1)
  expect(press("End")).toBe(6)
  expect(press("Home")).toBe(1)

  tree.toggle(3)
  tree.select(3)
  expect(press("ArrowDown")).toBe(6)

  tree.select(7)
  expect(press("ArrowDown")).toBe(1)
  expect(tree.key(1, "a")).toBe(false)
  expect(tree.selected()).toBe(1)
})

test("Left collapses or goes to the parent; Right expands or goes to the first child", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  const press = (key: string) => {
    expect(tree.key(1, key)).toBe(true)
    return tree.selected()
  }
  tree.select(5)
  expect(press("ArrowLeft")).toBe(3)
  expect(press("ArrowLeft")).toBe(3)
  expect(tree.rows(1)[1]?.expanded).toBe(false)
  expect(press("ArrowLeft")).toBe(1)
  expect(press("ArrowLeft")).toBe(1)
  expect(names(tree.rows(1))).toEqual(["0 App"])
  expect(press("ArrowLeft")).toBe(1)

  expect(press("ArrowRight")).toBe(1)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "1 C"])
  expect(press("ArrowRight")).toBe(3)
  expect(press("ArrowRight")).toBe(3)
  expect(tree.rows(1)[1]?.expanded).toBe(true)
  expect(press("ArrowRight")).toBe(5)
  expect(press("ArrowRight")).toBe(5)
})

test("DOM elements show as rows on request", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  expect(tree.showHosts()).toBe(false)
  tree.setShowHosts(true)
  expect(names(tree.rows(1))).toEqual([
    "0 App",
    "1 div",
    "2 A",
    "3 span",
    "4 B",
    "2 C",
  ])
  tree.select(5)
  tree.key(1, "ArrowLeft")
  expect(tree.selected()).toBe(4)
  tree.setShowHosts(false)
  expect(tree.selected()).toBeUndefined()
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "2 B", "1 C"])
})

test("a query matches names case-insensitively and selects the first", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.setQuery("a")
  expect(tree.query()).toBe("a")
  expect(tree.matches()).toEqual([1, 3])
  expect(tree.selected()).toBe(1)
  tree.setQuery("A")
  expect(tree.matches()).toEqual([1, 3])

  tree.toggle(1)
  tree.setQuery("b")
  expect(tree.matches()).toEqual([5])
  expect(tree.selected()).toBe(5)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "2 B", "1 C"])

  tree.setQuery("a")
  tree.apply(treeBatch(2, [{ op: "remove", id: 3 }]))
  expect(tree.matches()).toEqual([1])

  tree.setQuery("zzz")
  expect(tree.matches()).toEqual([])
  expect(tree.selected()).toBe(1)
  tree.setShowHosts(true)
  tree.setQuery("span")
  expect(tree.matches()).toEqual([])
  tree.setQuery("div")
  expect(tree.matches()).toEqual([2])
  tree.setQuery("")
  expect(tree.matches()).toEqual([])
})

test("step cycles the matches and position counts from 1", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.setQuery("a")
  expect(tree.position()).toBe(1)
  tree.step(1)
  expect([tree.selected(), tree.position()]).toEqual([3, 2])
  tree.step(1)
  expect(tree.selected()).toBe(1)
  tree.step(-1)
  expect(tree.selected()).toBe(3)

  tree.select(6)
  expect(tree.position()).toBe(0)
  tree.step(1)
  expect(tree.selected()).toBe(1)
  tree.select(6)
  tree.step(-1)
  expect(tree.selected()).toBe(3)

  tree.setQuery("zzz")
  tree.step(1)
  expect(tree.selected()).toBe(3)
})

test("a pick turns picking off and selects a known node", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  expect(tree.picking()).toBe(false)
  tree.setPicking(true)
  expect(tree.picking()).toBe(true)
  tree.toggle(1)
  tree.picked(5)
  expect(tree.picking()).toBe(false)
  expect(tree.selected()).toBe(5)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "2 B", "1 C"])

  for (const id of [null, 999]) {
    tree.setPicking(true)
    tree.picked(id)
    expect(tree.picking()).toBe(false)
    expect(tree.selected()).toBe(5)
  }
  tree.setPicking(true)
  tree.clear()
  expect(tree.picking()).toBe(false)
})

test("clear empties the store", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.clear()
  expect(tree.rows(1)).toEqual([])
})
