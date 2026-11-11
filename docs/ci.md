# CI (`.github/workflows/ci.yml`)

GitHub Actions, on pushes to `main` and on every pull request. `concurrency: ci-<ref>` cancels a superseded run.

## Jobs

All on `ubuntu-latest`, Node 24, via `.github/actions/setup`.

| Job                                                       | Runs                                                                                                                 | Browsers |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| `lint`                                                    | `pnpm lint`                                                                                                          | none     |
| `tsc`                                                     | `pnpm typecheck`                                                                                                     | none     |
| `unit` × react `18`, `19`                                 | `pnpm test:unit --project react-<n>`                                                                                 | none     |
| `build` × `chrome`, `firefox`                             | `pnpm --filter @reactdx/extension build:<browser>`                                                                   | none     |
| `check`                                                   | `pnpm build`, `pnpm check:bundles`, `pnpm test:check`, `pnpm --filter @reactdx/extension test`, `pnpm test:fixtures` | chrome   |
| `e2e` × `chrome`, `firefox` × `18`, `19`, `next`, `multi` | `xvfb-run -a pnpm test:e2e --browser=<b> --fixture=<f>`                                                              | that one |

- `check` carries the planted-violation tests (`docs/check.md`), the build test (`docs/extension.md`) and the fixture smoke test, whose React-only-in-fixtures guard must run in CI too. `lint` and `tsc` are separate jobs rather than `pnpm check`, so they don't run twice.
- `multi` is a fourth e2e column beyond the spec's {18, 19, Next}: the two-React-copies page is an M1 fixture and would otherwise never run in CI.
- Matrices use `fail-fast: false`, so one failing cell doesn't hide the others. `e2e` has `timeout-minutes: 15`.

## Setup action (`.github/actions/setup/action.yml`)

Input `browsers`: `none` (default), `chrome`, or `firefox`.

- pnpm (`pnpm/action-setup`, version from `packageManager`), Node 24 with the pnpm store cache, `pnpm install --frozen-lockfile`.
- `pnpm install` runs with `PUPPETEER_SKIP_DOWNLOAD=true`, then `pnpm exec puppeteer browsers install <browser>` installs the job's browser at Puppeteer's pinned version. Not postinstall: a restored pnpm store can skip Puppeteer's postinstall, which left `e2e (chrome, next)` with no Chrome (run 42975206720).
- With browsers: `~/.cache/puppeteer` cached on `puppeteer-<os>-<browsers>-<hash of pnpm-lock.yaml, .puppeteerrc.cjs>`, restored before install.
- With browsers: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. Ubuntu 24.04's AppArmor blocks the user namespaces Chrome's sandbox needs; this is Puppeteer's documented fix and keeps `--no-sandbox` out of the code.
- `e2e` caches `e2e/.rdt` keyed `rdt-<hash of e2e/rdt.lock.json>`, so RDT downloads only when the lock changes. If the cache is evicted (7 days unused) after the Chrome Web Store moved past the locked build, the job fails with the `pnpm rdt:update` message.
- e2e runs headed under `xvfb-run -a` (DevTools only exists headed; `docs/e2e.md`).

## Conventions (from SnapQL)

- Third-party actions pinned to a commit SHA with a `# vX.Y.Z` comment. Bump both together.
- `permissions: contents: read`.
- Lint the workflow locally with actionlint (release binary; not a repo dependency).

## Related

- `docs/e2e.md`, `docs/check.md`, `docs/unit-tests.md`, `docs/extension.md`
