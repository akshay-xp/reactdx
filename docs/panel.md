# Panel (`packages/panel`)

Solid UI rendered in the DevTools panel. The browser glue (`browser.devtools.*`) lives in `apps/extension/entrypoints/panel/`; `packages/panel` has no `chrome.*`/`browser.*` code.

## Connection list (`src/ConnectionList.tsx`, `src/Panel.tsx`)

- `Panel(props: { renderers: RendererView[] })` renders `ConnectionList` in the themed `<main>`. `apps/extension/entrypoints/panel/main.tsx` connects a `runtime` port named `panel`, subscribes with `browser.devtools.inspectedWindow.tabId`, and sets a signal from each `TabStateMessage` (`docs/messages.md`).
- States: no renderers: "No React on this page". Only production: "Production build of React <versions>. ReactDX inspects development builds." Otherwise one `[data-testid=renderer]` per copy (`React <version> <development|production> <rendererPackageName>`) with `[data-testid=root]` rows ("Root N", "N commits", `data-commits`). Production copies are listed with their roots (Next's dev overlay) but get no agent.
- Page data is only ever a Solid text node, never markup (unit test and `e2e/forged.test.ts` check an `<img onerror>` version renders as text).
- `test/ConnectionList.test.tsx` (Vitest `panel` project): each state, text-only, no Tailwind palette classes.
- Reconnect: `main.tsx` `connect()` opens the `panel` port and subscribes; when the port drops (the background stopped), it connects again, which wakes the background and asks the relay for current state.
- Reset: `browser.devtools.network.onNavigated` clears the list and subscribes again on the current port, so a new document shows only what it reports ("No React on this page" until its React connects).

## Themes (`src/themes.ts`, `src/index.css`)

Copied from SnapQL (`~/Code/snapql/apps/extension/src/panel/themes.ts`, `index.css`), so both extensions look the same.

- Themes are data: `Theme = { id, name, kind, colors: Record<ColorToken, string> }`, tokens `bg, fg, muted, border, selected, error, surface, accent, success, syntax-key, syntax-string, syntax-number`. Ships `devtools-light`, `devtools-dark` with SnapQL's values.
  - `bg`, `fg`, `selected`, `error` and dark `muted` come from the DevTools document's `--sys-color-*` variables (source noted in the file).
  - SnapQL's own: `border`, light `muted` `#5f6368` (DevTools' `#757575` is 4.14:1 on `surface`), `surface`, `accent`, `success`, `syntax-*`.
  - `test/themes.test.ts` pins every value and checks every text token (`fg`, `muted`, `error`, `success`, `accent`, `syntax-*`) is at least 4.5:1 on `bg` and `surface`. Dark `muted` on `selected` is 2.9:1, so selected rows must not rely on `muted`.
- `defaultTheme(kind)` picks by DevTools kind. Adding a theme is one entry in `themes`.
- `applyTheme(theme, root)`: sets `--theme-<token>` (`themeVars`), `data-theme=<id>`, `data-theme-kind=<kind>` and `color-scheme: <kind>` (native scrollbars and form controls otherwise stay light).
- `index.css`:
  - `@import "tailwindcss" source(".")`: Tailwind scans `packages/panel/src` (the CSS is built from `apps/extension`, outside it).
  - `@theme { --color-*: initial; }` drops Tailwind's default palette, so `bg-red-500` generates nothing. Components use token classes only (`bg-bg`, `text-muted`, `border-border`), never a theme name or color. `apps/extension/test/build.test.ts` plants a palette class to prove it.
  - `@theme inline` maps `--color-<token>` to `--theme-<token>`.
  - Biome needs `css.parser.tailwindDirectives` (`biome.json`).
- Type: labels `font-sans` 12px (`text-xs`), page data `font-mono` (M2 list onwards).
- Exports: `@reactdx/panel` (`Panel`), `@reactdx/panel/themes`, `@reactdx/panel/index.css`.

## Theme source (`apps/extension/entrypoints/panel/theme.ts`, `main.tsx`)

- `getTheme()`: `browser.devtools.panels.themeName === "dark"` at load. `onThemeChanged` in Firefox only.
- Chrome has no theme event, and its panel iframe's `prefers-color-scheme` flips during load (seen in SnapQL's e2e), so Chrome keeps the load-time theme until the panel reopens.
- The panel needs `browser.devtools`, so it only runs inside DevTools; `panel.html` opened as a tab throws.
- e2e: `e2e/theme.test.ts` (Chrome) launches DevTools light and dark and checks the panel's `data-theme`, `color-scheme` and `--theme-bg` (`docs/e2e.md`).

## Related

- `docs/extension.md`: Tailwind in the WXT build.
- `docs/check.md`: Tailwind's license comment and the remote URL rule.
