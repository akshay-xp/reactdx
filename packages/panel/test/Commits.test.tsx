import {
  type CommitSummary,
  commitsMessage,
  committed,
  inspected,
  treeBatch,
  type Value,
} from "@reactdx/messages"
import { fireEvent, render, screen } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { Commits } from "../src/Commits"
import { createInspectorStore } from "../src/inspection"
import { createTimelineStore, type TimelineCommand } from "../src/timeline"
import { createTreeStore } from "../src/tree"

const NOW = 100_000

const summary = (
  seq: number,
  ago: number,
  renders: number,
  updaters: number[] = [],
  wasted = 0,
): CommitSummary => ({
  seq,
  time: NOW - ago,
  rootId: 1,
  updaters,
  renders,
  wasted,
})

const add = (id: number, name: string) => ({
  op: "add" as const,
  id,
  parentId: id === 1 ? 0 : 1,
  rootId: 1,
  kind: "function" as const,
  name,
  key: null,
  index: 0,
})

function setup() {
  const tree = createTreeStore()
  tree.apply(
    treeBatch(1, [
      { op: "reset" },
      add(1, "App"),
      add(2, "Counter"),
      add(3, "Shown"),
    ]),
  )
  const sent: TimelineCommand[] = []
  const inspector = createInspectorStore(
    () => {},
    () => {},
  )
  const timeline = createTimelineStore((c) => sent.push(c), inspector)
  const revealed: number[] = []
  const view = render(() => (
    <Commits
      timeline={timeline}
      tree={tree}
      inspector={inspector}
      now={() => NOW}
      onReveal={(id) => revealed.push(id)}
    />
  ))
  // Each row's lines, joined by " / ".
  const rows = () =>
    [...view.container.querySelectorAll("[role=option]")].map((row) =>
      [...row.querySelectorAll("[data-testid=line]")]
        .map((line) => line.textContent)
        .join(" / "),
    )
  const seqs = () =>
    [...view.container.querySelectorAll("[role=option]")].map(
      (row) => (row as HTMLElement).dataset.seq,
    )
  return { tree, inspector, timeline, sent, revealed, rows, seqs, ...view }
}

