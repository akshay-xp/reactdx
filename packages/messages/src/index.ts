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
    if (
      !isRendererId(rendererId) ||
      !isCount(id) ||
      id < 1 ||
      !isCount(commits)
    )
      return
    parsed.push({ rendererId, id, commits })
  }
  return snapshotMessage(parsed)
}

export type ToolbarIcon = "none" | "development" | "production"

export type ToolbarState = { icon: ToolbarIcon; title: string }

// Rendered by `pnpm icons` into apps/extension/public/icon/.
export const toolbarIcons = (icon: ToolbarIcon) =>
  Object.fromEntries(
    [16, 32, 48, 128].map((size) => [size, `icon/${icon}-${size}.png`]),
  )

// Content script to background: every renderer the tab's document has, so the
// background needs no state of its own.
export type RenderersMessage = { type: "renderers"; renderers: RendererInfo[] }

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
