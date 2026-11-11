import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  CHROME_URL,
  cacheRoot,
  fetchBytes,
  lockPath,
  type RdtLock,
  sha256,
  unpack,
} from "./rdt.ts"

// Locks the latest RDT from both stores (they must agree on the version) and caches it.
const api = await fetchBytes(
  "https://addons.mozilla.org/api/v5/addons/addon/react-devtools/versions/?page_size=1",
)
const latest = JSON.parse(api.toString()).results[0] as {
  version: string
  file: { url: string; hash: string }
}
const firefox = await fetchBytes(latest.file.url)
if (`sha256:${sha256(firefox)}` !== latest.file.hash)
  throw new Error(`${latest.file.url} doesn't match AMO's ${latest.file.hash}`)
const chrome = await fetchBytes(CHROME_URL)

const versionOf = (bytes: Buffer) => {
  const dir = mkdtempSync(path.join(tmpdir(), "rdt-"))
  unpack(bytes, dir)
  return JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"))
    .version as string
}
const versions = { chrome: versionOf(chrome), firefox: versionOf(firefox) }
if (versions.chrome !== versions.firefox)
  throw new Error(
    `The stores disagree: Chrome has ${versions.chrome}, Firefox ${versions.firefox}`,
  )

const lock: RdtLock = {
  version: versions.chrome,
  firefox: { url: latest.file.url, sha256: sha256(firefox) },
  chrome: { sha256: sha256(chrome) },
}
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
unpack(chrome, path.join(cacheRoot, `chrome-${lock.version}`))
unpack(firefox, path.join(cacheRoot, `firefox-${lock.version}`))
console.log(`Locked RDT ${lock.version}`)
