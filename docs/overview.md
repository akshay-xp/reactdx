# Overview

ReactDX: an unofficial React devtools extension for Chrome and Firefox. "RDT" means the official React DevTools.

## Pitch
DX first. It answers the questions RDT handles poorly: why something rendered, effect dependency changes, remounts, update triggers, and the server/client boundary. Speed is benchmarked but isn't the headline.

## Scope
- React 18 + 19. Development builds first.
- Editing props/state/hooks is required.
- Hook names are opt-in, the same as RDT.
- In scope: Server Components, multiple roots/copies.
- Out of scope: React Native, iframes, Electron.

## Architecture (planned)
- Page side: plain TS. Installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` (shared with RDT if both are installed) and reads fibers.
- Extension shell: MV3 content script (`world: "MAIN"`, `document_start`), service worker, devtools page.
- Panel: SolidJS.
- React is only a test/fixture dependency, never shipped.

## Permissions (planned)
- `scripting` and `storage`, plus a static `content_scripts` entry matching all sites. That means the same "all websites" install warning as RDT.
- Why not localhost plus per-site opt-in: runtime-registered scripts miss most first loads after a Chrome restart (M0 #5), and a "reload to connect" prompt is the kind of friction the DX pitch can't afford. All-site access also leaves room for production-build support later.
- Users can still narrow access with the browser's own per-site controls (Chrome site access, Firefox's revocable host permissions).
- The script runs on every page, so the `document_start` part stays tiny and does nothing until React connects. Heavier code is injected only after a renderer connects.
- No network access, remote code, or analytics.

## Store listing (planned)
- Says it's unofficial (not affiliated with Meta or the React team).
- Says it's open source (GPL v3), with a link to the repo, to offset the all-sites warning.

## Roadmap
GitHub milestones M0 (prototypes) through M9 (release). M0 results: [m0-findings.md](m0-findings.md).
