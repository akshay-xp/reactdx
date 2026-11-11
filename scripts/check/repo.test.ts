import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"

const repo = path.resolve(import.meta.dirname, "../..")
const planted = path.join(repo, "packages/page/src/planted.ts")

function run(script: string) {
  const result = spawnSync("pnpm", [script], { cwd: repo, encoding: "utf8" })
  return { status: result.status, output: result.stdout + result.stderr }
}

function withPlanted(content: string, check: () => void) {
  writeFileSync(planted, content)
  try {
    check()
  } finally {
    rmSync(planted, { force: true })
  }
}

test("typecheck passes, and fails on a planted type error", () => {
  const clean = run("typecheck")
  assert.equal(clean.status, 0, clean.output)
  withPlanted("export const n: number = 'x';\n", () => {
    const broken = run("typecheck")
    assert.notEqual(broken.status, 0)
    assert.match(broken.output, /planted\.ts/)
  })
})

test("lint passes, and fails on a planted lint or format error", () => {
  const clean = run("lint")
  assert.equal(clean.status, 0, clean.output)
  for (const content of ["debugger\n", "export const a = 'x';\n"]) {
    withPlanted(content, () => {
      const broken = run("lint")
      assert.notEqual(broken.status, 0, content)
      assert.match(broken.output, /planted\.ts/)
    })
  }
})
