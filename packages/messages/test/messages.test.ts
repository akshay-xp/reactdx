import { expect, test } from "vitest"
import {
  parsePageMessage,
  rendererMessage,
  snapshotMessage,
  toolbarState,
} from "../src/index"

const info = {
  version: "19.3.1",
  bundleType: 1,
  rendererPackageName: "react-dom",
}
const valid = rendererMessage(1, info)

test("a renderer message round-trips as a new object", () => {
  expect(valid).toEqual({ source: "reactdx", type: "renderer", id: 1, ...info })
  const parsed = parsePageMessage(valid)
  expect(parsed).toEqual(valid)
  expect(parsed).not.toBe(valid)
})

test("extra keys are dropped", () => {
  expect(parsePageMessage({ ...valid, extra: "x" })).toEqual(valid)
})

test.each<[string, unknown]>([
  ["null", null],
  ["a string", "reactdx"],
  ["an array", [valid]],
  ["another source", { ...valid, source: "other" }],
  ["an unknown type", { ...valid, type: "commit" }],
  ["id 0", { ...valid, id: 0 }],
  ["id 65", { ...valid, id: 65 }],
  ["id 1.5", { ...valid, id: 1.5 }],
  ["id as a string", { ...valid, id: "1" }],
  ["a non-string version", { ...valid, version: 19 }],
  ["a version over 64 chars", { ...valid, version: "1".repeat(65) }],
  ["bundleType 2", { ...valid, bundleType: 2 }],
  [
    "a package name over 128 chars",
    { ...valid, rendererPackageName: "a".repeat(129) },
  ],
])("drops %s", (_, data) => {
  expect(parsePageMessage(data)).toBeUndefined()
})

const dev = (version: string) => ({
  version,
  bundleType: 1,
  rendererPackageName: "react-dom",
})
const prod = (version: string) => ({ ...dev(version), bundleType: 0 })

test.each([
  ["no React", [], "none", "ReactDX: no React"],
  [
    "one development copy",
    [dev("18.3.1")],
    "development",
    "ReactDX: React 18.3.1",
  ],
  [
    "two development copies, in arrival order",
    [dev("19.3.1"), dev("18.3.1")],
    "development",
    "ReactDX: React 19.3.1, 18.3.1",
  ],
  [
    "development with a production copy (Next's dev overlay)",
    [dev("19.3.1"), prod("19.0.0")],
    "development",
    "ReactDX: React 19.3.1",
  ],
  [
    "only production",
    [prod("19.3.1")],
    "production",
    "ReactDX: React 19.3.1 (production build)",
  ],
  [
    "a repeated version",
    [dev("19.3.1"), dev("19.3.1")],
    "development",
    "ReactDX: React 19.3.1",
  ],
] as const)("toolbar for %s", (_, renderers, icon, title) => {
  expect(toolbarState([...renderers])).toEqual({ icon, title })
})

const root = { rendererId: 1, id: 1, commits: 3 }
const snapshot = snapshotMessage([root, { rendererId: 2, id: 2, commits: 0 }])

test("a snapshot round-trips as a new object, with clean roots", () => {
  expect(snapshot).toEqual({
    source: "reactdx",
    type: "snapshot",
    roots: [root, { rendererId: 2, id: 2, commits: 0 }],
  })
  const parsed = parsePageMessage(snapshot)
  expect(parsed).toEqual(snapshot)
  expect(parsed).not.toBe(snapshot)
  expect(
    parsePageMessage({ ...snapshot, roots: [{ ...root, extra: "x" }] }),
  ).toEqual(snapshotMessage([root]))
})

test.each<[string, unknown]>([
  ["roots that aren't an array", { ...snapshot, roots: {} }],
  [
    "257 roots",
    {
      ...snapshot,
      roots: Array.from({ length: 257 }, (_, i) => ({ ...root, id: i + 1 })),
    },
  ],
  ["commits -1", { ...snapshot, roots: [{ ...root, commits: -1 }] }],
  ["commits 1.5", { ...snapshot, roots: [{ ...root, commits: 1.5 }] }],
  ["commits as a string", { ...snapshot, roots: [{ ...root, commits: "1" }] }],
  ["rendererId 0", { ...snapshot, roots: [{ ...root, rendererId: 0 }] }],
  ["rendererId 65", { ...snapshot, roots: [{ ...root, rendererId: 65 }] }],
  ["root id 0", { ...snapshot, roots: [{ ...root, id: 0 }] }],
  [
    "a root id past safe integers",
    { ...snapshot, roots: [{ ...root, id: 2 ** 53 }] },
  ],
  ["a null root", { ...snapshot, roots: [null] }],
])("drops a snapshot with %s", (_, data) => {
  expect(parsePageMessage(data)).toBeUndefined()
})
