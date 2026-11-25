import { createRoot } from "solid-js"
import { afterEach, expect, test } from "vitest"
import { keyboardRows } from "../src/rows"

// Two value rows; the first holds an editor's input, as a row being edited does.
const setup = () => {
  const root = document.createElement("div")
  root.innerHTML = `
    <div role="treeitem" data-path="a" tabindex="0"><input data-testid="editor" /></div>
    <div role="treeitem" data-path="b" tabindex="-1"></div>`
  document.body.append(root)
  const dispose = createRoot((dispose) => {
    keyboardRows(root)
    return dispose
  })
  const row = (path: string) =>
    root.querySelector(`[data-path=${path}]`) as HTMLElement
  return { root, row, dispose }
}
let cleanup = () => {}
afterEach(() => cleanup())
// MutationObserver callbacks run as microtasks.
const observed = () => new Promise((resolve) => setTimeout(resolve))

test("a row's editor going away leaves focus where it is going, not back on the row", async () => {
  const { root, row, dispose } = setup()
  cleanup = () => {
    dispose()
    root.remove()
  }
  const input = root.querySelector("input") as HTMLInputElement
  input.focus()
  // Firefox closes the editor (its blur) before focus reaches the next row.
  input.remove()
  await observed()
  expect(document.activeElement).toBe(document.body)
  row("b").focus()
  await observed()
  expect(document.activeElement).toBe(row("b"))
})

test("a row replaced while focused gives focus to its replacement", async () => {
  const { root, row, dispose } = setup()
  cleanup = () => {
    dispose()
    root.remove()
  }
  row("b").focus()
  const next = row("b").cloneNode() as HTMLElement
  row("b").replaceWith(next)
  await observed()
  expect(document.activeElement).toBe(next)
})
