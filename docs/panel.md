# Panel (`packages/panel`)

Solid UI rendered in the DevTools panel. The browser glue (`browser.devtools.*`) lives in `apps/extension/entrypoints/panel/`; `packages/panel` has no `chrome.*`/`browser.*` code.

## Connection list (`src/ConnectionList.tsx`, `src/Panel.tsx`)

- `Panel(props: { renderers: RendererView[]; tree: TreeStore })` renders `ConnectionList` in the themed `<main>`. `apps/extension/entrypoints/panel/main.tsx` connects a `runtime` port named `panel`, subscribes with `browser.devtools.inspectedWindow.tabId`, sets a signal from each `TabStateMessage`, and applies each tree batch to the store (`docs/messages.md`, "Tree flow").
- States: no renderers: "No React on this page". Only production: "Production build of React <versions>. ReactDX inspects development builds." Otherwise one `[data-testid=renderer]` per copy (`React <version> <development|production> <rendererPackageName>`) with `[data-testid=root]` rows ("Root N", "N commits", `data-commits`). Production copies are listed with their roots (Next's dev overlay) but get no agent.
- Under each development root, a `TreeView` of its components. Production roots list no components.
- Page data is only ever a Solid text node, never markup (unit test and `e2e/forged.test.ts` check an `<img onerror>` version renders as text).
- `test/ConnectionList.test.tsx` (Vitest `panel` project): each state, component rows under development roots only, text-only, no Tailwind palette classes or arbitrary values (so `TreeView`'s `max-height: 80vh` is an inline style).
- Reconnect: `main.tsx` `connect()` opens the `panel` port and subscribes; when the port drops (the background stopped), it connects again, which wakes the background and asks the relay for current state.
- Reset: `browser.devtools.network.onNavigated` clears the list and subscribes again on the current port, so a new document shows only what it reports ("No React on this page" until its React connects).

## Tree store (`createTreeStore()`, `src/tree.ts`; M3 #25)

The page's component tree, rebuilt from the agent's ops (`docs/messages.md`, "Tree batches"). Exported as `@reactdx/panel/tree`.

- `apply(batch)` applies `reset`, `add`, `remove` (with descendants), `reorder` and `rename`, and bumps a Solid `version` signal. It returns true when the panel must ask for a resync: the first time a batch has the wrong `seq` or an op names an unknown id (an `add` under an unknown parent, a `reorder` of one, a `remove` or `rename` of an unknown node). After that it ignores batches until one starting with `reset`, so a burst of bad batches asks once.
- `rows(rootId)`: `Row = { id, name, depth, kind, key, expandable, expanded, match }`, depth-first. Host (DOM element) nodes are hidden unless `showHosts()`: their children take their place and depth. `expandable` means it has a visible descendant through hidden hosts. Collapsed nodes' descendants aren't listed; everything starts expanded. `match`: the node matches the search.
- `showHosts()` / `setShowHosts(on)` (M3 #27): one visibility rule for rows, `expandable` and Left's parent. Hiding hosts clears a selected host (it has no row). Off on every panel open.
- `toggle(id)`: collapses or expands.
- `selected()` / `select(id)`: one selection for the panel (ids are unique per document). After each batch it's cleared only if its node is gone, so it survives commits and a resync that re-adds the id (ids persist across watches, `docs/page.md`).
- `key(rootId, key): boolean`: moves the selection within that root's rows; true when the key is handled. A selection in another root counts as none.
  - `ArrowUp`/`ArrowDown`: previous/next row, clamped; with none selected, the first row.
  - `Home`/`End`: first/last row.
  - `ArrowLeft`: collapses an expanded row, else selects the nearest non-host ancestor.
  - `ArrowRight`: expands a collapsed row, else selects its first child; nothing on a leaf.
- Search (M3 #27): the current match is the selection, so arrowing or clicking elsewhere and pressing Enter continues from there.
  - `query()` / `setQuery(q)`: sets the query and selects the first match.
  - `matches()`: ids of visible-kind nodes whose name contains the query, case-insensitive. Every root depth-first, roots in first-seen order, collapsed subtrees included. Empty query: none.
  - `step(1 | -1)`: next or previous match, wrapping; from a non-match, the first or last.
  - `position()`: the selection's index among the matches from 1, or 0 if it isn't one.
  - Selecting a match (`setQuery`, `step`) also expands its ancestors, so it has a row, and TreeView scrolls it into view.
- `clear()`: on `onNavigated`, with the renderer list; also drops collapse state and the selection. The query and DOM toggle stay.
- `test/tree.test.ts`: rows, hidden hosts, each op, the resync rules, collapse, selection, every key, shown hosts, search, step.

## Tree view (`TreeView`, `src/TreeView.tsx`, `src/virtual.ts`; M3 #26)

One per development root: `TreeView(props: { tree: TreeStore; rootId: number })`.

- Virtual list: a scroll container (`[data-testid=tree]`, `role="tree"`, focusable, `max-height: 80vh`) holding a spacer of `rows × ROW_HEIGHT` (20px) and only the window of rows `windowOf(scrollTop, height, count)` returns: the rows in view plus `OVERSCAN` (10) each side. `scrollTop` and `clientHeight` are read on mount, `scroll` and window `resize`. Fixed row height keeps the window arithmetic and unit-testable without layout (`test/virtual.test.ts`).
- Rows (`[data-testid=node]`, `role="treeitem"`, `aria-level`, `aria-selected`, `aria-expanded` when expandable, `data-id`): a toggle (`[data-toggle]` area, `[data-testid=toggle]` CSS-border triangle, rotated when expanded; no text so the e2e text readers don't take it for a name), the name, a `[data-testid=badge]` for `memo`/`forwardRef`/`lazy`, and `[data-testid=key]` as one text node `key="…"`. All page data is text nodes.
- Selected row: `bg-selected`, badge and key `text-fg` (dark `muted` on `selected` is 2.9:1).
- Search matches: `data-match`, and the name (`[data-testid=name]`) in `text-accent`, except on the selected row (`text-fg`; accent on `selected` isn't a checked contrast pair).
- Clicks and keys are handled once on the container: rows are recycled as the window moves, and the container holds focus. A click on an expandable row's toggle area toggles it; any other row click selects. Handled keys (`tree.key`) are `preventDefault`ed.
- A selection change scrolls the selected row into view (End on 10,000 rows renders the last one). Only selection changes scroll, so a commit doesn't pull the view back.
- Perf marks: `main.tsx` marks `reactdx:subscribe` on every subscribe; `TreeView` marks `reactdx:rows` each time its rows go from empty to non-empty. `e2e/perf.test.ts` reads them (`docs/e2e.md`).
- `test/TreeView.test.tsx`: a 1,000-row tree keeps fewer than 100 rows in the DOM, badges, keys and toggles, text-only keys, click, toggle and keyboard, match marking.

## Toolbar (`Toolbar`, `src/Toolbar.tsx`; M3 #27)

Above the copies, only when a development copy is present (`ConnectionList`), so the no-React and production notices stay exactly as they were.

- Search box (`[data-testid=search]`, `aria-label="Search components"`): input sets the query; Enter steps to the next match, Shift+Enter to the previous.
- Counter (`[data-testid=search-count]`, `<position> of <matches>`), only while there's a query: "1 of 3" after typing, "0 of 0" with no matches.
- `Show DOM elements` checkbox (`[data-testid=show-dom]`, inside its `<label>`): `setShowHosts`.
- `test/Toolbar.test.tsx`: counter, Enter and Shift+Enter, no matches, clearing, the DOM toggle.

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
- Exports: `@reactdx/panel` (`Panel`), `@reactdx/panel/tree`, `@reactdx/panel/themes`, `@reactdx/panel/index.css`.

## Theme source (`apps/extension/entrypoints/panel/theme.ts`, `main.tsx`)

- `getTheme()`: `browser.devtools.panels.themeName === "dark"` at load. `onThemeChanged` in Firefox only.
- Chrome has no theme event, and its panel iframe's `prefers-color-scheme` flips during load (seen in SnapQL's e2e), so Chrome keeps the load-time theme until the panel reopens.
- The panel needs `browser.devtools`, so it only runs inside DevTools; `panel.html` opened as a tab throws.
- e2e: `e2e/theme.test.ts` (Chrome) launches DevTools light and dark and checks the panel's `data-theme`, `color-scheme` and `--theme-bg` (`docs/e2e.md`).

## Related

- `docs/extension.md`: Tailwind in the WXT build.
- `docs/check.md`: Tailwind's license comment and the remote URL rule.
