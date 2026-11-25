import {
  type EditRoot,
  type EditValue,
  isKinds,
  MAX_VALUE_STRING,
  parseEditPath,
  parseEditRoot,
  parseEditValue,
  parseList,
  parseUpdaters,
  parseValueTarget,
  type RenderKind,
  type Size,
  type Updater,
  type ValueKey,
  type ValueTarget,
} from "./inspect.ts"

export type RendererInfo = {
  version: string
  bundleType: number
  rendererPackageName: string
}

export type RendererMessage = {
  source: "reactdx"
  type: "renderer"
  id: number
} & RendererInfo

export const rendererMessage = (
  id: number,
  info: RendererInfo,
): RendererMessage => ({ source: "reactdx", type: "renderer", id, ...info })

const MAX_RENDERERS = 64

export type RootInfo = { rendererId: number; id: number; commits: number }

// One React copy as the panel shows it.
export type RendererView = { id: number } & RendererInfo & {
    roots: { id: number; commits: number }[]
  }

export type SnapshotMessage = {
  source: "reactdx"
  type: "snapshot"
  roots: RootInfo[]
}

export const snapshotMessage = (roots: RootInfo[]): SnapshotMessage => ({
  source: "reactdx",
  type: "snapshot",
  roots,
})

export type PageMessage = RendererMessage | SnapshotMessage

const MAX_ROOTS = 256

const isString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0

const isId = (value: unknown): value is number => isCount(value) && value >= 1

const isRendererId = (value: unknown): value is number =>
  isCount(value) && value >= 1 && value <= MAX_RENDERERS

// The page shares the MAIN world with the hook, so a message can be forged:
// this guarantees shape and size, not origin.
export function parsePageMessage(data: unknown): PageMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const message = data as Record<string, unknown>
  if (message.source !== "reactdx") return
  if (message.type === "renderer") return parseRenderer(message)
  if (message.type === "snapshot") return parseSnapshot(message)
}

function parseRenderer(message: Record<string, unknown>) {
  const { id, version, bundleType, rendererPackageName } = message
  if (!isRendererId(id)) return
  if (!isString(version, 64) || !isString(rendererPackageName, 128)) return
  if (bundleType !== 0 && bundleType !== 1) return
  return rendererMessage(id, { version, bundleType, rendererPackageName })
}

function parseSnapshot(message: Record<string, unknown>) {
  const { roots } = message
  if (!Array.isArray(roots) || roots.length > MAX_ROOTS) return
  const parsed: RootInfo[] = []
  for (const root of roots) {
    if (typeof root !== "object" || root === null) return
    const { rendererId, id, commits } = root as Record<string, unknown>
    if (!isRendererId(rendererId) || !isId(id) || !isCount(commits)) return
    parsed.push({ rendererId, id, commits })
  }
  return snapshotMessage(parsed)
}

export type TreeKind =
  | "function"
  | "class"
  | "forwardRef"
  | "memo"
  | "lazy"
  | "suspense"
  | "provider"
  | "consumer"
  | "profiler"
  | "activity"
  | "host"
  | "server"

// parentId 0 is the root's top level; removing a node removes its descendants.
export type TreeOp =
  | { op: "reset" }
  | {
      op: "add"
      id: number
      parentId: number
      rootId: number
      kind: TreeKind
      name: string
      key: string | null
      index: number
    }
  | { op: "remove"; id: number }
  | { op: "reorder"; rootId: number; parentId: number; children: number[] }
  | { op: "rename"; id: number; name: string }
  // A Suspense boundary (M7 #80): waiting so far at the commit, or how long it
  // took once its content arrived, in ms.
  | { op: "suspense"; id: number; state: "waiting" | "arrived"; ms: number }

export type TreeBatchMessage = {
  source: "reactdx"
  type: "tree"
  seq: number
  ops: TreeOp[]
}

export const treeBatch = (seq: number, ops: TreeOp[]): TreeBatchMessage => ({
  source: "reactdx",
  type: "tree",
  seq,
  ops,
})

export const MAX_OPS = 2000
export const MAX_TREE_STRING = 256
const MAX_CHILDREN = 10000

const TREE_KINDS = new Set<unknown>([
  "function",
  "class",
  "forwardRef",
  "memo",
  "lazy",
  "suspense",
  "provider",
  "consumer",
  "profiler",
  "activity",
  "host",
  "server",
] satisfies TreeKind[])

// Any invalid op drops the whole batch: a partial batch would desync the panel's mirror.
export function parseTreeBatch(data: unknown): TreeBatchMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, seq, ops } = data as Record<string, unknown>
  if (source !== "reactdx" || type !== "tree" || !isId(seq)) return
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_OPS) return
  const parsed: TreeOp[] = []
  for (const op of ops) {
    const result = parseTreeOp(op)
    if (!result) return
    parsed.push(result)
  }
  return treeBatch(seq, parsed)
}

