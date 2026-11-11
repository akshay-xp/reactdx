# Extension (`apps/extension`)

WXT 0.21 app that builds the MV3 extension for Chrome and Firefox.

## Build

- `pnpm build` (root) runs `wxt build && wxt build -b firefox --mv3` in `apps/extension`. Outputs: `apps/extension/.output/chrome-mv3/`, `apps/extension/.output/firefox-mv3/`.
- `--mv3` is required: WXT builds Firefox as MV2 by default.
- Version comes from `apps/extension/package.json`.
- `apps/extension/test/build.test.ts` runs the build and checks the manifests and that the build prints no warnings (stdout and stderr). The hook size budget and other shipped-code invariants are in `pnpm check` (`docs/check.md`).

## Entrypoints

- `entrypoints/hook.content.ts`: static content script on `<all_urls>`, `world: "MAIN"`, `run_at: "document_start"`. Calls `installHook(window)` from `@reactdx/page`. WXT's wrapper calls `main()` synchronously, so the hook exists before any page script.
- `entrypoints/background.ts`: empty for now (service worker on Chrome, background script on Firefox).

## Hook script budget

- `content-scripts/hook.js` must be at most 2,048 bytes: it runs on every site (permissions decision in `docs/overview.md`).
- Measured: 610 bytes in both builds (M1 #14), WXT's content-script wrapper included.
- Enforced by `pnpm check` (`docs/check.md`).

## Manifest

- Permissions: `scripting`, `storage`. No `host_permissions`; the content script's `<all_urls>` match gives site access.
- Firefox only, `browser_specific_settings.gecko`:
  - `id: "reactdx@akxp.net"`: permanent once on AMO; same pattern as SnapQL (`snapql@akxp.net`).
  - `strict_min_version: "128.0"`: first Firefox with `world: "MAIN"` content scripts.
  - `data_collection_permissions: { required: ["none"] }`: required for new AMO extensions; ReactDX sends no data.

## Devtools page and panel

- `entrypoints/devtools/`: `devtools_page`. Calls `browser.devtools.panels.create('ReactDX', '', '/panel.html')`, then logs `[reactdx] panel created` (the e2e signal; see `docs/e2e.md`).
- `entrypoints/panel/`: `panel.html`, renders `Panel` from `@reactdx/panel` (Solid, via `@wxt-dev/module-solid`). `main.tsx` applies the DevTools theme first (`theme.ts`, `docs/panel.md`). `Panel` is an empty themed `<main data-testid="panel-root">` for now.
- Tailwind CSS 4.3.5 through `@tailwindcss/vite` in `wxt.config.ts`'s `vite.plugins`; the CSS is `@reactdx/panel/index.css`. `test/build.test.ts` checks the built CSS reads `--theme-*` and has no default palette.

## Manual check (M1 #10, 2026-11-10, macOS 26.5)

- Chromium 158.0.8127.18, unpacked `chrome-mv3`, DevTools auto-opened: the devtools page target logs `[reactdx] panel created` (read over CDP with `Runtime.enable`), and `chrome-extension://<id>/panel.html` renders `panel-root`.
- Firefox 159.0.1, `web-ext run --source-dir apps/extension/.output/firefox-mv3 --arg=-devtools --pref devtools.console.stdout.chrome=true`: installs as `reactdx@akxp.net`, and stdout shows `console.log: "[reactdx] panel created"`. The ReactDX tab was not checked by eye (no screen access in that session).

## Related

- `docs/check.md`: invariant checks on the built extension.
- `packages/page/src/hook.ts`: the hook itself.
- `docs/m0-findings.md`: why a static content script, and why `document_start` in the MAIN world.
