import { parseInspected } from "@reactdx/messages"
import React from "react"
import { expect, test, vi } from "vitest"
import { inspecting } from "./inspecting.ts"
import { ownedBy, react19, ServerChild, server, serverInfo } from "./server.ts"

const h = React.createElement
const { inspect, idOf, replies, mount, send, posted } = inspecting()

const shop = serverInfo("Shop")
const product = serverInfo("ProductDetails", null, {
  owner: shop,
  props: { id: "p-12" },
  stack: [["Shop", "/app/.next/server/chunk.js", 221, 514, 210, 1, false]],
})
const awaits = [
  {
    awaited: { name: "sleep", start: 95, end: 397, owner: product },
    owner: product,
    stack: [["getProduct", "/app/.next/server/chunk.js", 66, 11]],
  },
  {
    awaited: { name: "other", start: 1, end: 2 },
    owner: shop,
    stack: [["getOther", "/x.js", 1, 1]],
  },
  { awaited: { name: "rsc stream", start: 0, end: 400 } },
  { awaited: { name: "sleep", start: 400, end: 500 }, owner: product },
]

test.skipIf(!react19)(
  "a Server Component: its props, owners, location and awaits",
  async () => {
    const data = await inspect(
      server(shop, server(product, h("p"), awaits)),
      "ProductDetails",
    )
    expect(data).toMatchObject({
      props: { props: { id: "p-12" } },
      owners: [{ id: idOf("Shop"), name: "Shop" }],
      source: {
        url: "file:///app/.next/server/chunk.js",
        line: 221,
        column: 514,
      },
      server: {
        awaits: [
          { name: "getProduct", start: 95, end: 397 },
          { name: "sleep", start: 400, end: 500 },
        ],
        rendered: [],
      },
    })
    for (const key of ["state", "hooks", "contexts"])
      expect(data).not.toHaveProperty(key)
    const reply = replies().at(-1)
    expect(parseInspected(reply)).toEqual(reply)
  },
)

test.skipIf(!react19)(
  "a Server Component with no stack or props has no location, empty props",
  async () => {
    const bare = { name: "Bare", env: "Server", key: null, owner: null }
    const data = await inspect(server(bare, h("p")), "Bare")
    expect(data?.source).toBeUndefined()
    expect(data?.props).toMatchObject({ size: 0 })
  },
)

// Past the agent's 100 ms flush.
const flushed = () =>
  React.act(() => new Promise((resolve) => setTimeout(resolve, 150)))

let setTicks = (_: number) => {}
function Ticker() {
  const [ticks, set] = React.useState(0)
  setTicks = set
  return h("b", null, ticks)
}

test.skipIf(!react19)(
  "a selected Server Component stays selected until it leaves",
  async () => {
    const page = (info: object | null) =>
      h("div", null, h(Ticker), info && server(info, h("p")))
    await inspect(page(shop), "Shop")
    const shopId = idOf("Shop")
    const sent = () => replies().filter((reply) => reply.id === shopId)
    const before = sent().length

    await React.act(() => setTicks(1))
    await flushed()
    expect(sent().slice(before)).toEqual([])

    await mount(page(serverInfo("Shop")))
    await flushed()
    expect(sent().slice(before)).toHaveLength(1)
    expect(sent().at(-1)?.data).not.toBeNull()

    await mount(page(null))
    await flushed()
    expect(sent().at(-1)?.data).toBeNull()
  },
)

function AddToCart(_: { product: object; price: number }) {
  return h("button")
}
function Other() {
  return server(serverInfo("Nested"), h(ServerChild))
}

test.skipIf(!react19)(
  "a Server Component lists the client components it rendered, with sizes",
  async () => {
    const item = { id: "p-12", name: "Trail shoe" }
    const data = await inspect(
      server(
        product,
        h(
          "section",
          null,
          h(React.Suspense, null, h(AddToCart, { product: item, price: 89 })),
          h(Other),
        ),
      ),
      "ProductDetails",
    )
    expect(data?.server?.rendered).toEqual([
      {
        id: idOf("AddToCart"),
        name: "AddToCart",
        bytes: JSON.stringify({ product: item, price: 89 }).length,
      },
      { id: idOf("Other"), name: "Other", bytes: 2 },
    ])
  },
)