function parseTreeOp(data: unknown): TreeOp | undefined {
  if (typeof data !== "object" || data === null) return
  const o = data as Record<string, unknown>
  switch (o.op) {
    case "reset":
      return { op: "reset" }
    case "add": {
      const { id, parentId, rootId, kind, name, key, index } = o
      if (!isId(id) || !isCount(parentId) || !isId(rootId)) return
      if (!isCount(index) || !TREE_KINDS.has(kind)) return
      if (!isString(name, MAX_TREE_STRING)) return
      if (key !== null && !isString(key, MAX_TREE_STRING)) return
      return {
        op: "add",
        id,
        parentId,
        rootId,
        kind: kind as TreeKind,
        name,
        key,
        index,
      }
    }
    case "remove":
      return isId(o.id) ? { op: "remove", id: o.id } : undefined
    case "reorder": {
      const { rootId, parentId, children } = o
      if (!isId(rootId) || !isCount(parentId)) return
      if (!Array.isArray(children) || children.length > MAX_CHILDREN) return
      if (!children.every(isId)) return
      return { op: "reorder", rootId, parentId, children: [...children] }
    }
    case "rename": {
      const { id, name } = o
      if (!isId(id) || !isString(name, MAX_TREE_STRING)) return
      return { op: "rename", id, name }
    }
    case "suspense": {
      const { id, state, ms } = o
      if (!isId(id) || (state !== "waiting" && state !== "arrived")) return
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return
      return { op: "suspense", id, state, ms }
    }
  }
}

export type ToolbarIcon = "none" | "development" | "production"

export type ToolbarState = { icon: ToolbarIcon; title: string }

// Rendered by `pnpm icons` into apps/extension/public/icon/.
export const toolbarIcons = (icon: ToolbarIcon) =>
  Object.fromEntries(
    [16, 32, 48, 128].map((size) => [size, `icon/${icon}-${size}.png`]),
  )

// Content script to background, and background to panel: everything the tab's
// document has, so the background needs no state of its own.
// `stale`: the page loaded before ReactDX was installed or updated, so React never
// saw the hook and only a reload can connect it.
export type TabStateMessage = {
  type: "state"
  renderers: RendererView[]
  stale?: boolean
}

// Toolbar title for tabs that were open when ReactDX was installed or updated.
export const STALE_TITLE = "ReactDX: reload this page to check for React"

// Background to content script: answer with the current TabStateMessage.
export type GetStateMessage = { type: "get-state" }

// Panel to background, over its port: send me this tab's state.
export type SubscribeMessage = { type: "subscribe"; tabId: number }

// Panel to background (with the tab), then background to the relay's tree port:
// the mirror fell out of step, send the whole tree again.
export type ResyncMessage = { type: "resync"; tabId: number }

// Background's reply to a TabStateMessage: a panel is open on this tab.
export type StateReply = { watch: boolean }

// Content script to agent, through the page: post a fresh snapshot.
export const GET_SNAPSHOT = { source: "reactdx-relay", type: "get-snapshot" }

// Content script to agent: a panel is watching, so track the tree (and resync), or stop.
export const WATCH = { source: "reactdx-relay", type: "watch" }
export const UNWATCH = { source: "reactdx-relay", type: "unwatch" }

// Panel to background over its port: highlight a tree node on the page, or stop.
export type HighlightMessage = { type: "highlight"; tabId: number; id: number }
export type ClearHighlightMessage = { type: "clear-highlight"; tabId: number }
// Panel to background: start or stop the element picker on the page.
export type PickMessage = { type: "pick-start" | "pick-stop"; tabId: number }
// What the page outlines (docs/page.md, Outlines).
export type OutlineMode = "suspense" | "islands"
// Panel to background: draw that mode's outlines on the page, or (null) stop.
export type OutlinesMessage = {
  type: "outlines"
  tabId: number
  mode: OutlineMode | null
}
// Panel to background: inspect a node (null: stop), or load one page of an object.
export type InspectMessage = {
  type: "inspect"
  tabId: number
  id: number | null
}
export type ExpandMessage = {
  type: "expand"
  tabId: number
  objectId: number
  offset: number
}

// Panel to background: write a value of the inspected node (`id`).
export type EditMessage = {
  type: "edit"
  tabId: number
  id: number
  root: EditRoot
  path: ValueKey[]
  value: EditValue
}

// Panel to background: show the nearest Suspense boundary's fallback or error
// boundary's error UI (`on`), or its children again.
export type ForceMessage = {
  type: "force"
  tabId: number
  id: number
  kind: "fallback" | "error"
  on: boolean
}

