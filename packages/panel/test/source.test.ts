import { SourceMapGenerator } from "source-map-js"
import { expect, test } from "vitest"
import { createSourceResolver } from "../src/source.ts"

// A fetch serving `files` by URL (404 otherwise), recording each request.
function serve(files: Record<string, string>) {
  const requests: string[] = []
  const fetch = async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    const body = files[url]
    return new Response(body ?? "", { status: body === undefined ? 404 : 200 })
  }
  return { fetch: fetch as typeof globalThis.fetch, requests }
}

// Generated 14:46 (0-based column) is original 13:6 of `source`.
function map(source: string) {
  const generator = new SourceMapGenerator()
  generator.addMapping({
    source,
    generated: { line: 14, column: 46 },
    original: { line: 13, column: 6 },
  })
  return generator.toString()
}
const inline = (json: string) =>
  `//# sourceMappingURL=data:application/json;base64,${btoa(json)}`

const frame = { url: "http://h/src/Counter.jsx?t=1", line: 14, column: 47 }

test("an original file resolves to itself without fetching", async () => {
  const { fetch, requests } = serve({})
  const source = { file: "/a/Counter.jsx", line: 13, column: 7 }
  expect(await createSourceResolver(fetch)(source)).toEqual(source)
  expect(requests).toEqual([])
})

test("a frame maps through the script's inline map", async () => {
  const { fetch } = serve({
    [frame.url]: `code\n${inline(map("Counter.jsx"))}\n`,
  })
  expect(await createSourceResolver(fetch)(frame)).toEqual({
    file: "src/Counter.jsx",
    line: 13,
    column: 7,
  })
})

test("a script without a map is its own source", async () => {
  const { fetch } = serve({ [frame.url]: "code\n" })
  expect(await createSourceResolver(fetch)(frame)).toEqual({
    file: "src/Counter.jsx",
    line: 14,
    column: 47,
  })
})

test("only web scripts are fetched", async () => {
  const { fetch, requests } = serve({})
  const resolve = createSourceResolver(fetch)
  expect(await resolve({ ...frame, url: "chrome-extension://x/a.js" })).toBe(
    null,
  )
  expect(requests).toEqual([])
})

test("a failed or rejected fetch resolves to nothing", async () => {
  expect(await createSourceResolver(serve({}).fetch)(frame)).toBe(null)
  const rejecting = (() =>
    Promise.reject(new TypeError("offline"))) as typeof fetch
  expect(await createSourceResolver(rejecting)(frame)).toBe(null)
})
