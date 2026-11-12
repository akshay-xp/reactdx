import type { SourceRef } from "@reactdx/messages"
import { type RawSourceMap, SourceMapConsumer } from "source-map-js"

// 1-based line and column; `file` absolute, or relative to the dev server's root.
export type SourceLocation = { file: string; line: number; column: number }

const WEB = /^https?:/
// The last map comment in a script (a bundle can quote others before it).
const MAP_COMMENT = /\/\/[#@] sourceMappingURL=(\S+)\s*$/

// The constructor resolves sources against the map's URL; the types omit it.
const Consumer = SourceMapConsumer as unknown as new (
  map: RawSourceMap,
  url: string,
) => SourceMapConsumer

// A source URL as a path: a served file is relative to the server's root.
function pathOf(url: string) {
  const parsed = new URL(url)
  const path = decodeURIComponent(parsed.pathname)
  if (parsed.protocol === "file:") return path
  return WEB.test(url) ? path.slice(1) : url
}

function decodeDataUrl(url: string) {
  const comma = url.indexOf(",")
  const body = url.slice(comma + 1)
  if (!url.slice(0, comma).endsWith(";base64")) return decodeURIComponent(body)
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// Maps a React 19 call site in a served script to its original file, through the
// script's source map. Only the page's web scripts (and data: maps) are read.
export function createSourceResolver(fetch: typeof globalThis.fetch) {
  const text = async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} for ${url}`)
    return response.text()
  }
  const load = async (scriptUrl: string) => {
    const comment = MAP_COMMENT.exec(await text(scriptUrl))?.[1]
    if (!comment) return null
    const mapUrl = new URL(comment, scriptUrl).href
    if (mapUrl.startsWith("data:"))
      return new Consumer(JSON.parse(decodeDataUrl(mapUrl)), scriptUrl)
    if (!WEB.test(mapUrl)) return null
    return new Consumer(JSON.parse(await text(mapUrl)), mapUrl)
  }
  // Per script for the panel's lifetime; a failed load is tried again next time.
  const consumers = new Map<string, Promise<SourceMapConsumer | null>>()
  const consumerFor = (scriptUrl: string) => {
    let consumer = consumers.get(scriptUrl)
    if (!consumer) {
      consumer = load(scriptUrl)
      consumers.set(scriptUrl, consumer)
      consumer.catch(() => consumers.delete(scriptUrl))
    }
    return consumer
  }
  return async (source: SourceRef): Promise<SourceLocation | null> => {
    if ("file" in source) return source
    const { url, line, column } = source
    if (!WEB.test(url)) return null
    try {
      const original = (await consumerFor(url))?.originalPositionFor({
        line,
        column: column - 1,
      })
      if (original?.source && original.line)
        return {
          file: pathOf(original.source),
          line: original.line,
          column: original.column + 1,
        }
      return { file: pathOf(url), line, column }
    } catch {
      return null
    }
  }
}
