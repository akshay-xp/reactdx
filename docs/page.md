# Page (`packages/page`)

Code that runs in the page's MAIN world: installing the React DevTools global hook, recording what React registers, and (in the injected agent) reading the component tree.

## Rules

- The hook (`src/hook.ts`) has no runtime dependencies (only types from `@reactdx/messages`): it's bundled into the `document_start` script that runs on every site, which `pnpm check` holds to 2,048 bytes (`docs/check.md`). Measured: 1,703 bytes (M2 #20).
- Never imports React; React only reaches it through the hook (`docs/check.md` fails any bundle containing React).

## Installer (`installHook(target, onRenderer?)`, `src/hook.ts`)

React connects to whichever `__REACT_DEVTOOLS_GLOBAL_HOOK__` exists when it loads. RDT 8 won't install its hook when one is already `window`'s own property (it checks `hasOwnProperty` twice), so ReactDX never claims that property. Three paths, all tested against the store RDT in both browsers (`docs/e2e.md`):

| Situation                                             | What `installHook` does                                                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A hook is already `window`'s own property (RDT first) | Attaches to it. RDT defines it with a getter, so the check reads `target[KEY]`, not the descriptor's `value`.                                                                                                                          |
| No hook yet (ReactDX first)                           | Creates ours and defines it on `Object.getPrototypeOf(target)` (`Window.prototype`) as a configurable accessor. React finds it through the prototype chain; RDT's `hasOwnProperty` checks don't, so RDT installs normally on `window`. |
| A tool installs after us                              | `Object.defineProperty(window, KEY, …)` (RDT 8): a temporary wrapper attaches as it lands. Plain assignment `window.KEY = hook`: the accessor's `set` defines it as `window`'s own property (as without us) and attaches.              |

