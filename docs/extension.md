# Extension (`apps/extension`)

WXT 0.21 app that builds the MV3 extension for Chrome and Firefox.

## Build

- `pnpm build` (root) runs `wxt build && wxt build -b firefox --mv3` in `apps/extension`. Outputs: `apps/extension/.output/chrome-mv3/`, `apps/extension/.output/firefox-mv3/`.
- `--mv3` is required: WXT builds Firefox as MV2 by default.
- Version comes from `apps/extension/package.json`.
- `apps/extension/test/build.test.ts` runs the build and checks the manifests and that the build prints no warnings (stdout and stderr). The hook size budget and other shipped-code invariants are in `pnpm check` (`docs/check.md`).

## Entrypoints

- `entrypoints/hook.content.ts`: static content script on `<all_urls>`, `world: "MAIN"`, `run_at: "document_start"`. Calls `installHook(window, onRenderer)` from `@reactdx/page`, posting each renderer to the relay. WXT's wrapper calls `main()` synchronously, so the hook exists before any page script.
- `entrypoints/relay.content.ts`: ISOLATED world, `<all_urls>`, `document_start`, top frame only. Validates page messages, owns the document's tab state, asks for the agent on the first development renderer, answers `get-state`, and while a panel watches streams tree batches over a `tree` port (`docs/messages.md`, "Tree flow").
- `entrypoints/agent.ts`: unlisted script, built to `agent.js`; `startAgent(window, post)` from `@reactdx/page/agent`. Injected by the background with `scripting.executeScript` (MAIN world, top frame), never at `document_start`.
- `entrypoints/background.ts`: toolbar icon and title per tab, agent injection, and relaying tab state and tree batches to open panels' ports, plus panel resync requests to the relay (service worker on Chrome, background script on Firefox). Holds no page data, only ports.

## Toolbar icons

- States: `none` (grey `#9aa0a6`, the manifest default, title `ReactDX: no React`), `development` (`#0b57d0`, also the extension icon), `production` (`#188038`). Titles and the mapping: `docs/messages.md`.
- `apps/extension/icon.svg` (placeholder art, branding is M9) with a `{{color}}` placeholder; `pnpm icons` (`scripts/icons.ts`, `@resvg/resvg-js`) renders `public/icon/<state>-<16|32|48|128>.png`, committed. Rerun after changing the SVG or colors.
- `test/build.test.ts` checks the manifest's `action` and `icons` and every PNG's size.
- Per-tab state resets on a new document in both browsers; bfcache restore is #22.

## Hook script budget

- `content-scripts/hook.js` must be at most 2,048 bytes: it runs on every site (permissions decision in `docs/overview.md`).
- Measured: 1,703 bytes in both builds (M2 #20), WXT's content-script wrapper included.
- Enforced by `pnpm check` (`docs/check.md`).

## Manifest

- Permissions: `scripting`, `storage`, `host_permissions: ["<all_urls>"]`.
- `host_permissions` result (M2 #21, Chrome 157 / Firefox 159): without it, Chrome's `scripting.executeScript` into a page fails with "Cannot access contents of the page. Extension manifest must request permission to access the respective host." even though the `<all_urls>` content scripts run there; Firefox injects without it. Adding it changes no install warning (the content scripts already ask for all sites).
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
