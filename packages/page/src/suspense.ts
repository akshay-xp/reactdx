import type { Fiber } from "./tree.ts"

// Suspense waits (docs/page.md, Suspense): a boundary (tag 13) waits while its
// memoizedState is set: showing its fallback, or, in a streamed load, its
// server HTML not yet hydrated (`dehydrated`).
export function waitOf(fiber: Fiber): "fallback" | "dehydrated" | null {
  if (fiber.tag !== 13 || fiber.memoizedState == null) return null
  const { dehydrated } = fiber.memoizedState as { dehydrated?: unknown }
  return dehydrated == null ? "fallback" : "dehydrated"
}
