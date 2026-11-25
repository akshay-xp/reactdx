import { parseInspected } from "@reactdx/messages"
import React from "react"
import { expect, test } from "vitest"
import { inspecting } from "./inspecting.ts"
import { react19, server, serverInfo } from "./server.ts"

const h = React.createElement
const { inspect, idOf, replies } = inspecting()

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
