import React from "react"

export const KEY = "__REACT_DEVTOOLS_GLOBAL_HOOK__"

// Inserts a fresh prototype under globalThis, standing in for Window.prototype:
// React resolves the global hook through it, as it does through a real window's.
export function windowLike() {
  Object.setPrototypeOf(
    globalThis,
    Object.create(Object.getPrototypeOf(globalThis)),
  )
  return globalThis
}

// react-dom registers with the hook as it loads, so call this after installing.
export async function mount() {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import("react-dom/client")
  const div = document.createElement("div")
  const root = createRoot(div)
  await React.act(() => root.render(React.createElement("p", null, "hi")))
  return { div, root }
}
