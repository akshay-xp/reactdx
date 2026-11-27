import { ELEMENTS_EVENT } from "@reactdx/messages"

// The browser's Elements panel, both ways (#92; docs/panel.md, Elements panel).
// inspectedWindow.eval runs in the page's world, the agent's, with the
// console's $0 and inspect(): the code hands the agent $0, or gets a node's
// first element back through the event's detail and inspects it.
const dispatch = (detail: string) =>
  `window.dispatchEvent(new CustomEvent(${JSON.stringify(ELEMENTS_EVENT)}, { detail: ${detail} }))`

export const SELECT_CODE = dispatch("{ selected: $0 }")

// Whether there was an element to inspect.
export const showCode = (id: number) =>
  `(() => { const detail = { id: ${id} }; ${dispatch("detail")}; if (detail.element) inspect(detail.element); return Boolean(detail.element) })()`

export function followElements({
  onSelectionChanged,
  evaluate,
}: {
  onSelectionChanged: { addListener(listener: () => void): void }
  evaluate: (code: string) => void
}) {
  onSelectionChanged.addListener(() => evaluate(SELECT_CODE))
  return { show: (id: number) => evaluate(showCode(id)) }
}
