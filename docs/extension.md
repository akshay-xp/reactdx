# Extension (`apps/extension`)

WXT 0.21 app that builds the MV3 extension for Chrome and Firefox.

## Build
- `pnpm build` (root) runs `wxt build && wxt build -b firefox --mv3` in `apps/extension`. Outputs: `apps/extension/.output/chrome-mv3/`, `apps/extension/.output/firefox-mv3/`.
- `--mv3` is required: WXT builds Firefox as MV2 by default.
- Version comes from `apps/extension/package.json`.
- `apps/extension/test/build.test.ts` runs the build and checks the manifests, the hook script size, and that the build prints no warnings (stdout and stderr).

## Entrypoints
- `entrypoints/hook.content.ts`: static content script on `<all_urls>`, `world: "MAIN"`, `run_at: "document_start"`. Calls `installHook(window)` from `@reactdx/page`. WXT's wrapper calls `main()` synchronously, so the hook exists before any page script.
- `entrypoints/background.ts`: empty for now (service worker on Chrome, background script on Firefox).

## Hook script budget
- `content-scripts/hook.js` must be at most 2,048 bytes: it runs on every site (permissions decision in `docs/overview.md`).
- Measured: 597 bytes in both builds (M1 #10). WXT's wrapper is about 400 of those.

## Manifest
- Permissions: `scripting`, `storage`. No `host_permissions`; the content script's `<all_urls>` match gives site access.
- Firefox only, `browser_specific_settings.gecko`:
  - `id: "reactdx@akxp.net"`: permanent once on AMO; same pattern as SnapQL (`snapql@akxp.net`).
  - `strict_min_version: "128.0"`: first Firefox with `world: "MAIN"` content scripts.
  - `data_collection_permissions: { required: ["none"] }`: required for new AMO extensions; ReactDX sends no data.

## Related
- `packages/page/src/hook.ts`: the hook itself.
- `docs/m0-findings.md`: why a static content script, and why `document_start` in the MAIN world.
