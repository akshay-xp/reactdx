import { ELEMENTS_EVENT } from "@reactdx/messages"
import { expect, test } from "vitest"
import { followElements, SELECT_CODE, showCode } from "../src/elements"

// Runs eval code as inspectedWindow.eval would, with its $0 and inspect().
const run = (code: string, $0?: Element, inspect = (_: Element) => {}) =>
  new Function("$0", "inspect", `return ${code}`)($0, inspect)

test("each Elements selection change evaluates the select code; show evaluates the show code", () => {
  const evaluated: string[] = []
  let changed = () => {}
  const elements = followElements({
    onSelectionChanged: { addListener: (listener) => (changed = listener) },
    evaluate: (code) => evaluated.push(code),
  })
  changed()
  expect(evaluated).toEqual([SELECT_CODE])
  elements.show(7)
  expect(evaluated).toEqual([SELECT_CODE, showCode(7)])
})

test("the select code hands the agent $0; the show code inspects the element it gets back", () => {
  const details: Record<string, unknown>[] = []
  const el = document.createElement("p")
  const answer = (event: Event) => {
    const detail = (event as CustomEvent).detail
    details.push({ ...detail })
    if (detail.id === 7) detail.element = el
  }
  window.addEventListener(ELEMENTS_EVENT, answer)
  try {
    run(SELECT_CODE, el)
    expect(details).toEqual([{ selected: el }])
    const inspected: Element[] = []
    expect(run(showCode(7), undefined, (e) => inspected.push(e))).toBe(true)
    expect(inspected).toEqual([el])
    expect(run(showCode(8), undefined, (e) => inspected.push(e))).toBe(false)
    expect(inspected).toEqual([el])
    expect(details.slice(1)).toEqual([{ id: 7 }, { id: 8 }])
  } finally {
    window.removeEventListener(ELEMENTS_EVENT, answer)
  }
})
