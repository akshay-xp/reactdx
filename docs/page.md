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

## Picker (`src/agent.ts`; M3 #29)

- `tree.owner(element)`: walks DOM parents to the first element with a `__reactFiber$…` key, then `fiber.return` to the nearest fiber with a kind that isn't `host`, whose id the tree still has (mounted and emitted). So a pick is always a component, with a row even when DOM elements are hidden. `undefined` outside React.
- `pick-start` adds capture-phase listeners on the window, ahead of React's on the root container:
  - `pointermove`: highlights the owner of the element under the pointer (hides the overlay over anything React doesn't own).
  - `pointerdown`, `mousedown`, `pointerup`, `mouseup`: `preventDefault` and `stopImmediatePropagation`, so the app never sees any of the press (pages act on press too: menus, drags, focus); as React DevTools does. A prevented `pointerdown` still lets the `click` fire.
  - `click`: `preventDefault` and `stopImmediatePropagation` (the app never sees it), ends picking, posts `picked(owner ?? null)`.
  - `keydown` Escape: ends picking, posts `picked(null)`.
- Ending picking removes the listeners and hides the overlay. `pick-stop` and `unwatch` end it without posting. Only `click` is swallowed: `pointerdown` and `mousedown` still reach the page.

## Values (`createInspector()`, `src/inspect.ts`; M4 #33)

Describes page values for the inspector. Carried from the M0 #7 spike (`docs/m0-findings.md`, "Value format for the panel"), with its gaps fixed. Every result is JSON-safe and passes `parseValue` (`docs/messages.md`, "Inspected values").

- `{ serialize(value), expand(id, offset = 0), find(id, key?), release() }`. Objects get ids (a `WeakMap` and an id-to-object `Map`, from 1); the same object keeps its id until `release()`. `expand` of an id it doesn't hold returns `undefined`. `find` returns `{ value }`: the object, or with `key` its child: a property by name as sent (bounded, symbols as `Symbol(desc)`), or a number indexing an array, typed array, map's entries (the value) or set; `undefined` for none, a getter (never run) or a throw.
- Copy (`copyText(value)`): a string as it is; a function its source (`Function.prototype.toString`, not one the app set); anything else as 2-space JSON from a walk that never runs getters: enumerable string keys only (React's dev `key` warning getter isn't), `NaN`/`Infinity` and bigints (`2n`) as strings, functions inside `[Function: name]` (`anonymous` without one: a handler's source would bloat an object's copy), symbols `Symbol(desc)`, maps as `[key, value]` pairs, sets and typed arrays as arrays, summaries as text (`<div />` for elements, ISO dates, `/a/g`, `Error: msg`, `<div>`, `[Promise]`), getters `[Getter]`, cycles `[Circular]`, a throw `[Unreadable]`. Top-level `undefined` is `undefined`.
- Limits: `MAX_DEPTH` 2 (deeper objects are `ref` with a `preview`, one `expand` away), `PAGE` 100 entries per message for every container (object keys too, with `nextOffset`), strings cut to 1,000 chars with their `length`, names (functions, classes, tags, keys, symbol descriptions, error names) to 256, keys, messages and attributes to 1,000.
- Never runs app code on purpose: properties are read through `Object.getOwnPropertyDescriptors`; accessors are `{ type: "getter" }`.
- Descriptors beyond the spike's table: `typed-array` (paged by index: a `Uint8Array(1_000_000)` takes under 5 ms locally; the unit tests allow 50 ms for shared CI runners), `array-buffer` and `data-view` (`byteLength`), `weak-map`, `weak-set`; symbol-keyed props as `"Symbol(desc)"`; an array's non-index props (up to 100) in `props`; sparse holes as `{ type: "hole" }`.
- Proxies can't be detected, so their traps run. Anything that throws while read becomes `{ type: "unreadable", message }` and its siblings still serialize.
- `test/inspect.test.ts`: the spike's cases, every gap, and a mixed value checked against `parseValue`.

## Inspection (`src/agent.ts`; M4 #33)

- `inspect { id }` (checked with `parseTreeCommand`): releases the previous inspection, starts a new `createInspector()`, and posts `inspected(id, data)`: `{ props }` from the fiber's `memoizedProps` (every kind, host nodes included), plus `state` from a class instance (tag 1) when it isn't null. An id the tree doesn't have gets `data: null`. `inspect { id: null }` stops.
- Live: on the existing 100 ms flush, re-sent only when the fiber `tree.fiber(id)` returns has a different `memoizedProps` or `memoizedState` from the last send (React gives a rendered fiber new ones), so commits elsewhere cost a comparison. An unmounted node gets one `data: null` and the inspection ends.
- `expand { objectId, offset }`: posts `expanded(objectId, offset, value)` from the current inspection; ids it doesn't hold (released, forged) post nothing.
- `copy-value { target }` / `store-value { target }` (the panel's row menu): the value at a `ValueTarget` of the current inspection: `objectId` (+ `key`) through `find`, `hook` by call indexes through the raw hooks kept from `describe` (a hook without a value: none), `context` by read order from the values sent. None: nothing happens. `copy-value` posts `valueText(copyText(value))` when within `MAX_COPY` (10,000,000 chars). `store-value` sets the next free `$reactdx<n>` (from 1) on the page's window and `console.log`s the name and value, like DevTools' "Store as global variable", then posts `valueStored(name)` so the panel can say where it went.
- `unwatch` ends the inspection; a new watch starts without one (the panel asks again).
- Contexts (M4 #35): `fiber.dependencies.firstContext` (`{ context, memoizedValue, next }`) holds every context read in the last render, whatever read it (`useContext`, `use`, a class's `contextType`, consumers). Listed once each in first-read order as `{ name, value }`, the name the context's `displayName` or `Context` (React's own host transition context, read by `useFormStatus`, is one of these). A re-send also happens when any read value changed (`Object.is`), since a memo'd consumer re-rendered by its provider keeps its props and state objects.
- Source (M4 #36, `src/source.ts`): `sourceOf(fiber)` is the component's own location: the first element it renders, else its own element (where it was rendered). Depth-first from `fiber.child`: a fiber whose `_debugOwner` is the fiber (or its alternate) is the answer; one with no owner (React's own, e.g. Suspense's Offscreen) is searched into; one owned by another component is skipped with its subtree (children passed in are the parent's). React 18: `_debugSource { fileName, lineNumber, columnNumber }` (1-based, from the JSX transform) gives `{ file, line, column }`. React 19 has no `_debugSource`; `_debugStack` is `Error("react-stack-top-frame")` made in `jsxDEV`/`createElement`, so `stackSource(stack)` takes frame 1 (V8 `at fn (url:l:c)` / `at url:l:c`, Firefox `fn@url:l:c`) as `{ url, line, column }`, which the panel maps through source maps. Frame 0 `UnknownOwner` (past React's owner stack limit) means no location.
- Owners (M4 #35): the `_debugOwner` chain, nearest first, at most 50 (`MAX_OWNERS`). A fiber the tree has emitted and still holds gives `{ id, name }` (`tree.known(fiber)`, either of its two fibers); others are skipped. A React 19 Server Component (`ReactComponentInfo`, no `tag`) gives `{ id: null, name }` and the chain continues through its `owner`.
- `tree.fiber(id)`: the node's fiber as of the last commit.
- `test/inspect-agent.test.ts`: props, class state, unknown and malformed ids, re-sends, no re-send for a sibling's commit, stop on `inspect null` and `unwatch`, expand, released ids, copy and store of props and hooks, targets that find nothing. `test/context.test.ts`: copying a context by read order.

## Hooks (`inspectHooks(fiber, dispatcherRef)`, `src/hooks.ts`, `src/stack.ts`; M4 #34)

The inspection's `hooks` come from a shadow render, after react-debug-tools' `inspectHooksOfFiber` (MIT, what RDT uses), rewritten here.

- Only function (tag 0), forwardRef (11, `render(props, ref)`) and simple memo (15) fibers have hooks; others get no `hooks` field. A lazy or memo-wrapped type's `defaultProps` are merged into its props.
- The agent finds the fiber's renderer (walk `return` to the HostRoot, tag 3, whose `stateNode` is in `record.roots`) and takes its `currentDispatcherRef` from the global hook's `renderers` map. React 19 keeps the dispatcher at `.H`, React 18 at `.current`.
- The component is called once with a stub dispatcher (a Proxy: an unknown hook throws "Unsupported hook: <name>" rather than misreading the list). Each stub reads the next entry of the fiber's `memoizedState` hook list and the next `fiber.dependencies` context (`memoizedValue`), mirroring what React allocates: Transition and SyncExternalStore take 2 entries, ActionState/FormState 3; contexts, `use`, DebugValue and FormStatus (a host transition context read) none.
- Values: State, Reducer, DeferredValue, Id, Optimistic, SyncExternalStore: the state. Ref: `.current`. Memo, Callback: the memoized value. Effect, LayoutEffect, InsertionEffect: their deps (no `value` without deps). ImperativeHandle: the ref's current handle. Transition: `isPending`. ActionState/FormState: the state (a fulfilled thenable's value). `use(context)` and `useContext`: `Context(<displayName>)` or `Context`. `use(thenable)`: `Use` with its value; thenables come from `dependencies._debugThenableState` in order, else the argument; a pending one ends the render where React would suspend (the hooks so far stand), a rejected one throws. EffectEvent: the function. `useMemoCache` (React Compiler) returns an empty cache and isn't listed.
- Grouping: `Error.stackTraceLimit` is raised for the render. Each stub records its stack; the frames between React's one exported wrapper and the shadow render's own frame (counted against a stack taken just before the call) are the custom hook chain. Each level is a group named after its function, keyed by its call site (the frame's source line), so consecutive hooks share a group only while their chains match, and two calls of one custom hook stay apart. A DebugValue inside a group becomes the group's `value` (formatter applied); at the top level it's its own row.
- Call sites (M4 #37): each hook gets `site` (`frameLocation`, `src/source.ts`): a built-in hook's is the frame below React's exported hook (`frames[ABOVE]`, the component or custom hook calling it); a custom hook group's is the caller frame its key uses. Real stacks, so React 18 and 19 alike. The panel names the hook from that line.
- `parseStack(stack)`: `{ functionName, source }` per frame, V8 (`at name (url:line:col)`) and Firefox (`name@url:line:col`) formats.
- No side effects: every `console` method is a no-op during the render; stub setters do nothing; effects never run. Any throw (except the suspend) becomes `hooksError`, with props and state still sent.
- `test/hooks.test.ts` (React 18 and 19, through the agent): built-ins in order with values, live re-send, custom hook groups, React 19 hooks, no effects/commits/logs, throw, suspend, forwardRef, memo, class. `test/stack.test.ts`.

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
- `test/inspect.test.ts`, `test/inspect-agent.test.ts`: values and inspection (above). `test/context.test.ts`: contexts (React 19's `use` too), re-send on a context change, owners. `test/source.test.ts`: stack formats, React 18 `__source` and React 19 stacks (a marker Error on the element's line). `test/inspecting.ts`: the shared hook, agent and root for the inspection tests.
- `test/agent.test.ts`: the agent's first snapshot, 100 ms batching, `get-snapshot`, unmount, a second start (fake timers).
- `test/window.ts`: `windowLike()` inserts a fresh prototype under `globalThis` to stand in for `Window.prototype`; `mount()` renders a root. `test/fake-hook.ts`: an RDT-like hook.

## Related

- `docs/extension.md`: the content script that calls `installHook`.
- `docs/m0-findings.md` #4: where the approach was proven.
