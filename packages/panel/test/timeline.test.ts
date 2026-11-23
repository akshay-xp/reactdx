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

test("commits append, the oldest dropping past 100; Live stays live", () => {
  const { timeline } = setup()
  timeline.receiveCommits([summary(1), summary(2)])
  expect(timeline.commits().map((c) => c.seq)).toEqual([1, 2])
  timeline.receiveCommits(Array.from({ length: 100 }, (_, i) => summary(i + 3)))
  expect(timeline.commits()).toHaveLength(100)
  expect(timeline.commits()[0]?.seq).toBe(3)
  expect(timeline.picked()).toBeUndefined()
  timeline.reset()
  expect(timeline.commits()).toEqual([])
})

test("picking a commit asks for its ids, marks them and pins the inspector", () => {
  const { sent, pins, timeline } = setup()
  timeline.receiveCommits([summary(4), summary(5)])
  timeline.pick(5)
  expect(sent).toEqual([{ type: "commit", seq: 5 }])
  expect(pins).toEqual([5])
  timeline.receiveCommitted(committed(5, [1, 2]))
  timeline.receiveCommitted(committed(5, [3]))
  timeline.receiveCommitted(committed(4, [9]))
  expect([...timeline.marks()]).toEqual([1, 2, 3])
  timeline.receiveCommits([summary(6)])
  expect(timeline.picked()).toBe(5)
  timeline.pick(4)
  expect(timeline.marks().size).toBe(0)
  timeline.receiveCommitted(committed(4, null))
  expect(timeline.marks().size).toBe(0)
})

test("Left from Live picks the newest; Right past it, End and Escape go Live", () => {
  const { pins, timeline } = setup()
  timeline.receiveCommits([summary(1), summary(2), summary(3)])
  expect(timeline.key("ArrowLeft")).toBe(true)
  expect(timeline.picked()).toBe(3)
  timeline.key("ArrowLeft")
  expect(timeline.picked()).toBe(2)
  timeline.key("ArrowRight")
  timeline.key("ArrowRight")
  expect(timeline.picked()).toBeUndefined()
  for (const key of ["End", "Escape"]) {
    timeline.pick(1)
    expect(timeline.key(key)).toBe(true)
    expect(timeline.picked()).toBeUndefined()
    expect(timeline.marks().size).toBe(0)
    expect(pins.at(-1)).toBeUndefined()
  }
  expect(timeline.key("a")).toBe(false)
})
