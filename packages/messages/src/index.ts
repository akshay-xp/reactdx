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
