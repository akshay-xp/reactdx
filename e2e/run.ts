import { spawnSync } from "node:child_process"

const browser = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--browser="))
  ?.slice("--browser=".length)
if (browser !== "chrome" && browser !== "firefox") {
  console.error("usage: pnpm test:e2e --browser=chrome|firefox")
  process.exit(1)
}

const build = spawnSync("pnpm", ["build"], { stdio: "inherit" })
if (build.status !== 0) process.exit(build.status ?? 1)

const test = spawnSync("node", ["--test", "e2e/extension.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, E2E_BROWSER: browser },
})
process.exit(test.status ?? 1)
