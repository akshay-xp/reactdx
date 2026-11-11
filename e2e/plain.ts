import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before } from "node:test"

// A page without React, served for the whole test file; returns its URL getter.
export function plainPage() {
  const server = createServer((_, response) =>
    response
      .writeHead(200, { "content-type": "text/html" })
      .end("<p>No React here</p>"),
  )
  let url = ""
  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve))
    url = `http://localhost:${(server.address() as AddressInfo).port}/`
  })
  after(() => server.close())
  return () => url
}
