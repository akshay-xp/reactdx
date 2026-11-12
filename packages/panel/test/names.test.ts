import { expect, test } from "vitest"
import { createHookNamer } from "../src/names.ts"

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

const url = "http://h/src/App.jsx?t=1"
const module = "const [count] = useState(0)\nconst ref = useRef()\n"

test("a hook's call site names it; a script is fetched once", async () => {
  const { fetch, requests } = serve({ [url]: module })
  const name = createHookNamer(fetch)
  expect(await name({ url, line: 1, column: 17 })).toBe("count")
  expect(await name({ url, line: 2, column: 13 })).toBe("ref")
  expect(requests).toEqual([url])
})

test("nothing for a page that isn't on the web, a 404 or code that won't parse", async () => {
  const { fetch, requests } = serve({ "http://h/bad.js": "const = (" })
  const name = createHookNamer(fetch)
  expect(
    await name({ url: "chrome-extension://x/a.js", line: 1, column: 1 }),
  ).toBe(null)
  expect(requests).toEqual([])
  expect(await name({ url, line: 1, column: 17 })).toBe(null)
  expect(await name({ url: "http://h/bad.js", line: 1, column: 1 })).toBe(null)
})
