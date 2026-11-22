import { expect, test } from "vitest"
import { childPath, pathKey, type RowPath } from "../src/paths"

test("pathKey tells paths apart only when they differ", () => {
  const key = (path: RowPath) => pathKey(path)
  expect(key({ root: "props", keys: ["a.b"] })).not.toBe(
    key({ root: "props", keys: ["a", "b"] }),
  )
  const roots = [
    key({ root: { hook: [1, 0] }, keys: [] }),
    key({ root: { hook: [10] }, keys: [] }),
    key({ root: "state", keys: [] }),
    key({ root: { context: 1 }, keys: [] }),
  ]
  expect(new Set(roots).size).toBe(4)
  // A string key isn't an index.
  expect(key({ root: "props", keys: ["0"] })).not.toBe(
    key({ root: "props", keys: [0] }),
  )
  expect(key({ root: { hook: [1, 0] }, keys: ["a", 2] })).toBe(
    key({ root: { hook: [1, 0] }, keys: ["a", 2] }),
  )
})

test("childPath appends a key without changing its parent", () => {
  const parent: RowPath = { root: "props", keys: ["a"] }
  expect(childPath(parent, 2)).toEqual({ root: "props", keys: ["a", 2] })
  expect(parent).toEqual({ root: "props", keys: ["a"] })
})
