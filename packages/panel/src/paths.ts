import type { EditRoot, ValueKey } from "@reactdx/messages"

// Where an inspector row is (docs/panel.md, Inspector): its section's root and
// the keys from there (names, or indexes into arrays, map entries and sets).
// The same roots an edit writes to.
export type PathRoot = EditRoot
export type RowPath = { root: PathRoot; keys: ValueKey[] }

// Equal for the same path only: keys may hold dots, and "0" isn't 0.
export const pathKey = (path: RowPath) => JSON.stringify([path.root, path.keys])

export const childPath = (path: RowPath, key: ValueKey): RowPath => ({
  root: path.root,
  keys: [...path.keys, key],
})
