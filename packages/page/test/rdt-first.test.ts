import React from "react"
import { expect, test, vi } from "vitest"
import { installHook } from "../src/hook.ts"
import { fakeHook } from "./fake-hook.ts"
import { KEY, mount, windowLike } from "./window.ts"

test("a hook installed first keeps React, and we still see its commits", async () => {
  const native = Object.defineProperty
  const fake = fakeHook()
  // As RDT 8 defines it: a getter, not a value.
  Object.defineProperty(windowLike(), KEY, {
    configurable: false,
    enumerable: false,
    get: () => fake,
  })
  const record = installHook(globalThis)
  expect(Object.defineProperty).toBe(native)
  const seen: number[] = []
  record.listeners.add(() => seen.push(fake.calls.length))

  await mount()

  expect(fake.renderers.size).toBe(1)
  expect(fake.calls.length).toBeGreaterThanOrEqual(1)
  expect(seen[0]).toBeGreaterThanOrEqual(1)
  expect(record.renderers.get(1)?.version).toBe(React.version)
})

test("renderers already on a hook installed first are reported on install", () => {
  const fake = fakeHook()
  fake.inject({
    version: "18.3.1",
    bundleType: 1,
    rendererPackageName: "react-dom",
  })
  const target = Object.create(Object.create(null))
  Object.defineProperty(target, KEY, { configurable: false, get: () => fake })
  const onRenderer = vi.fn()
  installHook(target, onRenderer)
  expect(onRenderer).toHaveBeenCalledExactlyOnceWith(1, {
    version: "18.3.1",
    bundleType: 1,
    rendererPackageName: "react-dom",
  })
})
