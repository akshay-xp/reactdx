# Messages (`packages/messages`)

Message types and validators shared by the hook script, the relay content script and the background, plus what the toolbar shows. No dependencies; types only from `@reactdx/page`.

## Flow (M2 #20)

1. `hook.content.ts` (MAIN world, `document_start`): `installHook(window, onRenderer)`; `onRenderer` posts `rendererMessage(id, info)` with `window.postMessage(..., "*")`. One message per renderer, nothing before React connects.
2. `relay.content.ts` (ISOLATED world, `document_start`, top frame): ignores events whose `source` isn't its own window, drops anything `parsePageMessage` rejects, keeps the document's renderers in a `Map<id, RendererInfo>`, and sends `RenderersMessage` (`{ type: "renderers", renderers }`, the full list) with `runtime.sendMessage`.
3. `background.ts`: for `frameId === 0` with a tab, `toolbarState(renderers)` sets `action.setIcon({ tabId, path: toolbarIcons(icon) })` and `setTitle`.

- Full list per message, so the background holds no state (a sleeping service worker loses nothing); `sendMessage` wakes it. Ports come with the panel connection (#21).
- A page without React sends nothing: the manifest's default icon and title already say "no React", and both browsers reset per-tab action state on a new document (Chrome probed: reset on cross-document navigation, kept on `pushState`/hash changes). e2e checks both, and that the service worker receives no message on a non-React page.

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

**Trust:** the page shares the MAIN world with the hook, so any page script can post a message that passes. Validation guarantees shape and size, not origin. A forged renderer can at worst change that tab's icon and title; nothing interprets page data as HTML or code.

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
