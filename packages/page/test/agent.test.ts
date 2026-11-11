import { snapshotMessage } from "@reactdx/messages"
import React from "react"
import { expect, test, vi } from "vitest"
import { startAgent } from "../src/agent.ts"
import { installHook } from "../src/hook.ts"
import { mount, windowLike } from "./window.ts"

const render = (root: { render(node: unknown): void }, text: string) =>
  React.act(() => {
    root.render(React.createElement("p", null, text))
  })

test("the agent reports roots and commit counts, at most every 100 ms", async () => {
  installHook(windowLike())
  const { root } = await mount()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  try {
    const post = vi.fn()
    startAgent(globalThis, post)
    // A root that committed before the agent arrived is reported at once.
    expect(post).toHaveBeenCalledExactlyOnceWith(
      snapshotMessage([{ rendererId: 1, id: 1, commits: 0 }]),
    )
    startAgent(globalThis, post)

    await render(root, "a")
    await render(root, "b")
    expect(post).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenLastCalledWith(
      snapshotMessage([{ rendererId: 1, id: 1, commits: 2 }]),
    )

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "reactdx-relay", type: "get-snapshot" },
      }),
    )
    expect(post).toHaveBeenCalledTimes(3)

    await React.act(() => root.unmount())
    vi.advanceTimersByTime(100)
    expect(post).toHaveBeenCalledTimes(4)
    expect(post).toHaveBeenLastCalledWith(snapshotMessage([]))
  } finally {
    vi.useRealTimers()
  }
})
