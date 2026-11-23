import { type CommitSummary, treeBatch } from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { CommitStrip } from "../src/CommitStrip"
import { createTimelineStore, type TimelineCommand } from "../src/timeline"
import { createTreeStore } from "../src/tree"

const summary = (seq: number, updaters: number[] = []): CommitSummary => ({
  seq,
  time: seq,
  rootId: 1,
  updaters,
  renders: seq,
})

const setup = () => {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      {
        op: "add",
        id: 3,
        parentId: 0,
        rootId: 1,
        kind: "function",
        name: "Counter",
        key: null,
        index: 0,
      },
    ]),
  )
  const sent: TimelineCommand[] = []
  const timeline = createTimelineStore((c) => sent.push(c), { pin() {} })
  timeline.receiveCommits([summary(4), summary(5, [3]), summary(6)])
  const view = render(() => <CommitStrip timeline={timeline} tree={tree} />)
  const strip = () => view.getByRole("listbox", { name: "Commits" })
  const options = () => view.getAllByRole("option")
  const info = () =>
    view.container.querySelector("[data-testid=commit-info]")?.textContent
  return { timeline, sent, strip, options, info, ...view }
}

test("a bar per commit, then Live, selected while following", () => {
  const { options, info, strip } = setup()
  expect(options().map((o) => o.getAttribute("aria-label"))).toEqual([
    "Commit 4: 4 rendered",
    "Commit 5: 5 rendered",
    "Commit 6: 6 rendered",
    "Live",
  ])
  expect(options()[3]?.getAttribute("aria-selected")).toBe("true")
  expect(strip().getAttribute("aria-activedescendant")).toBe(options()[3]?.id)
  expect(info()).toBe("Live")
  // One tab stop: the strip.
  expect(strip().tabIndex).toBe(0)
  expect(options().every((o) => o.tabIndex === -1)).toBe(true)
})

test("a click picks a bar; the info line names its trigger", () => {
  const { options, info, sent, timeline } = setup()
  fireEvent.click(options()[1] as Element)
  expect(timeline.picked()).toBe(5)
  expect(sent).toEqual([{ type: "commit", seq: 5 }])
  expect(options()[1]?.getAttribute("aria-selected")).toBe("true")
  expect(info()).toBe("Commit 5: 5 rendered. Triggered by Counter")
  fireEvent.click(options()[0] as Element)
  expect(info()).toBe("Commit 4: 4 rendered. Triggered by: unknown")
})

test("keys on the strip go to the store and are handled there", () => {
  const { strip, timeline } = setup()
  const left = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    bubbles: true,
    cancelable: true,
  })
  strip().dispatchEvent(left)
  expect(left.defaultPrevented).toBe(true)
  expect(timeline.picked()).toBe(6)
  let escaped = false
  window.addEventListener("keydown", () => (escaped = true), { once: true })
  fireEvent.keyDown(strip(), { key: "Escape" })
  expect(timeline.picked()).toBeUndefined()
  expect(escaped).toBe(false)
  fireEvent.keyDown(strip(), { key: "ArrowLeft" })
  fireEvent.keyDown(strip(), { key: "End" })
  expect(timeline.picked()).toBeUndefined()
})
