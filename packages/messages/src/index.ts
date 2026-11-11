import type { RendererInfo } from "@reactdx/page"

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

const isString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max

// The page shares the MAIN world with the hook, so a message can be forged:
// this guarantees shape and size, not origin.
export function parsePageMessage(data: unknown): RendererMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, id, version, bundleType, rendererPackageName } =
    data as Record<string, unknown>
  if (source !== "reactdx" || type !== "renderer") return
  if (typeof id !== "number" || !Number.isInteger(id)) return
  if (id < 1 || id > MAX_RENDERERS) return
  if (!isString(version, 64) || !isString(rendererPackageName, 128)) return
  if (bundleType !== 0 && bundleType !== 1) return
  return rendererMessage(id, {
    version,
    bundleType,
    rendererPackageName,
  })
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
