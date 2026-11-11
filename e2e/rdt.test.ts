import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { ensureRdt, type RdtLock } from "./rdt.ts"

const lock: RdtLock = {
  version: "8.0.0",
  firefox: { url: "https://example.test/rdt.xpi", sha256: "0".repeat(64) },
  chrome: { sha256: "0".repeat(64) },
}
const offline = () => Promise.reject(new Error("network used"))

test("a cached RDT is used without the network", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "rdt-"))
  const dir = path.join(root, "chrome-8.0.0")
  mkdirSync(dir)
  writeFileSync(path.join(dir, "manifest.json"), "{}")
  assert.equal(
    await ensureRdt("chrome", { root, lock, download: offline }),
    dir,
  )
})

test("a download that isn't the locked build fails and caches nothing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "rdt-"))
  await assert.rejects(
    ensureRdt("firefox", {
      root,
      lock,
      download: async () => Buffer.from("not rdt"),
    }),
    /isn't the locked 8\.0\.0 .*run pnpm rdt:update/,
  )
  assert.equal(existsSync(path.join(root, "firefox-8.0.0")), false)
})
