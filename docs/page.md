# Page (`packages/page`)

Code that runs in the page's MAIN world. Today: installing the React DevTools global hook. Fiber reading comes later (M2+).

## Rules

- No runtime dependencies: it's bundled into the `document_start` script that runs on every site, which `pnpm check` holds to 2,048 bytes (`docs/check.md`).
- Never imports React; React only reaches it through the hook (`docs/check.md` fails any bundle containing React).

## Hook (`src/hook.ts`)

- `installHook(target)` sets `target.__REACT_DEVTOOLS_GLOBAL_HOOK__` and returns it. The content script passes `window`; tests pass `globalThis` or a plain object.
- `Hook`: `renderers` (`Map<number, unknown>`), `supportsFiber: true`, `inject(renderer)` (returns ids from 1), `onCommitFiberRoot`, `onCommitFiberUnmount`, `onPostCommitFiberRoot` (no-ops for now), `checkDCE`.
- `checkDCE` is a no-op: React prints "Download the React DevTools" when the hook lacks it. e2e checks the message never appears (`docs/e2e.md`).
- React looks callbacks up on the hook at call time, so wrapping or spying on `onCommitFiberRoot` after install works (`test/commit.test.ts`).
- `declare global { var __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook | undefined }` types `window` and `globalThis`, so callers need no casts.
- Sharing the hook with RDT when both are installed is M2 (M0 #4 in `docs/m0-findings.md`).

## Tests

- `test/hook.test.ts`: the hook's shape and renderer ids.
- `test/commit.test.ts`: a real React 18 and 19 root commits through the hook (`docs/unit-tests.md`).

## Related

- `docs/extension.md`: the content script that calls `installHook`.
