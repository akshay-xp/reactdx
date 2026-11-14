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

## Tree flow (M3 #25)

The tree streams only while a panel watches the tab. Closing the relay's `tree` port is the only unwatch signal, so the background still keeps no tree state.

1. **Start.** A panel's `subscribe` reaches the relay as `get-state`; if the relay asked for the agent, it opens a `runtime.connect({ name: "tree" })` port and posts `WATCH` to the agent. If it already watches, it posts `WATCH` again: a subscribing panel starts empty and needs the whole tree.
2. **A document that loads under an open panel** (DevTools opened before load, navigation, reload, bfcache restore): the background replies to each `state` with `StateReply` `{ watch: panels.has(tabId) }`; `watch: true` starts a watch (a no-op if already watching, since `state` arrives on every snapshot).
3. **Agent injected after the watch:** the relay re-posts `WATCH` on the first snapshot it sees.
4. **Batches:** the relay forwards whatever passes `parseTreeBatch` to its tree port, without storing it (checked before `parsePageMessage`, which doesn't dispatch `tree`). The background keeps `trees: Map<tabId, Port>` (top frame only; a new port replaces the old) and forwards each batch to the tab's panel ports; with no panel left it disconnects the tree port.
5. **Resync:** the panel's store (`docs/panel.md`) reports a seq gap or an unknown id; the panel sends `ResyncMessage` `{ type: "resync", tabId }` over its port, the background posts `{ type: "resync" }` to the tree port, and the relay re-posts `WATCH`.
6. **Stop:** when the tab's last panel port closes, the background disconnects the tree port. The relay posts `UNWATCH` whenever its port disconnects (that, the background stopping, or bfcache), so the agent stops diffing.

7. **Highlight** (M3 #28): when the panel's hovered row changes (`docs/panel.md`), it sends `HighlightMessage` `{ type: "highlight", tabId, id }` or `ClearHighlightMessage` `{ type: "clear-highlight", tabId }` over its port. The background strips `tabId` and posts the command to the tab's tree port without reading it. The relay keeps only what `parseTreeCommand` accepts and posts `highlight(id)` or `CLEAR_HIGHLIGHT` to the agent (`docs/page.md`, "Highlight"). Closing the panel needs no command: the unwatch that follows hides the overlay.

8. **Picker** (M3 #29): the panel's toggle sends `PickMessage` `{ type: "pick-start" | "pick-stop", tabId }`, forwarded like highlight. The agent's result, `PickedMessage` `{ source: "reactdx", type: "picked", id }` (`id` null: Escape, or a click on nothing React owns), passes the relay's `parsePicked` (checked before `parsePageMessage`, with `parseTreeBatch`) and goes over the tree port; the background forwards tree-port messages to the tab's panels as for batches. The panel applies it with `tree.picked(id)`.

9. **Inspect** (M4 #33): when the selection changes, the panel sends `InspectMessage` `{ type: "inspect", tabId, id }` (`id` null: nothing selected), and `ExpandMessage` `{ type: "expand", tabId, objectId, offset }` to load an object, forwarded like highlight. The agent's `inspected` and `expanded` replies pass the relay's `parseInspected` / `parseExpanded` and go over the tree port to the panels like batches. The agent's inspection ends on `unwatch`, so the panel inspects again when a batch starting with `reset` arrives (a new watch).

- **bfcache:** Chrome closes the port when the page enters bfcache but delivers the disconnect only after the restore, after `pageshow` already tried to watch. So the relay closes its own port on a persisted `pagehide`.
- **Forged commands:** a page can post `UNWATCH` itself and stop its own tree updates (it shares the world with the hook, as in M2). Forged `WATCH` only causes a resync. `e2e/forged.test.ts` leaves `UNWATCH` out.

- The background holds only open panel ports, never page data: the relay owns state per document, so a sleeping service worker loses nothing and nothing stale survives a navigation. `sendMessage` wakes the worker.
- A page without React sends nothing on its own: the manifest's default icon and title already say "no React", and both browsers reset per-tab action state on a new document (Chrome probed: reset on cross-document navigation, kept on `pushState`/hash changes). It only answers `get-state` when a panel opens. e2e checks the service worker receives no message on a non-React page.

## Reconnects (M2 #22)

Nothing lives in the background, so every scenario is the panel or the relay asking or re-announcing. `e2e/reconnect.test.ts` covers each in both browsers.

| Scenario                                               | What happens                                                                                                                                                         | Who re-sends                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background stopped (idle service worker or event page) | The panel's port drops. Per-tab toolbar state is the browser's, so it survives.                                                                                      | The panel reconnects and subscribes; the background's `get-state` reaches the relay, which also asks the agent for a fresh snapshot. The relay's next `sendMessage` wakes the background on its own too.                                                                                                                                                                                                                              |
| Reload or navigation                                   | New document: new relay, new agent (counts start at 0); the browser resets the toolbar.                                                                              | The panel's `onNavigated` clears and subscribes; the new relay's first `state` sets the toolbar and fills the panel. A page without React sends nothing, so the panel shows "No React on this page" and the toolbar stays grey.                                                                                                                                                                                                       |
| bfcache restore                                        | Same document, state intact, but no scripts run and the browser reset the toolbar.                                                                                   | The relay resends its state on `pageshow` with `persisted` (when it has renderers). The panel's `onNavigated` also subscribes again.                                                                                                                                                                                                                                                                                                  |
| Prerendered page (Chrome)                              | Chrome loads a page it expects you to open (a typed URL you visit often, speculation rules) before it is in the tab, then swaps it in. DevTools open turns this off. | Nothing during prerender: the relay keeps collecting renderers but holds every message to the background (state, `inject-agent`) until `prerenderingchange`, then sends them. Sent earlier, they were lost: grey icon, no agent, a panel listing the copy with no root (fixed 2026-11-12).                                                                                                                                            |
| Tab open before install or update                      | The page loaded without the hook, so React never connected. Chrome doesn't inject content scripts into open tabs; Firefox does, but after React loaded.              | No one can: React only looks for the hook as it loads. `onInstalled` titles open web tabs `STALE_TITLE` ("ReactDX: reload this page to check for React"). The panel gets `stale: true`, from the relay when it ran after `document_start` (`document.readyState` not `loading`, Firefox), or from the background when no relay answers on an `http(s):`/`file:` page (Chrome), and offers "Reload page" (`inspectedWindow.reload()`). |

The tree follows the same paths (Tree flow above): the background stopping or bfcache closes the relay's tree port, so the agent unwatches; the panel's subscribe (or the state reply, for a new or restored document) starts a new watch, whose first batch is a full resync. `e2e/reconnect.test.ts` checks the tree and a click's change in every scenario.

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

## Tree batches (`parseTreeBatch(data)`; M3 #24)

The agent's component tree (`docs/page.md`, "Tree"), posted only while watched ("Tree flow" above). The relay checks `parseTreeBatch` first; `parsePageMessage` doesn't dispatch `tree`.

- `WATCH` / `UNWATCH` (`{ source: "reactdx-relay", type: "watch" | "unwatch" }`): content script to agent, through the page.
- `TreeBatchMessage = { source: "reactdx", type: "tree", seq, ops: TreeOp[] }`, built with `treeBatch(seq, ops)`. `seq` restarts at 1 on every watch, whose first batch starts with `reset`.
- `TreeOp`:
  - `{ op: "reset" }`
  - `{ op: "add", id, parentId, rootId, kind, name, key, index }`: `parentId` 0 is the root's top level; `index` is the position among the parent's children once earlier ops apply.
  - `{ op: "remove", id }`: removes descendants too.
  - `{ op: "reorder", rootId, parentId, children }`: the parent's full child id list.
  - `{ op: "rename", id, name }`

Any invalid op drops the whole batch (a partial batch would desync the mirror). Extra keys are stripped.

| Field               | Accepted                                      |
| ------------------- | --------------------------------------------- |
| `seq`               | positive safe integer                         |
| `ops`               | array of 1 to 2,000 (`MAX_OPS`)               |
| `id`, `rootId`      | positive safe integer                         |
| `parentId`, `index` | non-negative safe integer                     |
| `kind`              | a `TreeKind` (`docs/page.md`)                 |
| `name`              | string, at most 256 chars (`MAX_TREE_STRING`) |
| `key`               | `null` or string, at most 256 chars           |
| `children`          | array of at most 10,000 positive ids          |

## Tree port commands (`parseTreeCommand(data)`; M3 #28)

Background to the relay's tree port. Everything the relay acts on passes through it, so a malformed command never reaches the page.

| Command                                           | Relay posts to the agent                                              |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `{ type: "resync" }`                              | `WATCH`                                                               |
| `{ type: "highlight", id }`                       | `highlight(id)`: `{ source: "reactdx-relay", type: "highlight", id }` |
| `{ type: "clear-highlight" }`                     | `CLEAR_HIGHLIGHT`                                                     |
| `{ type: "pick-start" }`                          | `PICK_START`                                                          |
| `{ type: "pick-stop" }`                           | `PICK_STOP`                                                           |
| `{ type: "inspect", id }`                         | `{ source: "reactdx-relay", type: "inspect", id }`                    |
| `{ type: "expand", objectId, offset }`            | `{ source: "reactdx-relay", type: "expand", objectId, offset }`       |
| `{ type: "copy-value" \| "store-value", target }` | `{ source: "reactdx-relay", type, target }`                           |

- The relay posts every command but `resync` as `{ source: "reactdx-relay", ...command }`: what `parseTreeCommand` returns has only the known fields.
- `inspect`'s `id` may be `null`; `expand`'s `objectId` is a positive safe integer and `offset` a non-negative one.
- `copy-value` / `store-value` (`ValueMessage` from the panel, with `tabId`): `target` is a `ValueTarget` (`parseValueTarget`, `src/inspect.ts`), only its known fields kept: `{ objectId, key? }` (`objectId` positive; `key` a non-negative safe integer or a string up to 1,000 chars), `{ hook }` (1 to 8 non-negative safe integers), or `{ context }` (non-negative safe integer).

- `id`: positive safe integer. Anything else (no id, a string, 0, a fraction, an unsafe integer, an unknown type, a non-object) is dropped. Extra keys are stripped.
- `parsePicked(data)`: `source: "reactdx"`, `type: "picked"`, `id` a positive safe integer or `null`; anything else dropped, extra keys stripped. Built with `picked(id)`.
- `packages/messages/test/commands.test.ts`.

## Inspected values (`src/inspect.ts`, re-exported; M4 #33)

The agent's `inspected` and `expanded` replies carry `Value` descriptors (`docs/page.md`, "Values"). The page can forge them, so each is checked whole before the panel sees it.

- `parseValue(data)`: a fresh copy with only known fields, or `undefined`. Primitives: finite numbers, booleans, `null`, strings up to 1,000 chars. Descriptors by `type`, each field checked: names (`function`, class names, tags, element names and keys, symbol descriptions, error names) up to 256 chars, other strings up to 1,000, counts non-negative safe integers, ids positive.
- Containers (`object`, `array`, `typed-array`, `map`, `set`): at most 100 entries in a page (props, items, entries, values), `nextOffset` a positive id, nested at most 4 deep, at most 50,000 values in one message. Map entries are `[key, value]` pairs.
- `parseInspected`: `{ source: "reactdx", type: "inspected", id, data }`, `data` null or `{ props, state?, hooks?, hooksError? }` (one 50,000-value budget). `hooks`: `HookValue` `{ name, value?, hooks?, site? }` trees (M4 #34; `site`, a `CallSite` `{ url, line, column }` with the same limits as `source`'s url form, M4 #37), at most 200 hooks in all, groups nested at most 8 deep, names up to 256 chars; `hooksError` up to 1,000. `contexts`: at most 50 `{ name, value }` (M4 #35). `owners`: at most 50 `{ id, name }`, `id` a positive safe integer or null (not in the tree). `source` (`SourceRef`, M4 #36): `{ file, line, column }` or `{ url, line, column }`, exactly one of `file`/`url`, non-empty and up to 1,000 chars, `line`/`column` positive safe integers. `parseExpanded`: `{ source: "reactdx", type: "expanded", objectId, offset, value }`. Builders `inspected(id, data)`, `expanded(objectId, offset, value)`.
- `parseValueText`: `{ source: "reactdx", type: "value-text", text }`, `text` a string up to `MAX_COPY` (10,000,000) chars; builder `valueText(text)`. The relay forwards it over the tree port like `expanded`. The panel copies it only as the reply to its own Copy value (`docs/panel.md`, Inspector store).
- `parseValueStored`: `{ source: "reactdx", type: "value-stored", name }`, `name` matching `$reactdx<n>` (`n` from 1, up to 9 digits); builder `valueStored(name)`. Forwarded like `value-text`; the panel shows it only as the reply to its own store.
- `packages/messages/test/inspect.test.ts`: every descriptor kept, each bound dropped.

## Toolbar (`toolbarState(renderers)`, `toolbarIcons(icon)`)

| Renderers                        | Icon          | Title                                                                         |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| none                             | `none` (grey) | `ReactDX: no React`                                                           |
| any development (`bundleType` 1) | `development` | `ReactDX: React 18.3.1, 19.3.1` (development versions, unique, arrival order) |
| only production                  | `production`  | `ReactDX: React 19.3.1 (production build)`                                    |

- Mixed pages list development versions only: Next's dev overlay bundles a production react-dom next to the app's.
- `toolbarIcons(icon)`: `{ 16: "icon/<icon>-16.png", ... 128 }`, used by the manifest (`wxt.config.ts`) and the background.

## Key files

- `packages/messages/src/inspect.ts`, `packages/messages/test/inspect.test.ts`.
- `packages/messages/src/index.ts`, `packages/messages/test/messages.test.ts`, `packages/messages/test/tree.test.ts`, `packages/messages/test/commands.test.ts`.
- `apps/extension/entrypoints/hook.content.ts`, `relay.content.ts`, `background.ts`.
- `e2e/toolbar.test.ts`, `e2e/toolbar.ts` (`docs/e2e.md`).

## Related

- `docs/page.md`: `installHook(target, onRenderer)`.
- `docs/extension.md`: icons and manifest.
