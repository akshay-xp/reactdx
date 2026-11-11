# Page (`packages/page`)

Code that runs in the page's MAIN world. Today: installing the React DevTools global hook and recording what React registers. Fiber reading comes later.

## Rules

- No runtime dependencies: it's bundled into the `document_start` script that runs on every site, which `pnpm check` holds to 2,048 bytes (`docs/check.md`). Measured: 1,614 bytes (M2 #18).
- Never imports React; React only reaches it through the hook (`docs/check.md` fails any bundle containing React).

## Installer (`installHook(target)`, `src/hook.ts`)

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

- `installHook` returns it, and stores it on `target` under `Symbol.for("reactdx")` (non-enumerable), where the injected agent will find it (M2 #21).
- `renderers`: `Map<id, { version, bundleType, rendererPackageName }>`, copied fields only (no references to React's renderer objects).
- `roots`: `Map<id, Set<FiberRoot>>`. A root is added on commit and removed when it commits with no element (`root.current.memoizedState?.element == null`, i.e. `root.unmount()`).
- `listeners`: `Set<(rendererId, root) => void>`, called after every commit.
- Next's Server Components client (`react-server-dom-turbopack`) only registers with a hook that has `supportsFlight`. RDT's hook has it, ours doesn't (yet), so with RDT installed the record lists it too, with no roots. Worth adding to ours for M7.

## Types

- `Hook`, `HookRecord`, `RendererInfo`, `FiberRoot`. `declare global { var __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook | undefined }` types `window` and `globalThis`.
- `checkDCE` is a no-op: React prints "Download the React DevTools" when the hook lacks it. e2e checks the message never appears.

## Tests (`docs/unit-tests.md`)

One file per React scenario, because react-dom registers with the hook only once per module load:

- `test/hook.test.ts`: the hook's shape and renderer ids (no React).
- `test/commit.test.ts`: ReactDX first; record contents, root removal, `defineProperty` restored.
- `test/rdt-first.test.ts`: an RDT-like hook defined first with a getter.
- `test/define-later.test.ts`: a hook defined with `defineProperty` after ours.
- `test/assign-later.test.ts`: a hook set by plain assignment after ours.
- `test/window.ts`: `windowLike()` inserts a fresh prototype under `globalThis` to stand in for `Window.prototype`; `mount()` renders a root. `test/fake-hook.ts`: an RDT-like hook.

## Related

- `docs/extension.md`: the content script that calls `installHook`.
- `docs/m0-findings.md` #4: where the approach was proven.