- **Attaching** wraps `inject` (records the renderer under the id the hook returned) and `onCommitFiberRoot` (calls the hook's own first, then ours). Renderers already in `hook.renderers` are recorded on attach.
- **Restore:** the `defineProperty` wrapper is removed on the first renderer inject, in any order, unless something else wrapped it since. The page sees a patched built-in only until React connects.
- **Not handled:** RDT enabled after React has connected (for example turned on with the page open). React only injects once, so RDT gets nothing until a reload; that's RDT's own behavior without ReactDX.

## Record (`HookRecord`)

- `installHook(target, onRenderer?)` calls `onRenderer(id, { version, bundleType, rendererPackageName })` once per renderer, including those already on a hook installed first. The content script uses it to post to the relay (`docs/messages.md`).
- `installHook` returns it, and stores it on `target` under `Symbol.for("reactdx")` (non-enumerable), where the injected agent will find it (M2 #21).
- `renderers`: `Map<id, { version, bundleType, rendererPackageName }>`, copied fields only (no references to React's renderer objects).
- `roots`: `Map<id, Set<FiberRoot>>`. A root is added on commit and removed when it commits with no element (`root.current.memoizedState?.element == null`, i.e. `root.unmount()`).
- `listeners`: `Set<(rendererId, root) => void>`, called after every commit.
- Next's Server Components client (`react-server-dom-turbopack`) only registers with a hook that has `supportsFlight`. RDT's hook has it, ours doesn't (yet), so with RDT installed the record lists it too, with no roots. Worth adding to ours for M7.

## Agent (`startAgent(target, post)`, `src/agent.ts`)

- Injected after a development renderer connects (`docs/messages.md`), so it isn't bound by the 2,048-byte budget. Does nothing without the hook record or if already started (`Symbol.for("reactdx.agent")` on `target`).
- Reads `record.roots`, so roots that committed before it arrived are reported. Root ids are its own (a `WeakMap<FiberRoot, { id, commits }>`, counting from 1).
- Commit counts start when the agent starts: existing roots begin at 0.
- Posts `snapshotMessage(roots)` at start, at most every 100 ms after commits (one timer per burst, so a page committing every frame can't flood the extension), and on a `get-snapshot` message event on `target`.
- Unmounted roots drop out of the next snapshot (the record removes them).

## Tree (`createTree()`, `src/tree.ts`; M3 #24)

The agent tracks the component tree only between `WATCH` and `UNWATCH` message events from the relay (`docs/messages.md`, "Tree batches"), so a page with DevTools closed pays nothing beyond M2.

- **Watch:** posts `reset` plus every root's tree, depth-first, starting a new `seq` at 1. Every watch is a full resync.
- **Ids:** a `WeakMap` sets each id on both the fiber and its `alternate` (React swaps them on every update), counting from 1 per document. Ids survive `UNWATCH`, so a re-watch gives the same component the same id.
- **Kinds (by fiber tag):** 0 function, 1 class, 11 forwardRef, 14/15 memo, 9 consumer, 10 provider, 12 profiler, 13 suspense, 31 activity, 5/26/27 host; `lazy` when `elementType` is a lazy wrapper. Every other tag (root, text, fragment, mode, portal, offscreen...) emits nothing; its children attach to the nearest emitted ancestor.
- **Names:** `displayName`, then the wrapped component for forwardRef (`render`) and memo (`type`), then `name`, then `Anonymous`. Providers and consumers: the context's `displayName` or `Context`. Host: the tag. Profiler, Suspense, Activity: fixed. Names and keys are cut to 256 chars (`MAX_TREE_STRING`), the validator's bound.
- **Hidden content:** an Offscreen fiber (tag 22) with `memoizedState !== null` is suspended or hidden, so its subtree isn't emitted. A Suspense showing its fallback lists only the fallback.
- **Per-commit diff:** every commit while watched, not once per flush, because the shortcut only holds against the previous commit: a node whose fiber has an `alternate` with the same `child` bailed out, so nothing below it changed. Otherwise its emitted children are compared with the stored list: `remove` the gone (descendants implied), `add` the new in ascending index with their subtrees, then `reorder` if the order still differs. A known child whose name changed (Fast Refresh, a late `displayName`) gets `rename`.
- **Posting:** ops are buffered and posted on the existing 100 ms flush, split into batches of at most 2,000 (`MAX_OPS`), each with the next `seq`. A commit with no structural change posts nothing.
- **Unwatch:** stops diffing, drops the buffer and the stored children, names and fibers, and hides the highlight.
- **`find(id)`** (M3 #28): `{ name, elements }` for an emitted node, or `undefined` (unknown or removed). `elements` are its top-level DOM elements: the first host fibers (5, 26, 27) below it, their `stateNode`; a host node gives itself; text is skipped, and so is hidden Offscreen content. The tree keeps the latest fiber per id (set on add and on each commit's visit). A bailed-out subtree shares its child fibers, so the ones kept there stay current.

## Highlight (`createOverlay(doc)`, `src/overlay.ts`; M3 #28)

- The agent handles `highlight` (`{ source: "reactdx-relay", type: "highlight", id }`): `show(find(id)?.elements ?? [], name)`. `clear-highlight` and `unwatch` call `hide()`. The page can post these too; an id the tree doesn't know shows nothing.
- `show(elements, label)`: one `div` appended to `document.documentElement` on first show, with inline `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647` and a closed shadow root (page CSS can't restyle it, page queries don't find the boxes). Inside: a `[data-box]` per element at its `getBoundingClientRect()`, and the label as a text node above the first box. Each show rebuilds the contents. `show([])` hides.
- `hide()`: removes the host. Page elements' styles and layout are never touched (`e2e/highlight.test.ts` compares every computed style).
- Not repositioned on scroll or resize while shown.

## Types

- `Hook`, `HookRecord`, `FiberRoot`; `RendererInfo` comes from `@reactdx/messages` (re-exported), so `page` depends on `messages`, never the reverse. `declare global { var __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook | undefined }` types `window` and `globalThis`.
- `checkDCE` is a no-op: React prints "Download the React DevTools" when the hook lacks it. e2e checks the message never appears.

## Tests (`docs/unit-tests.md`)

One file per React scenario, because react-dom registers with the hook only once per module load:

- `test/hook.test.ts`: the hook's shape and renderer ids (no React).
- `test/commit.test.ts`: ReactDX first; record contents, root removal, `defineProperty` restored.
- `test/rdt-first.test.ts`: an RDT-like hook defined first with a getter.
- `test/define-later.test.ts`: a hook defined with `defineProperty` after ours.
- `test/assign-later.test.ts`: a hook set by plain assignment after ours.
- `test/tree.test.ts`: kinds and names, watch/unwatch, splitting, mounts, unmounts, reorders, renames and Suspense (fake timers drive the flush). `test/tree-mirror.ts` applies ops like the panel and prints an outline.
- `test/agent.test.ts`: the agent's first snapshot, 100 ms batching, `get-snapshot`, unmount, a second start (fake timers).
- `test/window.ts`: `windowLike()` inserts a fresh prototype under `globalThis` to stand in for `Window.prototype`; `mount()` renders a root. `test/fake-hook.ts`: an RDT-like hook.

## Related

- `docs/extension.md`: the content script that calls `installHook`.
- `docs/m0-findings.md` #4: where the approach was proven.