test.skipIf(!react19)(
  "a client component a Server Component rendered has the props it passed, sized",
  async () => {
    const specs = Array.from({ length: 200 }, (_, i) => ({
      label: `Spec ${i}, a long description of the trail shoe`,
    }))
    const big = { id: "p-12", name: "Trail shoe", specs }
    const data = await inspect(
      server(product, ownedBy(product, AddToCart, { product: big, price: 89 })),
      "AddToCart",
    )
    const size = (value: unknown) => JSON.stringify(value).length
    expect(data?.fromServer).toEqual({
      owner: { id: idOf("ProductDetails"), name: "ProductDetails" },
      props: [
        {
          key: "product",
          bytes: size(big),
          fields: [
            { key: "specs", bytes: size(specs) },
            { key: "name", bytes: size("Trail shoe") },
            { key: "id", bytes: size("p-12") },
          ],
        },
        { key: "price", bytes: 2 },
      ],
    })
    const plain = await inspect(
      h(AddToCart, { product: big, price: 1 }),
      "AddToCart",
    )
    expect(plain).not.toHaveProperty("fromServer")
  },
)

test.skipIf(!react19)(
  "a Suspense boundary a Server Component rendered has no props from the server",
  async () => {
    const data = await inspect(
      server(
        product,
        ownedBy(product, React.Suspense, { fallback: null, children: "x" }),
      ),
      "Suspense",
    )
    expect(data).not.toHaveProperty("fromServer")
  },
)

test.skipIf(!react19)(
  "the islands mode lights islands but Next's, and a click on one picks it",
  async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
      setTimeout(callback),
    )
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 1, top: 2, width: 3, height: 4 } as DOMRect)
    const roots: ShadowRoot[] = []
    const attach = Element.prototype.attachShadow
    const shadow = vi
      .spyOn(Element.prototype, "attachShadow")
      .mockImplementation(function (this: Element, init) {
        const root = attach.call(this, init)
        roots.push(root)
        return root
      })
    const shown = (selector: string) =>
      roots
        .filter((root) => root.host.isConnected)
        .flatMap((root) => [...root.querySelectorAll(selector)])
        .map((el) => el.textContent)
    const flushed = () =>
      React.act(() => new Promise((resolve) => setTimeout(resolve, 150)))
    try {
      function AddToCart(_: { price: number }) {
        return h("button")
      }
      function Boundary() {
        return h("span")
      }
      Boundary.displayName = "__next_metadata_boundary__"
      const shop = serverInfo("Shop")
      await mount(null)
      await mount(
        server(
          shop,
          h(
            "main",
            null,
            server(serverInfo("Details"), h(AddToCart, { price: 1 })),
            server(serverInfo("Wrapper"), h(Boundary)),
          ),
        ),
      )
      send({ source: "reactdx-relay", type: "watch" })
      send({ source: "reactdx-relay", type: "outlines", mode: "islands" })
      await flushed()
      expect(shown("[data-outline]")).toEqual([
        expect.stringMatching(/^AddToCart · \d+ B$/),
      ])
      expect(shown("[data-summary]")).toEqual([
        expect.stringMatching(/^1 client island · \d+ B of props$/),
      ])
      const id = idOf("AddToCart")
      posted.length = 0
      globalThis.dispatchEvent(
        new MouseEvent("click", { clientX: 2, clientY: 4, cancelable: true }),
      )
      expect(posted).toContainEqual({
        source: "reactdx",
        type: "picked",
        id,
      })
      send({ source: "reactdx-relay", type: "outlines", mode: "suspense" })
      await flushed()
      expect(shown("[data-outline]")).toEqual([])
    } finally {
      send({ source: "reactdx-relay", type: "outlines", mode: null })
      vi.unstubAllGlobals()
      rect.mockRestore()
      shadow.mockRestore()
    }
  },
)
