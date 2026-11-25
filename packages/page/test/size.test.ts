import { expect, test, vi } from "vitest"
import { MAX_SIZE, sizeOf } from "../src/size.ts"

test("a value's size is its JSON length", () => {
  const value = {
    id: "p-12",
    n: 1.5,
    ok: true,
    nil: null,
    list: [1, "a", null, undefined, () => 1],
    fn() {},
    u: undefined,
    s: 'q"uote\n',
    when: new Date(0),
    nested: { deep: [{}, []] },
  }
  expect(sizeOf(value)).toEqual({ bytes: JSON.stringify(value).length })
})

test("getters aren't called", () => {
  const read = vi.fn(() => "x")
  const value = { a: 1 }
  Object.defineProperty(value, "b", { get: read, enumerable: true })
  expect(sizeOf(value)).toEqual({ bytes: JSON.stringify({ a: 1 }).length })
  expect(read).not.toHaveBeenCalled()
})

test("a cycle, a huge string, deep nesting or many values stop as over", () => {
  const cycle: Record<string, unknown> = { a: 1 }
  cycle.self = cycle
  expect(sizeOf(cycle).over).toBe(true)

  const huge = sizeOf("x".repeat(2 * 1024 * 1024))
  expect(huge.over).toBe(true)
  expect(huge.bytes).toBeLessThanOrEqual(MAX_SIZE)

  let deep: unknown = 1
  for (let i = 0; i < 40; i++) deep = [deep]
  expect(sizeOf(deep).over).toBe(true)

  const start = performance.now()
  const many = sizeOf(Array.from({ length: 200_000 }, (_, i) => i))
  expect(many.over).toBe(true)
  expect(performance.now() - start).toBeLessThan(100)
})
