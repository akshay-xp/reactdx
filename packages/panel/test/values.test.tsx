import type { Value } from "@reactdx/messages"
import { fireEvent, render } from "@solidjs/testing-library"
import { expect, test, vi } from "vitest"
import { createInspectorStore } from "../src/inspection"
import { type Entry, ValueRow } from "../src/values"

const object = (props: Record<string, Value>): Value => ({
  type: "object",
  className: "Object",
  id: 1,
  size: Object.keys(props).length,
  props,
})

// A row outside the inspector, as the reasons section and timeline render them.
function row(entry: Entry) {
  const inspector = createInspectorStore(vi.fn(), vi.fn())
  return render(() => (
    <div role="tree">
      <ValueRow
        inspector={inspector}
        entry={entry}
        path={{ root: "props", keys: [entry.name] }}
        depth={0}
        query=""
        onMenu={vi.fn()}
      />
    </div>
  ))
}

test("a value row renders on its own", () => {
  const { getAllByRole } = row({ name: "count", value: 1 })
  const [item] = getAllByRole("treeitem")
  expect(getAllByRole("treeitem")).toHaveLength(1)
  expect(item?.textContent).toContain("count")
  expect(item?.textContent).toContain("1")
  expect(item?.getAttribute("aria-level")).toBe("2")
})

test("a value row opens its children", () => {
  const { getAllByRole, getByTestId } = row({
    name: "user",
    value: object({ name: "Ada" }),
  })
  fireEvent.click(getByTestId("value-toggle"))
  const child = getAllByRole("treeitem")[1]
  expect(child?.textContent).toContain("name")
  expect(child?.textContent).toContain('"Ada"')
})
