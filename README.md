# ReactDX

A browser extension for inspecting React apps, built around developer experience: clear answers to why a component rendered, why an effect ran, why something remounted, and what triggered an update.

> **Unofficial.** ReactDX is not affiliated with or endorsed by Meta or the React team.

## Status

M1 (foundation): the extension builds for Chrome and Firefox and opens an empty ReactDX panel. Not usable yet. See the [milestones](https://github.com/akshay-xp/reactdx/milestones) for the roadmap.

## Scope

- React 18 and 19, development builds first
- Chrome and Firefox (Manifest V3)
- Server Components, and multiple roots or React copies on one page
- Not supported: React Native, iframes, Electron

## Setup

- Node 24 or newer.
- pnpm 10, through Corepack: `corepack enable` (the version comes from `packageManager` in `package.json`).
- `pnpm install`. This also downloads Puppeteer's Chrome and Firefox for the browser tests.

## Commands

Run from the repo root.

| Command                                                          | What it does                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm build`                                                     | Builds `apps/extension/.output/chrome-mv3` and `firefox-mv3`                            |
| `pnpm test`                                                      | Unit tests, check tests, and each package's tests (build test, benchmark stats)         |
| `pnpm test:unit`                                                 | Vitest in jsdom, once on React 18 and once on React 19                                  |
| `pnpm test:check`                                                | Tests that each invariant check fails on a planted violation                            |
| `pnpm test:fixtures`                                             | Smoke test of every fixture app, without the extension                                  |
| `pnpm test:e2e --browser=chrome\|firefox [--fixture=…]`          | Loads the built extension in a real browser against the fixtures (opens windows)        |
| `pnpm check`                                                     | `lint`, `typecheck`, `build`, then `check:bundles`                                      |
| `pnpm check:bundles`                                             | Scans the build for React, remote code, `eval`, network calls, and the hook size budget |
| `pnpm lint`                                                      | Biome lint and format check (`pnpm exec biome check --write` fixes)                     |
| `pnpm typecheck`                                                 | Strict TypeScript over the workspace                                                    |
| `pnpm fixture:18`, `fixture:19`, `fixture:next`, `fixture:multi` | Serves a fixture app on 5218, 5219, 5220, 5221                                          |
| `pnpm bench:hook-cost`                                           | Per-commit hook cost benchmark, Chromium only (opens windows)                           |

## Loading the build

- **Chrome:** `chrome://extensions`, turn on Developer mode, Load unpacked, choose `apps/extension/.output/chrome-mv3`.
- **Firefox:** `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, choose `apps/extension/.output/firefox-mv3/manifest.json`.

Open DevTools on a page with React and pick the ReactDX tab.

## Docs

- [Overview](docs/overview.md): goals, architecture, permissions.
- Modules: [page](docs/page.md), [extension](docs/extension.md), [fixtures](docs/fixtures.md), [unit tests](docs/unit-tests.md), [e2e](docs/e2e.md), [checks](docs/check.md), [CI](docs/ci.md), [benchmark](docs/bench.md).
- [M0 findings](docs/m0-findings.md).

## License

[GPL v3](LICENSE)
