import { expect, test } from "vitest"
import { installHook } from "../src/hook.ts"
import { fakeHook } from "./fake-hook.ts"
import { KEY, mount, windowLike } from "./window.ts"

test("a hook defined after ours gets React, we still get commits, defineProperty is restored", async () => {
  const native = Object.defineProperty
  const record = installHook(windowLike())
  const fake = fakeHook()
  Object.defineProperty(globalThis, KEY, { value: fake, configurable: true })
  expect(Object.defineProperty).not.toBe(native)
  let commits = 0
  record.listeners.add(() => commits++)

  await mount()

  expect(fake.renderers.size).toBe(1)
  expect(commits).toBeGreaterThanOrEqual(1)
  expect(record.renderers.size).toBe(1)
  expect(Object.defineProperty).toBe(native)
})