// Panel to background: load one recorded render of the inspected node (its
// commit `seq`, from the inspection's `history`; M6 #66).
export type ReasonMessage = {
  type: "reason"
  tabId: number
  id: number
  seq: number
}

// Panel to background: the ids the commit `seq` rendered (M6 #67).
export type CommitMessage = { type: "commit"; tabId: number; seq: number }
// Panel to background: empty the page's recorded updates (M6 #74).
export type ClearUpdatesMessage = { type: "clear-updates"; tabId: number }

// What one component rendered for in a commit.
export type CommitRender = { id: number; kinds: RenderKind[] }

// Agent to panel: one batch of a commit's renders, at most MAX_OPS, the first
// with the components whose updates triggered it; null once the commit left
// the page's buffer.
export type CommittedMessage = {
  source: "reactdx"
  type: "committed"
  seq: number
  renders: CommitRender[] | null
  updaters?: Updater[]
}
export const committed = (
  seq: number,
  renders: CommitRender[] | null,
  updaters?: Updater[],
): CommittedMessage => ({
  source: "reactdx",
  type: "committed",
  seq,
  renders,
  ...(updaters && { updaters }),
})

export function parseCommitted(data: unknown): CommittedMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, seq, renders, updaters } = data as Record<
    string,
    unknown
  >
  if (source !== "reactdx" || type !== "committed" || !isId(seq)) return
  if (renders === null) return committed(seq, null)
  const list = parseList(renders, MAX_OPS, (item) =>
    isId(item.id) && isKinds(item.kinds)
      ? { id: item.id, kinds: [...item.kinds] }
      : undefined,
  )
  if (!list) return
  if (updaters === undefined) return committed(seq, list)
  const triggers = parseUpdaters(updaters)
  if (triggers) return committed(seq, list, triggers)
}

// Agent to panel, on the flush (M6 #72): renders and wasted renders (only
// because the parent rendered) per component since the watch, for the ones
// that changed (a watch: all), at most MAX_OPS per message.
export type RenderCount = { id: number; renders: number; wasted: number }
export type CountsMessage = {
  source: "reactdx"
  type: "counts"
  counts: RenderCount[]
}
export const countsMessage = (counts: RenderCount[]): CountsMessage => ({
  source: "reactdx",
  type: "counts",
  counts,
})

export function parseCounts(data: unknown): CountsMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, counts } = data as Record<string, unknown>
  if (source !== "reactdx" || type !== "counts") return
  const list = parseList(counts, MAX_OPS, ({ id, renders, wasted }) =>
    isId(id) && isId(renders) && isCount(wasted) && wasted <= renders
      ? { id, renders, wasted }
      : undefined,
  )
  if (list) return countsMessage(list)
}

// Panel to background: render the inspected node again, nothing changed.
export type RerenderMessage = { type: "rerender"; tabId: number; id: number }

// Panel to background: delete a key or item of the inspected node's value, or
// rename a key (the last in `path`) to `to`.
export type DeletePathMessage = {
  type: "delete-path"
  tabId: number
  id: number
  root: EditRoot
  path: ValueKey[]
}
export type RenamePathMessage = {
  type: "rename-path"
  tabId: number
  id: number
  root: EditRoot
  path: ValueKey[]
  to: string
}

// Panel to background: copy a row's value, or store it as a page global.
export type ValueMessage = {
  type: "copy-value" | "store-value"
  tabId: number
  target: ValueTarget
}

// Background to the relay's tree port. The relay checks each one before acting:
// a malformed command never reaches the page.
export type TreeCommand =
  | { type: "resync" }
  | { type: "highlight"; id: number }
  | { type: "clear-highlight" }
  | { type: "pick-start" }
  | { type: "pick-stop" }
  | { type: "outlines"; mode: OutlineMode | null }
  | { type: "inspect"; id: number | null }
  | { type: "expand"; objectId: number; offset: number }
  | { type: "copy-value" | "store-value"; target: ValueTarget }
  | {
      type: "edit"
      id: number
      root: EditRoot
      path: ValueKey[]
      value: EditValue
    }
  | { type: "delete-path"; id: number; root: EditRoot; path: ValueKey[] }
  | { type: "rerender"; id: number }
  | { type: "reason"; id: number; seq: number }
  | { type: "commit"; seq: number }
  | { type: "clear-updates" }
  | { type: "force"; id: number; kind: "fallback" | "error"; on: boolean }
  | {
      type: "rename-path"
      id: number
      root: EditRoot
      path: ValueKey[]
      to: string
    }

// Commands with no arguments.
const BARE_COMMANDS = new Set<unknown>([
  "resync",
  "clear-highlight",
  "pick-start",
  "pick-stop",
  "clear-updates",
])

