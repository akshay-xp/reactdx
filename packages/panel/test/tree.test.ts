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

test("clear empties the store", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.clear()
  expect(tree.rows(1)).toEqual([])
})
