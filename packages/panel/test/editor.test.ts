import { expect, test } from "vitest"
import { type EditorIO, openInEditor } from "../src/editor.ts"

const origin = "http://localhost:5218"
const location = { file: "/a/src/Counter.jsx", line: 13, column: 7 }
const vite = `${origin}/__open-in-editor?file=%2Fa%2Fsrc%2FCounter.jsx%3A13%3A7`
const next = `${origin}/__nextjs_launch-editor?file=%2Fa%2Fsrc%2FCounter.jsx&line1=13&column1=7`

// Answers each URL from `routes` (404 with a page otherwise), recording requests.
function io(routes: Record<string, () => Response | Promise<Response>>) {
  const requests: string[] = []
  const copied: string[] = []
  const editor: EditorIO = {
    fetch: (async (input: string | URL | Request) => {
      const url = String(input)
      requests.push(url)
      return routes[url]?.() ?? new Response("<h1>404</h1>", { status: 404 })
    }) as typeof fetch,
    origin: async () => origin,
    copy: (text) => copied.push(text),
  }
  return { editor, requests, copied }
}

test("Vite's endpoint opens it", async () => {
  const { editor, requests, copied } = io({ [vite]: () => new Response("") })
  expect(await openInEditor(location, editor)).toBe("opened")
  expect(requests).toEqual([vite])
  expect(copied).toEqual([])
})

test("else Next's endpoint opens it", async () => {
  const { editor, requests } = io({
    [next]: () => new Response(null, { status: 204 }),
  })
  expect(await openInEditor(location, editor)).toBe("opened")
  expect(requests).toEqual([vite, next])
})

test.each<[string, Record<string, () => Response | Promise<Response>>]>([
  ["neither answers", {}],
  [
    "both answer with a page",
    {
      [vite]: () => new Response("<html></html>"),
      [next]: () => new Response("<html></html>"),
    },
  ],
  [
    "the requests fail",
    {
      [vite]: () => Promise.reject(new TypeError("offline")),
      [next]: () => Promise.reject(new TypeError("offline")),
    },
  ],
])("when %s, file:line:column is copied", async (_, routes) => {
  const { editor, copied } = io(routes)
  expect(await openInEditor(location, editor)).toBe("copied")
  expect(copied).toEqual(["/a/src/Counter.jsx:13:7"])
})
