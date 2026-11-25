import { expect, test } from "vitest"
import type { TreeKind } from "../src/index"
import { nextInternal } from "../src/index"

const internal = { name: "SegmentStateProvider", internal: true }
const app = { name: "Shop", internal: false }

test.each<[string, TreeKind, typeof app | undefined, boolean]>([
  ["AppRouter", "function", undefined, true],
  ["ErrorBoundary", "function", internal, true],
  ["__next_outlet_boundary__", "lazy", internal, true],
  ["LayoutRouterContext", "provider", internal, true],
  ["Next.MetadataOutlet", "server", internal, true],
  ["Context", "provider", internal, true],
  [
    "Suspense",
    "suspense",
    { name: "__next_metadata_boundary__", internal: true },
    true,
  ],
  ["ErrorBoundary", "class", app, false],
  ["Context", "provider", app, false],
  ["Suspense", "suspense", app, false],
  ["Counter", "lazy", internal, false],
  ["RootLayout", "server", internal, false],
  ["Page", "server", internal, false],
])("%s %s under %o: %s", (name, kind, parent, expected) => {
  expect(nextInternal(name, kind, parent)).toBe(expected)
})
