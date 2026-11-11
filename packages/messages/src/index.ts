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
const MAX_TREE_STRING = 256
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
export type TabStateMessage = { type: "state"; renderers: RendererView[] }

// Background to content script: answer with the current TabStateMessage.
export type GetStateMessage = { type: "get-state" }

// Panel to background, over its port: send me this tab's state.
export type SubscribeMessage = { type: "subscribe"; tabId: number }

// Content script to agent, through the page: post a fresh snapshot.
export const GET_SNAPSHOT = { source: "reactdx-relay", type: "get-snapshot" }

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
