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
  (fixture !== undefined &&
    !["18", "19", "next", "multi", "prod"].includes(fixture))
) {
  console.error(
    "usage: pnpm test:e2e --browser=chrome|firefox [--fixture=18|19|next|multi|prod]",
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
  [
    "--test",
    "--test-concurrency=1",
    // A hung test fails on its own, so the run still prints every failure's details
    // (CI's job timeout would cancel it with none).
    "--test-timeout=120000",
    // A file whose browser or server outlives its tests would otherwise hold the run
    // open, and node --test only prints failure details at the very end.
    "--test-force-exit",
    "e2e/*.test.ts",
  ],
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
