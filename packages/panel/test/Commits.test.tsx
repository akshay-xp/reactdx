import {
  type CommitSummary,
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
): CommitSummary => ({ seq, time: NOW - ago, rootId: 1, updaters, renders })

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
  const rows = () =>
    [...view.container.querySelectorAll("[role=option]")].map(
      (row) => row.textContent,
    )
  return { tree, inspector, timeline, sent, revealed, rows, ...view }
}

test("rows read newest first: seq, how long ago, how many, what triggered", () => {
  const { timeline, rows, container } = setup()
  expect(container.textContent).toContain(
    "No commits recorded since DevTools opened.",
  )
  timeline.receiveCommits([
    summary(1, 2 * 3600_000, 1, [9]),
    summary(2, 90_000, 1, [2]),
    summary(3, 2000, 3, [2, 3, 1]),
  ])
  expect(rows()).toEqual([
    "#3 · 2s ago · 3 components · Counter +2",
    "#2 · 1m ago · 1 component · Counter",
    "#1 · 2h ago · 1 component",
  ])
})

test("a click or a key picks a commit; Escape stays in the panel", () => {
  const { timeline, sent } = setup()
  timeline.receiveCommits([summary(1, 0, 1), summary(2, 0, 1)])
  const list = screen.getByRole("listbox", { name: "Commits" })
  fireEvent.click(screen.getByText(/^#1 /))
  expect(sent).toEqual([{ type: "commit", seq: 1 }])
  expect(list.getAttribute("aria-activedescendant")).toBe("commit-1")
  expect(screen.getByText(/^#1 /).closest("[role=option]")?.ariaSelected).toBe(
    "true",
  )
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

test("Only <selected> limits the list to the selected node's renders", () => {
  const { tree, inspector, timeline, rows } = setup()
  timeline.receiveCommits([
    summary(1, 0, 1),
    summary(2, 0, 1),
    summary(3, 0, 1),
  ])
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
  expect(rows().map((row) => row?.split(" ")[0])).toEqual(["#3", "#1"])
})
