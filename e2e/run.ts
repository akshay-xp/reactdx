import { spawnSync } from "node:child_process"

const flag = (name: string) =>
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3)

const browser = flag("browser")
const fixture = flag("fixture")
if (
  (browser !== "chrome" && browser !== "firefox") ||
  (fixture !== undefined && !["18", "19", "next", "multi"].includes(fixture))
) {
  console.error(
    "usage: pnpm test:e2e --browser=chrome|firefox [--fixture=18|19|next|multi]",
  )
  process.exit(1)
}

const build = spawnSync(
  "pnpm",
  ["--filter", "@reactdx/extension", `build:${browser}`],
  { stdio: "inherit" },
)
if (build.status !== 0) process.exit(build.status ?? 1)

const test = spawnSync(
  "node",
  ["--test", "--test-concurrency=1", "e2e/*.test.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      E2E_BROWSER: browser,
      ...(fixture && { E2E_FIXTURE: fixture }),
    },
  },
)
process.exit(test.status ?? 1)
