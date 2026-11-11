import React from "react"
import { expect, test } from "vitest"
import { installHook } from "../src/hook.ts"
import { fakeHook } from "./fake-hook.ts"
import { KEY, mount, windowLike } from "./window.ts"

test("a hook installed first keeps React, and we still see its commits", async () => {
  const native = Object.defineProperty
  const fake = fakeHook()
  Object.defineProperty(windowLike(), KEY, { value: fake, configurable: true })
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
