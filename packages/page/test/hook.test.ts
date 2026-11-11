import { expect, test, vi } from "vitest"
import { type Hook, installHook } from "../src/hook.ts"

test("installs a hook React accepts", () => {
  const target: { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook } = Object.create(
    Object.create(null),
  )
  installHook(target)
  const hook = target.__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (!hook) throw new Error("no hook")
  expect(hook.supportsFiber).toBe(true)
  for (const name of [
    "checkDCE",
    "onCommitFiberRoot",
    "onCommitFiberUnmount",
    "onPostCommitFiberRoot",
  ] as const) {
    expect(typeof hook[name], name).toBe("function")
  }
  const rendererA = {}
  const rendererB = {}
  expect(hook.inject(rendererA)).toBe(1)
  expect(hook.inject(rendererB)).toBe(2)
  expect(hook.renderers.get(1)).toBe(rendererA)
})

test("reports each renderer as it injects", () => {
  const target: { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook } = Object.create(
    Object.create(null),
  )
  const onRenderer = vi.fn()
  installHook(target, onRenderer)
  target.__REACT_DEVTOOLS_GLOBAL_HOOK__?.inject({
    version: "19.3.1",
    bundleType: 1,
    rendererPackageName: "react-dom",
    extra: "dropped",
  })
  expect(onRenderer).toHaveBeenCalledTimes(1)
  expect(onRenderer).toHaveBeenCalledWith(1, {
    version: "19.3.1",
    bundleType: 1,
    rendererPackageName: "react-dom",
  })
})
