# Invariant checks (`scripts/check/`)

`pnpm check` enforces the invariants the permissions decision and the store listing rely on: the content script runs on every site, the Firefox manifest declares no data collection, and ReactDX promises nothing leaves the browser.

## Commands (from the repo root)

- `pnpm check`: `pnpm lint && pnpm typecheck && pnpm build && node scripts/check/run.ts`. Stops at the first failure.
- `pnpm test:check`: `node --test "scripts/check/*.test.ts"`. Each rule's planted-violation tests, plus clean runs of the real build, typecheck and lint. Part of `pnpm test`.

## Bundle rules (`scripts/check/bundles.ts`)

`checkBundle(dir)` scans every `.js`, `.html`, `.json` and `.css` file under a built extension and returns `<file>: <rule>` lines. `run.ts` runs it on `apps/extension/.output/chrome-mv3` and `firefox-mv3`, prefixes the target, exits 1 on any.

| Rule         | Match                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| React        | any React internals key (below)                                                                      |
| dynamic code | `eval(`, `Function(` (covers `new Function(`); a method call `.eval(` reports as `.eval`             |
| remote URL   | `http(s)://` or `ws(s)://`, except `http://www.w3.org/` (XML namespaces: Solid ships the MathML one) |
| network API  | `fetch`, `importScripts`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`                 |
| hook size    | `content-scripts/hook.js` over `MAX_HOOK_BYTES` (2,048); the only home of the budget                 |

- **CSS comments are stripped before the scan:** Tailwind's built CSS starts with `/*! tailwindcss v4.3.5 | MIT License | https://tailwindcss.com */`, which must stay; a comment never loads. `url(...)` in CSS and URLs in JS comments are still flagged.
- **React markers:** `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` (react/react-dom 18), `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` (react 19), `__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` (react-dom 19). Property keys, so minifiers keep them; present in dev and production builds. They are React internals (MIT) and may be renamed: the tests plant real React files from `test-env/*`, so a rename fails `pnpm test:check` when `test-env` is upgraded.
- **Network APIs are banned outright**, not just to non-extension origins: a static scan can't tell where a call goes. A feature that needs one adds an explicit allowlist here and documents it.
- **Panel allowlist (M4 #36, `ALLOWED` in `bundles.ts`), for `chunks/panel-*.js` only:** `network API (fetch)` (the inspected page's scripts and source maps, and its dev server's open-in-editor endpoints; docs/panel.md), `dynamic code (.eval)` (`devtools.inspectedWindow.eval("location.origin")`, which runs in the page; a bare `eval(` or `Function(` is still flagged there), and `remote URL (http://foo.com)` / `(http://foo.com/)` (`@jridgewell/resolve-uri`'s placeholder base for parsing relative paths, never requested). Every other file keeps the full ban.
- **Source maps without dynamic code:** `source-map-js` builds its sort with `new Function` (`lib/quick-sort.js`), which the extension CSP refuses and the check flags; the panel uses `@jridgewell/trace-mapping` (`source-map-js` is a test-only devDependency for building maps).
- **modulepreload polyfill:** WXT's polyfill chunk called `fetch` on preload links. `apps/extension/wxt.config.ts` sets `build.modulePreload.polyfill: false`; Chrome and Firefox 128+ preload natively (e2e passes in both without it).

## TypeScript (`pnpm typecheck`)

- TypeScript 7.0.2: `tsc -p . && tsc -p packages/panel && tsc -p apps/extension`.
- Root `tsconfig.json`: SnapQL's strict options, `types: ["node"]` (TypeScript 7 defaults `types` to `[]`). Covers `packages/page`, `e2e`, `scripts`, `fixtures/*.ts`, `fixtures/multi/serve.ts`, `vitest.config.ts`.
- `packages/panel/tsconfig.json` adds `jsx: preserve`, `jsxImportSource: solid-js`. Not in the root: Next (Turbopack) and esbuild read the nearest `tsconfig.json`, and compiled the React fixtures against `solid-js/jsx-dev-runtime`.
- `apps/extension/tsconfig.json` extends WXT's generated `.wxt/tsconfig.json` (created by `postinstall: wxt prepare`), adds the Solid JSX options and node types.
- `@types/react` and `@types/react-dom` are root devDependencies for `packages/page/test/commit.test.ts`.

## Lint and format (`pnpm lint`)

- Biome 2.6.6: `biome check --error-on-warnings` (lint, format, import order; warnings fail).
- `biome.json` copies SnapQL's style: 2-space indent, double quotes, semicolons as needed. Markdown is formatted too.
- `files.includes` excludes `pnpm-lock.yaml`.
- Fix locally with `pnpm exec biome check --write`.

## Key files

- `scripts/check/bundles.ts`, `scripts/check/run.ts`
- `scripts/check/bundles.test.ts`: planted violations per rule; clean real build.
- `scripts/check/repo.test.ts`: typecheck and lint pass clean and fail on a planted `packages/page/src/planted.ts`.
- `tsconfig.json`, `packages/panel/tsconfig.json`, `apps/extension/tsconfig.json`, `biome.json`

## Related

- `docs/extension.md`: the build being checked.
- `docs/overview.md`: the permissions decision behind these invariants.
