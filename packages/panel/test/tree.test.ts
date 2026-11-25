import {
  countsMessage,
  type TreeKind,
  type TreeOp,
  treeBatch,
} from "@reactdx/messages"
import { createEffect, createMemo, createRoot, on } from "solid-js"
import { expect, test, vi } from "vitest"
import { createTreeStore, type TreeStore } from "../src/tree"

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

test("when a reveal's selection lands, its row is already there", () => {
  // TreeView scrolls on the selection change, by the row's index.
  const tree = createTreeStore()
  tree.apply(resync)
  tree.toggle(1)
  const seen: boolean[] = []
  const dispose = createRoot((dispose) => {
    // As TreeView reads them.
    const rows = createMemo(() => tree.rows(1))
    createEffect(
      on(
        tree.selected,
        (id) => seen.push(rows().some((row) => row.id === id)),
        { defer: true },
      ),
    )
    return dispose
  })
  tree.reveal(5)
  dispose()
  expect(seen).toEqual([true])
})

test("each reveal counts, even of the node already selected", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.reveal(5)
  const first = tree.reveals()
  tree.reveal(5)
  expect(tree.selected()).toBe(5)
  expect(tree.reveals()).toBe(first + 1)
})

test("clear empties the store", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.clear()
  expect(tree.rows(1)).toEqual([])
})

test("reveal selects a node and expands its ancestors", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.toggle(1)
  tree.toggle(3)
  tree.reveal(5)
  expect(tree.selected()).toBe(5)
  expect(names(tree.rows(1))).toEqual(["0 App", "1 A", "2 B", "1 C"])
  tree.reveal(99)
  expect(tree.selected()).toBe(5)
})

const countsOf = (tree: TreeStore) =>
  tree.rows(1).map(({ id, name }) => {
    const { renders = 0, wasted = 0 } = tree.countOf(id) ?? {}
    return `${name} ${renders}/${wasted}`
  })

test("render counts land on their rows until the tree resets", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.receiveCounts(countsMessage([{ id: 3, renders: 4, wasted: 1 }]))
  expect(countsOf(tree)).toEqual(["App 0/0", "A 4/1", "B 0/0", "C 0/0"])
  tree.receiveCounts(countsMessage([{ id: 3, renders: 5, wasted: 1 }]))
  expect(countsOf(tree)).toContain("A 5/1")
  tree.apply(resync)
  expect(countsOf(tree)).toContain("A 0/0")
  tree.receiveCounts(countsMessage([{ id: 3, renders: 5, wasted: 1 }]))
  tree.clear()
  tree.apply(resync)
  expect(countsOf(tree)).toContain("A 0/0")
})

