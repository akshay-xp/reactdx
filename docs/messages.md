# Messages (`packages/messages`)

Message types and validators shared by the hook script, the relay content script and the background, plus what the toolbar shows. No dependencies; types only from `@reactdx/page`.

## Flow (M2 #20, #21)

1. `hook.content.ts` (MAIN world, `document_start`): `installHook(window, onRenderer)`; `onRenderer` posts `rendererMessage(id, info)` with `window.postMessage(..., "*")`. One message per renderer, nothing before React connects.
2. `relay.content.ts` (ISOLATED world, `document_start`, top frame) owns the document's state: renderers (`Map<id, RendererInfo>`) and the agent's latest roots. It ignores events whose `source` isn't its own window and drops anything `parsePageMessage` rejects. On every accepted message it sends a `TabStateMessage` (`{ type: "state", renderers: tabState(renderers, roots) }`, the full state) with `runtime.sendMessage`. On the first development renderer it also sends `{ type: "inject-agent" }`, once per document.
3. `background.ts`:
   - `state` from a tab's top frame: sets the toolbar (`toolbarState`) and forwards the message to that tab's panel ports.
   - `inject-agent`: `scripting.executeScript` of `/agent.js` into the MAIN world (Chrome pins `documentIds: [sender.documentId]`; Firefox targets frame 0).
   - Panel port (`name: "panel"`) sends `{ type: "subscribe", tabId }`: the background keeps the port in `Map<tabId, Set<Port>>` and asks the tab's relay with `tabs.sendMessage(tabId, { type: "get-state" }, { frameId: 0 })`, forwarding the reply. No relay (a browser page) means an empty list.
4. The relay answers `get-state` with its current state and, if it asked for the agent, posts `GET_SNAPSHOT` (`{ source: "reactdx-relay", type: "get-snapshot" }`) so the agent sends fresh counts.
5. The agent (`docs/page.md`) posts `snapshotMessage(roots)` at start, at most every 100 ms after commits, and on `get-snapshot`.

- The background holds only open panel ports, never page data: the relay owns state per document, so a sleeping service worker loses nothing and nothing stale survives a navigation. `sendMessage` wakes the worker.
- A page without React sends nothing on its own: the manifest's default icon and title already say "no React", and both browsers reset per-tab action state on a new document (Chrome probed: reset on cross-document navigation, kept on `pushState`/hash changes). It only answers `get-state` when a panel opens. e2e checks the service worker receives no message on a non-React page.

## Reconnects (M2 #22)

Nothing lives in the background, so every scenario is the panel or the relay asking or re-announcing. `e2e/reconnect.test.ts` covers each in both browsers.

| Scenario                                               | What happens                                                                            | Who re-sends                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background stopped (idle service worker or event page) | The panel's port drops. Per-tab toolbar state is the browser's, so it survives.         | The panel reconnects and subscribes; the background's `get-state` reaches the relay, which also asks the agent for a fresh snapshot. The relay's next `sendMessage` wakes the background on its own too.                        |
| Reload or navigation                                   | New document: new relay, new agent (counts start at 0); the browser resets the toolbar. | The panel's `onNavigated` clears and subscribes; the new relay's first `state` sets the toolbar and fills the panel. A page without React sends nothing, so the panel shows "No React on this page" and the toolbar stays grey. |
| bfcache restore                                        | Same document, state intact, but no scripts run and the browser reset the toolbar.      | The relay resends its state on `pageshow` with `persisted` (when it has renderers). The panel's `onNavigated` also subscribes again.                                                                                            |

## Page messages (`parsePageMessage(data)`)

`RendererMessage = { source: "reactdx", type: "renderer", id } & RendererInfo`. Returns a new object with only these fields, or `undefined` when:

| Field                 | Accepted                              |
| --------------------- | ------------------------------------- |
| the message           | a non-null object                     |
| `source`              | `"reactdx"`                           |
| `type`                | `"renderer"` (others are unknown)     |
| `id`                  | integer 1 to 64                       |
| `version`             | string, at most 64 chars              |
| `bundleType`          | `0` (production) or `1` (development) |
| `rendererPackageName` | string, at most 128 chars             |

`SnapshotMessage = { source: "reactdx", type: "snapshot", roots: RootInfo[] }`, `RootInfo = { rendererId, id, commits }`. Dropped when `roots` isn't an array or has more than 256 entries, or any root isn't an object with `rendererId` 1 to 64, `id` a positive safe integer, and `commits` a non-negative safe integer. Extra keys are stripped.

**Trust:** the page shares the MAIN world with the hook, so any page script can post a message that passes. Validation guarantees shape and size, not origin. A forged message can at worst change that tab's icon, title and panel list (or ask for the agent, which does nothing without a hook record); the panel renders page data as text only. `e2e/forged.test.ts` posts malformed, oversized (1,000 roots) and forged messages before and after React loads, in both browsers.

## Toolbar (`toolbarState(renderers)`, `toolbarIcons(icon)`)

| Renderers                        | Icon          | Title                                                                         |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| none                             | `none` (grey) | `ReactDX: no React`                                                           |
| any development (`bundleType` 1) | `development` | `ReactDX: React 18.3.1, 19.3.1` (development versions, unique, arrival order) |
| only production                  | `production`  | `ReactDX: React 19.3.1 (production build)`                                    |

- Mixed pages list development versions only: Next's dev overlay bundles a production react-dom next to the app's.
- `toolbarIcons(icon)`: `{ 16: "icon/<icon>-16.png", ... 128 }`, used by the manifest (`wxt.config.ts`) and the background.

## Key files

- `packages/messages/src/index.ts`, `packages/messages/test/messages.test.ts`.
- `apps/extension/entrypoints/hook.content.ts`, `relay.content.ts`, `background.ts`.
- `e2e/toolbar.test.ts`, `e2e/toolbar.ts` (`docs/e2e.md`).

## Related

- `docs/page.md`: `installHook(target, onRenderer)`.
- `docs/extension.md`: icons and manifest.
