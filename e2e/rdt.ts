import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import type { BrowserName } from "./launch.ts"

// The official React DevTools, pinned like a dependency (`pnpm rdt:update` bumps it).
export type RdtLock = {
  version: string
  firefox: { url: string; sha256: string }
  chrome: { sha256: string }
}

// The Chrome Web Store only serves the latest build, so Chrome is pinned by hash.
export const CHROME_URL =
  "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=156.0&acceptformat=crx2,crx3&x=id%3Dfmkadmapgofadopljbjfkapdkoienihi%26uc"
const STORE = { chrome: "Chrome Web Store", firefox: "Firefox add-ons site" }
const here = import.meta.dirname
export const lockPath = path.join(here, "rdt.lock.json")
export const cacheRoot = path.join(here, ".rdt")

export const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex")

export async function fetchBytes(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

// CRX and XPI are zip archives (a CRX has a header unzip skips with exit code 1).
export function unpack(bytes: Buffer, dir: string) {
  mkdirSync(dir, { recursive: true })
  const archive = path.join(dir, "rdt.zip")
  writeFileSync(archive, bytes)
  try {
    execFileSync("unzip", ["-q", "-o", archive, "-d", dir], { stdio: "ignore" })
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error
  }
  rmSync(archive)
}

// Returns the unpacked locked RDT build, downloading it only when not cached.
export async function ensureRdt(
  browser: BrowserName,
  {
    root = cacheRoot,
    lock = JSON.parse(readFileSync(lockPath, "utf8")) as RdtLock,
    download = fetchBytes,
  } = {},
) {
  const dir = path.join(root, `${browser}-${lock.version}`)
  if (existsSync(path.join(dir, "manifest.json"))) return dir
  const bytes = await download(
    browser === "chrome" ? CHROME_URL : lock.firefox.url,
  )
  const got = sha256(bytes)
  if (got !== lock[browser].sha256)
    throw new Error(
      `RDT from the ${STORE[browser]} isn't the locked ${lock.version} (sha256 ${got}); run pnpm rdt:update`,
    )
  unpack(bytes, dir)
  return dir
}
