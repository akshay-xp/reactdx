import { expect, test } from "vitest"
import { installHook } from "../src/hook.ts"
import { fakeHook } from "./fake-hook.ts"
import { KEY, mount, windowLike } from "./window.ts"

test("a hook set by plain assignment after ours gets React, and we still get commits", async () => {
  const record = installHook(windowLike())
  const fake = fakeHook()
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = fake
  expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(fake)
  expect(Object.hasOwn(globalThis, KEY)).toBe(true)
  let commits = 0
  record.listeners.add(() => commits++)

  await mount()

  expect(fake.renderers.size).toBe(1)
  expect(commits).toBeGreaterThanOrEqual(1)
})
