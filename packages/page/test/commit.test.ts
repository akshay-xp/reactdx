import React from "react"
import { expect, test } from "vitest"
import { installHook } from "../src/hook.ts"
import { KEY, mount, windowLike } from "./window.ts"

test("runs on the React version of its project", () => {
  expect(React.version.startsWith(String(process.env.REACT_VERSION))).toBe(true)
})

test("React commits through our prototype hook, and the record tracks it", async () => {
  const native = Object.defineProperty
  const record = installHook(windowLike())
  expect(Object.hasOwn(globalThis, KEY)).toBe(false)
  const calls: [number, { current: { tag: number } }][] = []
  record.listeners.add((id, root) => calls.push([id, root]))

  const { div, root } = await mount()

  expect(div.textContent).toBe("hi")
  expect(record.renderers.get(1)).toEqual({
    version: React.version,
    bundleType: 1,
    rendererPackageName: "react-dom",
  })
  expect(calls[0]?.[0]).toBe(1)
  expect(calls[0]?.[1].current.tag).toBe(3) // HostRoot
  expect(record.roots.get(1)?.size).toBe(1)
  expect(Object.defineProperty).toBe(native)
  expect((globalThis as Record<symbol, unknown>)[Symbol.for("reactdx")]).toBe(
    record,
  )
  expect(Object.keys(globalThis)).not.toContain(Symbol.for("reactdx"))

  await React.act(() => root.unmount())
  expect(record.roots.get(1)?.size).toBe(0)
})