test("rows lead with the cause, then what it cost and when; a burst folds into one", () => {
  const { timeline, rows, container } = setup()
  const change = (old: number) => ({ hook: 0, old, new: old + 1 })
  timeline.receiveCommits(
    commitsMessage(
      [
        summary(1, 2 * 3600_000, 1),
        { ...summary(2, 90_000, 3, [2], 2), change: change(2) },
        summary(3, 2000, 3, [2, 3, 1]),
      ],
      1,
      false,
    ),
  )
  expect(rows()).toEqual([
    "Counter +2 / 3 renders · 2s ago",
    "Counter: 2 → 3 / 3 renders · 2 wasted · 1m ago",
    "Root render / 1 render · 2h ago",
  ])
  timeline.receiveCommits(
    commitsMessage(
      [4, 5, 6].map((seq) => ({
        ...summary(seq, 2000, 3, [3], 2),
        change: change(seq),
      })),
      1,
      false,
    ),
  )
  expect(rows()[0]).toBe("Shown · 3 updates / 6 wasted · 2s ago")
  timeline.pick(5)
  expect(rows().slice(0, 4)).toEqual([
    "Shown · 3 updates / 6 wasted · 2s ago",
    "6 → 7 / 3 renders · 2 wasted · 2s ago",
    "5 → 6 / 3 renders · 2 wasted · 2s ago",
    "4 → 5 / 3 renders · 2 wasted · 2s ago",
  ])
  for (const row of rows()) expect(row).not.toMatch(/commit|#/i)
  expect(
    container.querySelector("[role=listbox]")?.getAttribute("aria-label"),
  ).toBe("Updates")
  const group = container.querySelector("#group-4") as HTMLElement
  expect(group.dataset.open).toBe("true")
  fireEvent.click(group)
  expect(rows()).toHaveLength(4)
})

test("a click or a key picks a commit; Escape stays in the panel", () => {
  const { timeline, sent } = setup()
  timeline.receiveCommits(
    commitsMessage([summary(1, 0, 1), summary(2, 0, 1)], 1, false),
  )
  const list = screen.getByRole("listbox", { name: "Updates" })
  const option = (seq: number) =>
    document.getElementById(`update-${seq}`) as HTMLElement
  fireEvent.click(option(1))
  expect(sent).toEqual([{ type: "commit", seq: 1 }])
  expect(list.getAttribute("aria-activedescendant")).toBe("update-1")
  expect(option(1).ariaSelected).toBe("true")
  fireEvent.keyDown(list, { key: "Home" })
  expect(timeline.picked()).toBe(2)
  let escaped = false
  const onKey = () => {
    escaped = true
  }
  window.addEventListener("keydown", onKey)
  fireEvent.keyDown(list, { key: "Escape" })
  window.removeEventListener("keydown", onKey)
  expect(escaped).toBe(false)
  expect(timeline.picked()).toBeUndefined()
})

test("the list ends with a note once the page's limit dropped older commits", () => {
  const { timeline } = setup()
  timeline.receiveCommits(commitsMessage([summary(1, 0, 1)], 1, false))
  expect(screen.queryByText(/Older updates dropped/)).toBeNull()
  timeline.receiveCommits(commitsMessage([summary(2, 0, 1)], 2, true))
  const note = screen.getByText("Older updates dropped (limit reached)")
  const list = screen.getByRole("listbox")
  expect(
    list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

test("Only <selected> limits the list to the selected node's renders", () => {
  const { tree, inspector, timeline, seqs } = setup()
  timeline.receiveCommits(
    commitsMessage(
      [summary(1, 0, 1), summary(2, 0, 1), summary(3, 0, 1)],
      1,
      false,
    ),
  )
  const only = () => screen.getByRole("button", { name: /^Only/ })
  expect(only().hasAttribute("disabled")).toBe(true)
  tree.select(2)
  inspector.inspect(2)
  const props: Value = {
    type: "object",
    className: "Object",
    id: 1,
    size: 0,
    props: {},
  }
  inspector.receive(inspected(2, { props, history: [1, 3] }))
  expect(only().textContent).toBe("Only Counter")
  fireEvent.click(only())
  expect(only().getAttribute("aria-pressed")).toBe("true")
  expect(seqs()).toEqual(["3", "1"])
})

test("the detail says the cause and the cost; renders with no reason hide behind one line", () => {
  const { timeline, revealed, container } = setup()
  const text = (testid: string) =>
    [...container.querySelectorAll(`[data-testid=${testid}]`)].map(
      (line) => line.textContent,
    )
  timeline.receiveCommits(
    commitsMessage([summary(1, 0, 4, [2], 3), summary(2, 0, 1)], 1, false),
  )
  timeline.pick(1)
  timeline.receiveCommitted(
    committed(
      1,
      [
        { id: 1, kinds: ["parent"] },
        { id: 2, kinds: ["state"] },
        { id: 3, kinds: ["parent"] },
        { id: 7, kinds: ["parent"] },
      ],
      [{ id: 2, hooks: [{ name: "State #1", old: 3, new: 4 }] }],
    ),
  )
  expect(text("commit-trigger")).toEqual(["Counter set State #1: 3 → 4"])
  expect(text("commit-cost")).toEqual([
    "4 components rendered · 1 had a reason, 3 only because a parent rendered",
  ])
  expect(text("commit-render")).toEqual(["Counter State changed"])
  expect(text("commit-hidden")).toEqual(["3 wasted, hidden"])
  // The cause's name, then the render's.
  for (const link of screen.getAllByRole("button", { name: "Counter" }))
    fireEvent.click(link)
  expect(revealed).toEqual([2, 2])
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Hide renders with no reason" }),
  )
  expect(text("commit-render")).toHaveLength(4)
  expect(text("commit-hidden")).toEqual([])
  timeline.pick(2)
  timeline.receiveCommitted(committed(2, [{ id: 1, kinds: ["mount"] }], []))
  expect(text("commit-trigger")).toEqual(["Root render"])
})

test("the toolbar filters to updates with wasted renders, and clears", () => {
  const { timeline, seqs, sent, container } = setup()
  timeline.receiveCommits(
    commitsMessage(
      [summary(1, 0, 3, [2], 2), summary(2, 0, 1, [3]), summary(3, 0, 1)],
      1,
      false,
    ),
  )
  const button = (name: string) => screen.getByRole("button", { name })
  expect(button("All").getAttribute("aria-pressed")).toBe("true")
  fireEvent.click(button("With wasted renders"))
  expect(button("With wasted renders").getAttribute("aria-pressed")).toBe(
    "true",
  )
  expect(button("All").getAttribute("aria-pressed")).toBe("false")
  expect(seqs()).toEqual(["1"])
  fireEvent.click(button("All"))
  expect(button("With wasted renders").getAttribute("aria-pressed")).toBe(
    "false",
  )
  expect(seqs()).toEqual(["3", "2", "1"])
  fireEvent.click(button("Clear"))
  expect(sent.at(-1)).toEqual({ type: "clear-updates" })
  expect(container.textContent).toContain("No updates since DevTools opened.")
})

test("what rendered nests under what rendered above it; repeated siblings fold", () => {
  const { tree, timeline, container } = setup()
  tree.apply(
    treeBatch(2, [
      { ...add(10, "List"), parentId: 1 },
      ...[11, 12, 13, 14].map((id, index) => ({
        ...add(id, "Row"),
        parentId: 10,
        index,
      })),
    ]),
  )
  timeline.receiveCommits(commitsMessage([summary(1, 0, 6, [1])], 1, false))
  timeline.pick(1)
  timeline.receiveCommitted(
    committed(
      1,
      [
        { id: 1, kinds: ["state"] },
        { id: 10, kinds: ["props"] },
        { id: 11, kinds: ["props"] },
        { id: 12, kinds: ["props"] },
        { id: 13, kinds: ["props"] },
        { id: 14, kinds: ["state"] },
      ],
      [{ id: 1, hooks: [] }],
    ),
  )
  const rendered = [
    ...container.querySelectorAll<HTMLElement>("[data-testid=commit-render]"),
  ].map((line) => `${line.dataset.depth} ${line.textContent}`)
  expect(rendered).toEqual([
    "0 App State changed",
    "1 List Props changed",
    "2 Row ×3 Props changed",
    "2 Row State changed",
  ])
})

const arriving = (seq: number, ...names: string[]): CommitSummary => ({
  ...summary(seq, 2000, 3),
  arrived: names.map((name, i) => ({
    boundary: seq * 10 + i,
    name,
    waited: 840,
    awaits: [],
  })),
})

test("an update that showed a boundary's content says its data arrived", () => {
  const { timeline, rows } = setup()
  timeline.receiveCommits(
    commitsMessage(
      [
        arriving(1, "Reviews"),
        arriving(2, "Reviews", "CartCount"),
        summary(3, 2000, 1),
      ],
      1,
      false,
    ),
  )
  expect(rows().map((row) => row.split(" / ")[0])).toEqual([
    "Root render",
    "Data arrived · Reviews boundary · waited 840 ms +1",
    "Data arrived · Reviews boundary · waited 840 ms",
  ])
})

test("a waterfall reads as one row; open, its waits on one time axis and a hint", () => {
  const { timeline, rows, container } = setup()
  const awaited = (
    seq: number,
    name: string,
    owner: string,
    start: number,
    end: number,
  ) => ({
    ...summary(seq, 2000, 1),
    arrived: [
      {
        boundary: seq,
        name: owner,
        waited: end - start,
        awaits: [{ name, owner, start, end }],
      },
    ],
  })
  timeline.receiveCommits(
    commitsMessage(
      [
        awaited(1, "getReviews", "Reviews", 96, 1297),
        summary(2, 2000, 1),
        awaited(3, "getRecommendations", "Recommendations", 1300, 2102),
      ],
      1,
      false,
    ),
  )
  expect(rows()[0]).toBe(
    "Waterfall · 2 waits, one after another · 2.0s / 2s ago",
  )
  const row = () =>
    container.querySelector("[role=option][data-group='3']") as HTMLElement
  fireEvent.click(row())
  const bars = [
    ...container.querySelectorAll<HTMLElement>("[data-testid=waterfall-bar]"),
  ]
  expect(bars).toHaveLength(2)
  const percent = (value: string) => Number.parseFloat(value)
  expect(percent(bars[0]?.style.left ?? "")).toBeCloseTo(0, 1)
  expect(percent(bars[0]?.style.width ?? "")).toBeCloseTo(59.9, 1)
  expect(percent(bars[1]?.style.left ?? "")).toBeCloseTo(60.0, 1)
  expect(
    [...container.querySelectorAll("[data-testid=waterfall-label]")].map(
      (label) => label.textContent,
    ),
  ).toEqual([
    "getReviews · Reviews · 1.2s",
    "getRecommendations · Recommendations · 802 ms",
  ])
  expect(
    container.querySelector("[data-testid=waterfall-hint]")?.textContent,
  ).toBe(
    "getRecommendations in Recommendations started only after getReviews ended. Starting it alongside would save up to 802 ms.",
  )
  fireEvent.click(row())
  expect(container.querySelector("[data-testid=waterfall]")).toBeNull()
})
