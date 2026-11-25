import { parseInspected } from "@reactdx/messages"
import React from "react"
import { expect, test } from "vitest"
import { inspecting } from "./inspecting.ts"
import { react19, server, serverInfo } from "./server.ts"

const h = React.createElement
const { inspect, idOf, replies, mount } = inspecting()

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
