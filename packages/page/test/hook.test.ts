import { expect, test } from "vitest"
import { installHook } from "../src/hook.ts"

test("installs a hook React accepts", () => {
  const target: { __REACT_DEVTOOLS_GLOBAL_HOOK__?: any } = {}
  installHook(target)
  const hook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__
  expect(hook.supportsFiber).toBe(true)
  for (const name of [
    "checkDCE",
    "onCommitFiberRoot",
    "onCommitFiberUnmount",
    "onPostCommitFiberRoot",
  ]) {
    expect(typeof hook[name], name).toBe("function")
  }
  const rendererA = {}
  const rendererB = {}
  expect(hook.inject(rendererA)).toBe(1)
  expect(hook.inject(rendererB)).toBe(2)
  expect(hook.renderers.get(1)).toBe(rendererA)
})