test("the rows in the newest counts are recent for a second", () => {
  vi.useFakeTimers()
  try {
    const tree = createTreeStore()
    tree.apply(resync)
    const recent = () =>
      tree
        .rows(1)
        .filter((row) => tree.isRecent(row.id))
        .map((row) => row.name)
    tree.receiveCounts(countsMessage([{ id: 3, renders: 2, wasted: 0 }]))
    expect(recent()).toEqual(["A"])
    vi.advanceTimersByTime(500)
    tree.receiveCounts(countsMessage([{ id: 6, renders: 2, wasted: 0 }]))
    expect(recent()).toEqual(["C"])
    vi.advanceTimersByTime(999)
    expect(recent()).toEqual(["C"])
    vi.advanceTimersByTime(1)
    expect(recent()).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

// App > 5 keyed Rows (ids 2 to 6), then 4 Items (ids 7 to 10).
const listed = treeBatch(1, [
  { op: "reset" },
  add(1, 0, "App"),
  ...[0, 1, 2, 3, 4].map((i) => ({ ...add(2 + i, 1, "Row", i), key: `r${i}` })),
  ...[0, 1, 2, 3].map((i) => add(7 + i, 1, "Item", 5 + i)),
])

test("five or more same-named siblings in a row become one group row", () => {
  const tree = createTreeStore()
  tree.apply(listed)
  tree.receiveCounts(
    countsMessage([2, 3, 4, 5, 6].map((id) => ({ id, renders: 3, wasted: 2 }))),
  )
  const rows = tree.rows(1)
  expect(names(rows)).toEqual([
    "0 App",
    "1 Row",
    "1 Item",
    "1 Item",
    "1 Item",
    "1 Item",
  ])
  expect(rows[1]).toMatchObject({
    id: -2,
    key: null,
    expandable: true,
    expanded: false,
    group: { size: 5 },
  })
  expect(tree.countOf(-2)?.wasted).toBe(10)
  expect(tree.isRecent(-2)).toBe(true)
  expect(rows[2]?.group).toBeUndefined()
})

test("a group opens to its members, by toggle, reveal, keys and search", () => {
  const tree = createTreeStore()
  tree.apply(listed)
  const rowNames = () => names(tree.rows(1)).slice(0, 7)
  tree.toggle(-2)
  expect(rowNames()).toEqual([
    "0 App",
    "1 Row",
    "2 Row",
    "2 Row",
    "2 Row",
    "2 Row",
    "2 Row",
  ])
  expect(tree.rows(1)[1]?.expanded).toBe(true)
  tree.toggle(-2)
  expect(rowNames()[2]).toBe("1 Item")
  tree.reveal(4)
  expect(tree.selected()).toBe(4)
  expect(tree.rows(1)[1]?.expanded).toBe(true)
  tree.key(1, "ArrowLeft")
  expect(tree.selected()).toBe(-2)
  // A group row stays selected across batches while its first member lives.
  tree.apply(treeBatch(2, [{ op: "rename", id: 7, name: "Item" }]))
  expect(tree.selected()).toBe(-2)
  tree.key(1, "ArrowLeft")
  expect(tree.rows(1)[1]?.expanded).toBe(false)
  tree.key(1, "ArrowRight")
  expect(tree.rows(1)[1]?.expanded).toBe(true)
  tree.toggle(-2)
  tree.setQuery("Row")
  expect(tree.selected()).toBe(2)
  expect(tree.rows(1)[1]?.expanded).toBe(true)
})

test("a component's counts are read by id", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  tree.receiveCounts(countsMessage([{ id: 3, renders: 4, wasted: 1 }]))
  expect(tree.countOf(3)).toEqual({ id: 3, renders: 4, wasted: 1 })
  expect(tree.countOf(5)).toBeUndefined()
})

test("a node's parent is the node above it, none at a root", () => {
  const tree = createTreeStore()
  tree.apply(resync)
  expect(tree.parentOf(3)).toBe(2)
  expect(tree.parentOf(1)).toBeUndefined()
  expect(tree.parentOf(99)).toBeUndefined()
})

test("a component right under a Server Component is where client code starts", () => {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      add(1, 0, "Shop", 0, "server"),
      add(2, 1, "Suspense", 0, "suspense"),
      add(3, 2, "CartCount"),
      add(4, 1, "div", 1, "host"),
      add(5, 4, "AddToCart", 0, "lazy"),
      add(6, 5, "Inner"),
      add(7, 0, "App", 1),
    ]),
  )
  expect(tree.rows(1).map((row) => [row.name, row.client])).toEqual([
    ["Shop", false],
    ["Suspense", false],
    ["CartCount", true],
    ["AddToCart", true],
    ["Inner", false],
    ["App", false],
  ])
})

test("Next.js internals are hidden in a Next root until shown", () => {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      add(1, 0, "HeadManagerContext", 0, "provider"),
      add(2, 1, "AppRouter"),
      add(3, 2, "ErrorBoundary"),
      add(4, 3, "RootLayout", 0, "server"),
      add(5, 4, "SegmentStateProvider"),
      add(6, 5, "Context", 0, "provider"),
      add(7, 6, "Page", 0, "server"),
      add(8, 7, "Counter", 0, "lazy"),
      add(9, 0, "App", 0, "function", 2),
      add(10, 9, "ErrorBoundary", 0, "function", 2),
    ]),
  )
  const shown = (rootId: number) =>
    tree.rows(rootId).map((row) => `${row.depth} ${row.name}`)
  expect(shown(1)).toEqual(["0 RootLayout", "1 Page", "2 Counter"])
  expect(shown(2)).toEqual(["0 App", "1 ErrorBoundary"])
  expect(tree.hiddenCount()).toBe(5)
  tree.setQuery("AppRouter")
  expect(tree.matches()).toEqual([])

  tree.setShowInternals(true)
  expect(tree.showInternals()).toBe(true)
  expect(shown(1)).toHaveLength(8)
  expect(tree.matches()).toEqual([2])
  tree.select(3)
  tree.setShowInternals(false)
  expect(tree.selected()).toBeUndefined()

  tree.apply(treeBatch(2, [{ op: "remove", id: 3 }]))
  expect(tree.hiddenCount()).toBe(2)
})
