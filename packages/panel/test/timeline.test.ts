import { type CommitSummary, committed } from "@reactdx/messages"
import { expect, test } from "vitest"
import { createTimelineStore, type TimelineCommand } from "../src/timeline"

const summary = (seq: number): CommitSummary => ({
  seq,
  time: seq,
  rootId: 1,
  updaters: [],
  renders: 1,
})

const setup = () => {
  const sent: TimelineCommand[] = []
  const pins: (number | undefined)[] = []
  const timeline = createTimelineStore((command) => sent.push(command), {
    pin: (seq) => pins.push(seq),
  })
  return { sent, pins, timeline }
}

test("commits are kept oldest first and shown newest first, at most 100", () => {
  const { timeline } = setup()
  timeline.receiveCommits([summary(1), summary(2)])
  expect(timeline.shown([]).map((c) => c.seq)).toEqual([2, 1])
  timeline.receiveCommits(Array.from({ length: 100 }, (_, i) => summary(i + 3)))
  expect(timeline.shown([])).toHaveLength(100)
  expect(timeline.shown([]).at(-1)?.seq).toBe(3)
  expect(timeline.picked()).toBeUndefined()
  timeline.reset()
  expect(timeline.shown([])).toEqual([])
})

test("picking a commit asks for it, pins the inspector and keeps its detail", () => {
  const { sent, pins, timeline } = setup()
  timeline.receiveCommits([summary(4), summary(5)])
  timeline.pick(5)
  expect(sent).toEqual([{ type: "commit", seq: 5 }])
  expect(pins).toEqual([5])
  expect(timeline.detail()).toBeUndefined()
  const updaters = [{ id: 1, hooks: [] }]
  timeline.receiveCommitted(
    committed(5, [{ id: 1, kinds: ["state"] }], updaters),
  )
  timeline.receiveCommitted(committed(5, [{ id: 2, kinds: ["parent"] }]))
  timeline.receiveCommitted(committed(4, [{ id: 9, kinds: ["mount"] }], []))
  expect(timeline.detail()).toEqual({
    renders: [
      { id: 1, kinds: ["state"] },
      { id: 2, kinds: ["parent"] },
    ],
    updaters,
  })
  timeline.receiveCommits([summary(6)])
  expect(timeline.picked()).toBe(5)
  timeline.pick(4)
  expect(timeline.detail()).toBeUndefined()
  timeline.receiveCommitted(committed(4, null))
  expect(timeline.detail()).toBeNull()
})

test("filtered, only the commits in the given history show", () => {
  const { timeline } = setup()
  timeline.receiveCommits([summary(1), summary(2), summary(3)])
  timeline.setFiltered(true)
  expect(timeline.filtered()).toBe(true)
  expect(timeline.shown([2]).map((c) => c.seq)).toEqual([2])
  timeline.setFiltered(false)
  expect(timeline.shown([2]).map((c) => c.seq)).toEqual([3, 2, 1])
})

test("Down steps to older commits, Up to newer; Home, End; Escape unpicks", () => {
  const { pins, timeline } = setup()
  timeline.receiveCommits([summary(1), summary(2), summary(3)])
  expect(timeline.key("ArrowDown", [])).toBe(true)
  expect(timeline.picked()).toBe(3)
  timeline.key("ArrowDown", [])
  expect(timeline.picked()).toBe(2)
  timeline.key("ArrowUp", [])
  expect(timeline.picked()).toBe(3)
  timeline.key("ArrowUp", [])
  expect(timeline.picked()).toBe(3)
  timeline.key("End", [])
  expect(timeline.picked()).toBe(1)
  timeline.key("Home", [])
  expect(timeline.picked()).toBe(3)
  timeline.setFiltered(true)
  timeline.key("End", [2])
  expect(timeline.picked()).toBe(2)
  expect(timeline.key("Escape", [2])).toBe(true)
  expect(timeline.picked()).toBeUndefined()
  expect(timeline.detail()).toBeUndefined()
  expect(pins.at(-1)).toBeUndefined()
  expect(timeline.key("a", [])).toBe(false)
})
