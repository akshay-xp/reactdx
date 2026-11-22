// The inspector's Show fallback and Show error toggles (docs/page.md, Boundaries):
// the nearest boundary of each kind, forced through React's own handlers.

import type { Fiber } from "./tree.ts"

export type BoundaryKind = "fallback" | "error"

// The development renderer's hooks for forcing (react-dom 18 and 19).
export type ForcingRenderer = {
  setSuspenseHandler?: (handler: (fiber: Fiber) => boolean) => void
  setErrorHandler?: (handler: (fiber: Fiber) => boolean | undefined) => void
  scheduleUpdate?: (fiber: Fiber) => void
  scheduleRetry?: (fiber: Fiber) => void
}

// A class with getDerivedStateFromError or componentDidCatch catches errors below.
const catches = (type: unknown) =>
  typeof (type as { getDerivedStateFromError?: unknown })
    ?.getDerivedStateFromError === "function" ||
  typeof (type as { prototype?: { componentDidCatch?: unknown } })?.prototype
    ?.componentDidCatch === "function"

// The nearest Suspense boundary (tag 13) and error boundary (a class, tag 1,
// that catches) at or above the fiber.
export function boundariesOf(fiber: Fiber) {
  const found: Partial<Record<BoundaryKind, Fiber>> = {}
  for (let at: Fiber | null = fiber; at; at = at.return) {
    if (!found.fallback && at.tag === 13) found.fallback = at
    if (!found.error && at.tag === 1 && catches(at.type)) found.error = at
  }
  return found
}

// The boundaries forced on, through React's handlers: asked about each Suspense
// fiber (true shows its fallback) and each class component as it renders (true
// renders its error UI for a simulated error; false resets it to a fresh
// instance's state; undefined leaves it). Installed on the first force, so a
// page that never uses the toggles keeps whatever handler was there.
export function createForcing(renderer: ForcingRenderer) {
  const forced = { fallback: new WeakSet<Fiber>(), error: new WeakSet<Fiber>() }
  const resetting = new WeakSet<Fiber>()
  // A fiber and its alternate are one boundary.
  const has = (set: WeakSet<Fiber>, fiber: Fiber) =>
    set.has(fiber) || (fiber.alternate !== null && set.has(fiber.alternate))
  let installed = false
  const install = () => {
    if (installed) return
    installed = true
    renderer.setSuspenseHandler?.((fiber) => has(forced.fallback, fiber))
    renderer.setErrorHandler?.((fiber) => {
      if (has(forced.error, fiber)) return true
      if (!has(resetting, fiber)) return undefined
      resetting.delete(fiber)
      if (fiber.alternate) resetting.delete(fiber.alternate)
      return false
    })
  }
  const forget = (set: WeakSet<Fiber>, fiber: Fiber) => {
    set.delete(fiber)
    if (fiber.alternate) set.delete(fiber.alternate)
  }
  return {
    isForced: (kind: BoundaryKind, fiber: Fiber) => has(forced[kind], fiber),
    force(kind: BoundaryKind, fiber: Fiber, on: boolean) {
      install()
      if (on) {
        forced[kind].add(fiber)
        renderer.scheduleUpdate?.(fiber)
        return
      }
      forget(forced[kind], fiber)
      if (kind === "error") {
        resetting.add(fiber)
        renderer.scheduleUpdate?.(fiber)
      }
      // A Suspense boundary showing its fallback renders again on a retry
      // (React 19); React 18 has no scheduleRetry.
      else (renderer.scheduleRetry ?? renderer.scheduleUpdate)?.(fiber)
    },
  }
}
