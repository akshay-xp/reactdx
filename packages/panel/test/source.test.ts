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

// Next's chunks: an external map in sections, with file:// sources.
const chunk = "http://h/_next/static/chunks/c.js"
const sectioned = JSON.stringify({
  version: 3,
  sections: [
    {
      offset: { line: 4, column: 0 },
      map: JSON.parse(map("file:///abs/app/Counter.jsx")),
    },
  ],
})

test("a frame maps through an external sectioned map", async () => {
  const { fetch } = serve({
    [chunk]: "code\n//# sourceMappingURL=c.js.map\n",
    [`${chunk}.map`]: sectioned,
  })
  // Section offset 4 lines: generated 18 is the section's 14.
  expect(
    await createSourceResolver(fetch)({ url: chunk, line: 18, column: 47 }),
  ).toEqual({ file: "/abs/app/Counter.jsx", line: 13, column: 7 })
})

test("a map that isn't on the web leaves the frame as is", async () => {
  const { fetch, requests } = serve({
    [chunk]: "code\n//# sourceMappingURL=file:///c.js.map\n",
  })
  expect(
    await createSourceResolver(fetch)({ url: chunk, line: 18, column: 47 }),
  ).toEqual({ file: "_next/static/chunks/c.js", line: 18, column: 47 })
  expect(requests).toEqual([chunk])
})

test("each script and map is fetched once", async () => {
  const { fetch, requests } = serve({
    [chunk]: "code\n//# sourceMappingURL=c.js.map\n",
    [`${chunk}.map`]: sectioned,
  })
  const resolve = createSourceResolver(fetch)
  await resolve({ url: chunk, line: 18, column: 47 })
  await resolve({ url: chunk, line: 5, column: 1 })
  expect(requests).toEqual([chunk, `${chunk}.map`])
})
