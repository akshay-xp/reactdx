import { expect, test } from "vitest"
import { parseTreeBatch, type TreeOp, treeBatch } from "../src/index"

const ops: TreeOp[] = [
  { op: "reset" },
  {
    op: "add",
    id: 1,
    parentId: 0,
    rootId: 1,
    kind: "function",
    name: "App",
    key: null,
    index: 0,
  },
  {
    op: "add",
    id: 2,
    parentId: 1,
    rootId: 1,
    kind: "host",
    name: "div",
    key: "a",
    index: 0,
  },
  { op: "remove", id: 2 },
  { op: "reorder", rootId: 1, parentId: 0, children: [1] },
  { op: "rename", id: 1, name: "Main" },
]

test("a tree batch round-trips as a new object", () => {
  const batch = treeBatch(1, ops)
  expect(batch).toEqual({ source: "reactdx", type: "tree", seq: 1, ops })
  const parsed = parseTreeBatch(batch)
  expect(parsed).toEqual(batch)
  expect(parsed).not.toBe(batch)
})

test("extra keys on the batch and its ops are dropped", () => {
  const batch = treeBatch(
    1,
    ops.map((op) => ({ ...op, extra: 1 })),
  )
  expect(parseTreeBatch({ ...batch, extra: "x" })).toEqual(treeBatch(1, ops))
})

const add = ops[1] as Extract<TreeOp, { op: "add" }>
const batchWith = (op: unknown) => ({ ...treeBatch(1, []), ops: [op] })

test.each<[string, unknown]>([
  ["null", null],
  ["a string", "tree"],
  ["another source", { ...treeBatch(1, ops), source: "other" }],
  ["another type", { ...treeBatch(1, ops), type: "snapshot" }],
  ["seq 0", treeBatch(0, ops)],
  ["seq 1.5", treeBatch(1.5, ops)],
  ["seq as a string", { ...treeBatch(1, ops), seq: "1" }],
  ["ops not an array", { ...treeBatch(1, ops), ops: {} }],
  ["no ops", treeBatch(1, [])],
  ["2,001 ops", treeBatch(1, Array(2001).fill({ op: "reset" }))],
  ["an op that isn't an object", batchWith(null)],
  ["an unknown op", batchWith({ op: "move", id: 1 })],
  ["add id 0", batchWith({ ...add, id: 0 })],
  ["add parentId -1", batchWith({ ...add, parentId: -1 })],
  ["add rootId 0", batchWith({ ...add, rootId: 0 })],
  ["add index -1", batchWith({ ...add, index: -1 })],
  ["add index 1.5", batchWith({ ...add, index: 1.5 })],
  ["add kind fragment", batchWith({ ...add, kind: "fragment" })],
  ["add name of 257 chars", batchWith({ ...add, name: "a".repeat(257) })],
  ["add name not a string", batchWith({ ...add, name: 1 })],
  ["add key of 257 chars", batchWith({ ...add, key: "a".repeat(257) })],
  ["add key 5", batchWith({ ...add, key: 5 })],
  ["remove id 0", batchWith({ op: "remove", id: 0 })],
  [
    "reorder children not an array",
    batchWith({ op: "reorder", rootId: 1, parentId: 0, children: 1 }),
  ],
  [
    "reorder of 10,001 ids",
    batchWith({
      op: "reorder",
      rootId: 1,
      parentId: 0,
      children: Array(10001).fill(1),
    }),
  ],
  [
    "reorder child id 0",
    batchWith({ op: "reorder", rootId: 1, parentId: 0, children: [0] }),
  ],
  [
    "reorder rootId 0",
    batchWith({ op: "reorder", rootId: 0, parentId: 0, children: [1] }),
  ],
  [
    "rename name of 257 chars",
    batchWith({ op: "rename", id: 1, name: "a".repeat(257) }),
  ],
])("drops %s", (_, data) => {
  expect(parseTreeBatch(data)).toBeUndefined()
})

test("names and keys of 256 chars and 2,000 ops pass", () => {
  const long = { ...add, name: "a".repeat(256), key: "k".repeat(256) }
  const batch = treeBatch(1, Array(2000).fill(long))
  expect(parseTreeBatch(batch)).toEqual(batch)
})
