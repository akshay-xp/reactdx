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
