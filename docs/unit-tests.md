# Unit tests (`vitest.config.ts`)

Vitest 5.1.0 in jsdom 31.0.0. One suite, run once per React version.

## Commands (from the repo root)

- `pnpm test:unit`: `vitest run`, both projects.
- `pnpm test`: `pnpm test:unit`, `pnpm test:check` (`docs/check.md`), then each package's own `test` script (today only `apps/extension`'s build test).

## Projects

| Project    | React  | `process.env.REACT_VERSION` |
| ---------- | ------ | --------------------------- |
| `react-18` | 18.3.1 | `18.3.`                     |
| `react-19` | 19.3.1 | `19.`                       |

- Include glob: `packages/*/test/**/*.test.{ts,tsx}`. Every test runs in both projects, React or not.
- Each project aliases `^(react|react-dom)(/.*)?$` into `test-env/react-<n>/node_modules`.

## Why `test-env/*` packages, not npm aliases

`test-env/react-18` and `test-env/react-19` are private workspace packages holding only `react` + `react-dom`. The `react-18`/`react-19` npm aliases the Vite fixture uses fail here: Vitest externalizes react-dom (CommonJS), so its `require('react')` skips Vite's alias, and pnpm resolves the aliased react-dom's `react` peer to the other version (`react-dom@18.3.1_react@19.3.1`; React 18 crashes on `ReactCurrentDispatcher`). pnpm `overrides`, `packageExtensions` and Vitest `server.deps.inline` don't fix it. Separate packages make pnpm install `react-dom@18.3.1_react@18.3.1`. React stays out of `packages/*` and `apps/*` (checked by `fixtures/fixtures.test.ts`).

## Writing React tests

- Call `installHook(windowLike())` (`packages/page/test/window.ts`) before `mount()`, which imports `react-dom/client`: react-dom registers with the hook as it loads, and only once per module load, so each React scenario is its own test file. `windowLike()` gives `globalThis` a fresh prototype standing in for `Window.prototype`, where ReactDX's hook lives.
- Set `globalThis.IS_REACT_ACT_ENVIRONMENT = true` and wrap renders in `React.act` (exported by `react` in 18.3 and 19).
- Observe commits through the returned record's `listeners` (`docs/page.md`). React calls `onCommitFiberRoot` as `(rendererId, fiberRoot, priorityLevel, didError)`.

## Not covered yet

- `packages/panel`: no unit tests until it has content (M3). Rendering Solid in jsdom will need `vite-plugin-solid` in `vitest.config.ts`.

## Key files

- `vitest.config.ts`: projects and aliases.
- `test-env/react-18/package.json`, `test-env/react-19/package.json`.
- `packages/page/test/*.test.ts`: real roots committing through the hook in each install order (`docs/page.md`).

## Related

- `docs/e2e.md`: browser tests with the built extension.
- `docs/fixtures.md`: fixture apps.
