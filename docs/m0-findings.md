# M0 findings

Verdicts from the M0 experiments (milestone "M0: Prototypes and open questions"). The code lives in `spikes/`, is throwaway, and is only kept so results can be rerun.

Environment rule: React 18.3 and the latest 19.x, development builds; the latest stable Chrome and Firefox (Chrome only for page-side-only experiments); the Vite fixture by default, Next.js only for `_debugStack` and RSC.

## Template

### <Experiment> (#<issue>)
- **Question:** what this experiment answers.
- **Verdict:** go, no-go, or partial.
- **Evidence:** what was observed, with numbers where relevant.
- **Versions tested:** React, browser, and OS versions.
- **Steps to reproduce:** commands, run from `spikes/`.

## Harness (#1)

Shared setup for every experiment, in `spikes/harness/`.

| Command (from `spikes/`) | What it does |
|---|---|
| `pnpm dev:18` | Vite fixture on React 18.3.1, port 5118 |
| `pnpm dev:19` | Vite fixture on React 19.3.1, port 5119 |
| `pnpm dev:next` | Next.js 16 fixture (Server Component + client counter), port 5120 |
| `pnpm test` | Playwright smoke tests in Chromium; starts the dev servers |
| `pnpm ext:firefox` | Opens Firefox with the harness extension as a temporary add-on |

- `harness/extension/` is a bare MV3 extension: `hook.js` runs in the page's context at `document_start` on localhost. It installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` and logs `[reactdx] hook installed`, then `[reactdx] commit renderer=<id> container=<nodeName>` on every commit.
- Proof that the hook ran before React: React's development build prints "Download the React DevTools" only when it finds no hook while loading. All three fixtures print it without the extension and don't print it with the extension.
- One Vite fixture serves both React versions. The Vite mode picks `react-18` or `react-19` through npm aliases, with a separate prebundle cache for each mode. A pnpm `peerDependencyRules` entry allows react-dom's `react` peer, because the alias rewrites it at runtime.
- Playwright can't load Firefox extensions, so Firefox is checked by hand.
