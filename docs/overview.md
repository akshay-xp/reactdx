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
`scripting` and `storage`. Host access to localhost at install. Other sites are enabled per site through optional host permissions. No remote code or analytics.

## Roadmap
GitHub milestones M0 (prototypes) through M9 (release).
