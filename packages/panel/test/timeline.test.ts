import {
  type CommitSummary,
  commitsMessage,
  committed,
} from "@reactdx/messages"
import { expect, test } from "vitest"
import { createTimelineStore, type TimelineCommand } from "../src/timeline"

const summary = (seq: number): CommitSummary => ({
  seq,
  time: seq,
  rootId: 1,
  updaters: [],
  renders: 1,
  wasted: 0,
})

// The page holds everything from `oldest` on.
const holding = (list: CommitSummary[], oldest = 1, dropped = false) =>
  commitsMessage(list, oldest, dropped)

const setup = () => {
  const sent: TimelineCommand[] = []
  const pins: (number | undefined)[] = []
  const timeline = createTimelineStore((command) => sent.push(command), {
    pin: (seq) => pins.push(seq),
  })
  return { sent, pins, timeline }
}

test("commits are kept oldest first and shown newest first, as many as the page holds", () => {
  const { timeline } = setup()
  timeline.receiveCommits(holding([summary(1), summary(2)]))
  expect(timeline.shown([]).map((c) => c.seq)).toEqual([2, 1])
  for (let at = 3; at < 153; at += 50)
    timeline.receiveCommits(
      holding(Array.from({ length: 50 }, (_, i) => summary(at + i))),
    )
  expect(timeline.shown([])).toHaveLength(152)
  expect(timeline.picked()).toBeUndefined()
  timeline.clear()
  expect(timeline.shown([])).toEqual([])
})

test("a re-watch keeps a pick the page still has; a navigation drops it", () => {
  const { pins, timeline } = setup()
  timeline.receiveCommits(holding([summary(4), summary(5)]))
  timeline.pick(5)
  timeline.receiveCommitted(committed(5, [{ id: 1, kinds: ["state"] }], []))
  const detail = timeline.detail()
  timeline.reset()
  expect(timeline.shown([])).toEqual([])
  expect(timeline.picked()).toBe(5)
  expect(timeline.detail()).toBe(detail)
  expect(pins).toEqual([5])
  timeline.receiveCommits(holding([summary(4), summary(5)]))
  expect(timeline.picked()).toBe(5)
  timeline.receiveCommits(holding([summary(6)]))
  expect(timeline.picked()).toBe(5)
  // Released while the panel was away.
  timeline.reset()
  timeline.receiveCommits(holding([summary(6)], 6))
  expect(timeline.picked()).toBeUndefined()
  expect(timeline.detail()).toBeUndefined()
  expect(pins.at(-1)).toBeUndefined()
  timeline.pick(6)
  timeline.clear()
  expect(timeline.shown([])).toEqual([])
  expect(timeline.picked()).toBeUndefined()
  expect(pins.at(-1)).toBeUndefined()
})

test("commits the page dropped leave the list, and a pick among them unpicks", () => {
  const { timeline } = setup()
  timeline.receiveCommits(holding([summary(1), summary(2), summary(3)]))
  expect(timeline.dropped()).toBe(false)
  timeline.pick(2)
  timeline.receiveCommits(holding([summary(4)], 3, true))
  expect(timeline.shown([]).map((c) => c.seq)).toEqual([4, 3])
  expect(timeline.dropped()).toBe(true)
  expect(timeline.picked()).toBeUndefined()
  timeline.reset()
  expect(timeline.dropped()).toBe(false)
  timeline.receiveCommits(holding([summary(4)], 3, true))
  timeline.clear()
  expect(timeline.dropped()).toBe(false)
})

test("picking a commit asks for it, pins the inspector and keeps its detail", () => {
  const { sent, pins, timeline } = setup()
  timeline.receiveCommits(holding([summary(4), summary(5)]))
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
  timeline.receiveCommits(holding([summary(6)]))
  expect(timeline.picked()).toBe(5)
  timeline.pick(4)
  expect(timeline.detail()).toBeUndefined()
  timeline.receiveCommitted(committed(4, null))
  expect(timeline.detail()).toBeNull()
})

test("filtered, only the commits in the given history show", () => {
  const { timeline } = setup()
  timeline.receiveCommits(holding([summary(1), summary(2), summary(3)]))
  timeline.setFiltered(true)
  expect(timeline.filtered()).toBe(true)
  expect(timeline.shown([2]).map((c) => c.seq)).toEqual([2])
  timeline.setFiltered(false)
  expect(timeline.shown([2]).map((c) => c.seq)).toEqual([3, 2, 1])
})

test("Down steps to older commits, Up to newer; Home, End; Escape unpicks", () => {
  const { pins, timeline } = setup()
  timeline.receiveCommits(holding([summary(1), summary(2), summary(3)]))
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