export function parseTreeCommand(data: unknown): TreeCommand | undefined {
  if (typeof data !== "object" || data === null) return
  const {
    type,
    id,
    objectId,
    offset,
    target,
    root,
    path,
    value,
    to,
    kind,
    on,
    seq,
    mode,
  } = data as Record<string, unknown>
  if (BARE_COMMANDS.has(type)) return { type } as TreeCommand
  if (type === "highlight" && isId(id)) return { type, id }
  if (type === "inspect" && (id === null || isId(id))) return { type, id }
  if (type === "rerender" && isId(id)) return { type, id }
  if (
    type === "outlines" &&
    (mode === null || mode === "suspense" || mode === "islands")
  )
    return { type, mode }
  if (type === "reason" && isId(id) && isId(seq)) return { type, id, seq }
  if (type === "commit" && isId(seq)) return { type, seq }
  if (
    type === "force" &&
    isId(id) &&
    (kind === "fallback" || kind === "error") &&
    typeof on === "boolean"
  )
    return { type, id, kind, on }
  if (type === "expand" && isId(objectId) && isCount(offset))
    return { type, objectId, offset }
  if (type === "edit" && isId(id)) {
    const parsed = {
      root: parseEditRoot(root),
      path: parseEditPath(path),
      value: parseEditValue(value),
    }
    if (parsed.root && parsed.path && parsed.value !== undefined)
      return { type, id, ...parsed } as TreeCommand
  }
  // Delete and rename name a key: the path isn't empty.
  if ((type === "delete-path" || type === "rename-path") && isId(id)) {
    const at = { root: parseEditRoot(root), path: parseEditPath(path) }
    if (!at.root || !at.path?.length) return
    if (type === "delete-path") return { type, id, ...at } as TreeCommand
    if (isString(to, MAX_VALUE_STRING) && to !== "")
      return { type, id, ...at, to } as TreeCommand
  }
  if (type === "copy-value" || type === "store-value") {
    const parsed = parseValueTarget(target)
    if (parsed) return { type, target: parsed }
  }
}

// Content script to agent: draw or remove the highlight overlay.
export const highlight = (id: number) => ({
  source: "reactdx-relay",
  type: "highlight",
  id,
})
export const CLEAR_HIGHLIGHT = {
  source: "reactdx-relay",
  type: "clear-highlight",
}
export const PICK_START = { source: "reactdx-relay", type: "pick-start" }
export const PICK_STOP = { source: "reactdx-relay", type: "pick-stop" }

// Agent to panel (relay, tree port, background): the picked component's id, or
// null when picking ended without one (Escape, or a click on nothing React owns).
export type PickedMessage = {
  source: "reactdx"
  type: "picked"
  id: number | null
}
export const picked = (id: number | null): PickedMessage => ({
  source: "reactdx",
  type: "picked",
  id,
})
export function parsePicked(data: unknown): PickedMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, id } = data as Record<string, unknown>
  if (source !== "reactdx" || type !== "picked") return
  if (id === null || isId(id)) return picked(id)
}

// Roots of renderers the relay hasn't seen are dropped.
export const tabState = (
  renderers: Map<number, RendererInfo>,
  roots: RootInfo[],
): RendererView[] =>
  [...renderers].map(([id, info]) => ({
    id,
    ...info,
    roots: roots
      .filter((root) => root.rendererId === id)
      .map(({ id, commits }) => ({ id, commits })),
  }))

// Content script to background, once per document: the first development renderer connected.
export type InjectAgentMessage = { type: "inject-agent" }

// A development copy is what ReactDX can inspect, so it decides the state;
// production copies alongside it (Next's dev overlay) aren't listed.
export function toolbarState(renderers: RendererInfo[]): ToolbarState {
  const versions = (bundleType: number) => [
    ...new Set(
      renderers
        .filter((r) => r.bundleType === bundleType)
        .map((r) => r.version),
    ),
  ]
  const development = versions(1)
  if (development.length)
    return {
      icon: "development",
      title: `ReactDX: React ${development.join(", ")}`,
    }
  const production = versions(0)
  if (production.length)
    return {
      icon: "production",
      title: `ReactDX: React ${production.join(", ")} (production build)`,
    }
  return { icon: "none", title: "ReactDX: no React" }
}

export * from "./inspect.ts"

// A wait (the panel's text, the page's outline labels): whole milliseconds, seconds with one decimal from a second.
export const durationText = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`

// A page-measured size: bytes under 1,000, else KB with one decimal; past the
// page's caps, what was counted before it stopped.
export function sizeText({ bytes, over }: Size) {
  if (over) return `over ${Math.floor(bytes / 1024).toLocaleString("en-US")} KB`
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

// Next.js App Router internals (the panel hides them, the page skips them).
export { nextInternal } from "./next.ts"
