# Panel (`packages/panel`)

Solid UI rendered in the DevTools panel. The browser glue (`browser.devtools.*`) lives in `apps/extension/entrypoints/panel/`; `packages/panel` has no `chrome.*`/`browser.*` code.

## Connection list (`src/ConnectionList.tsx`, `src/Panel.tsx`)

- `Panel(props: { renderers: RendererView[]; tree: TreeStore; inspector: InspectorStore })` renders `ConnectionList` in the themed full-height `<main>`. `apps/extension/entrypoints/panel/main.tsx` connects a `runtime` port named `panel`, subscribes with `browser.devtools.inspectedWindow.tabId`, sets a signal from each `TabStateMessage`, and applies each tree batch to the store (`docs/messages.md`, "Tree flow").
- States: no renderers and `stale` (the tab was open before ReactDX was installed or updated; `docs/messages.md`, "Reconnects"): "This page was open before ReactDX was installed or updated. Reload it to inspect React." with a "Reload page" button (`onReload`, `inspectedWindow.reload()` in `main.tsx`; `onNavigated` clears `stale`). No renderers otherwise: "No React on this page". Only production: "Production build of React <versions>. ReactDX inspects development builds." Otherwise one `[data-testid=renderer]` per copy (`React <version> <development|production> <rendererPackageName>`) with `[data-testid=root]` rows ("Root N", "N commits", `data-commits`). Production copies are listed with their roots (Next's dev overlay) but get no agent.
- Under each development root, a `TreeView` of its components. Production roots list no components.
- With a development copy, a split (`[data-testid=split]`): the toolbar and copies on one side, the `Inspector` in `<aside data-testid="inspector" aria-label="Inspector">` on the other. Side by side from Tailwind's `sm` (640 px), stacked below that (DevTools docked at the side); each pane scrolls on its own. In the trees pane the toolbar stays put and `[data-testid=trees]` below it is the one scroller, both ways, for every copy's headings and trees (trees don't scroll themselves; e2e: `the trees pane is the only scroller`). Its list is `w-max min-w-full`, so wide trees widen the scroll, not the rows. No inspector for no-React and production-only pages.
- Page data is only ever a Solid text node, never markup (unit test and `e2e/forged.test.ts` check an `<img onerror>` version renders as text).
- `test/ConnectionList.test.tsx` (Vitest `panel` project): each state, component rows under development roots only, text-only, no Tailwind palette classes or arbitrary values.
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
- `hovered()` / `hover(id | undefined)` (M3 #28): the row under the pointer. `main.tsx` sends a highlight or clear-highlight command on each change (`docs/messages.md`, "Tree flow").
- `picking()` / `setPicking(on)`, `picked(id | null)` (M3 #29): `main.tsx` sends `pick-start`/`pick-stop` whenever `picking` changes (a redundant `pick-stop` after a pick is ignored by the agent). `picked` turns picking off and, for an id the mirror has, selects and reveals it (expands ancestors; TreeView scrolls it into view). `null` or an unknown id only turns picking off.
- `reveal(id)` (M4 #35): selects a node from outside the tree (the inspector's owners) and expands its ancestors; unknown ids do nothing.
- `clear()`: on `onNavigated`, with the renderer list; also drops collapse state, the selection, the hover and picking. The query and DOM toggle stay.
- `test/tree.test.ts`: rows, hidden hosts, each op, the resync rules, collapse, selection, every key, shown hosts, search, step.

## Inspector store (`createInspectorStore(send)`, `src/inspection.ts`; M4 #33)

The selected node's values as the agent last sent them (`docs/messages.md`, "Inspected values"). Exported as `@reactdx/panel/inspection`; `main.tsx` passes a `send` that posts `{ ...command, tabId }` on the current port, calls `inspect(id)` on every selection change, and `resend()` when a batch starts with `reset`. Named `inspection.ts` because `inspector.ts` and `Inspector.tsx` are one file on a case-insensitive disk.

- `inspect(id | undefined)`: sends `inspect` (null for none), clears data, open paths and loaded objects. `resend()` asks again for the same id.
- `receive(inspected)`: replies for another id are ignored. `data()` is the latest; `gone()` is true for `data: null`. Every reply drops the loaded objects and asks again for each open ref, so open values show current contents.
- `open(path, ref?)`, `close(path)`, `isOpen(path)`: paths are dot-joined keys from the section name (`Props.user.name`). Opening a ref (a value past the page's depth limit) sends `expand { objectId: ref, offset: 0 }` once.
- `receiveExpanded(expanded)`, `expansion(objectId)`: what loaded per object; a later page (offset above 0) is appended. `more(container)` sends `expand` at its `nextOffset`, seeding the expansion with what's shown so the page appends to it.
- `test/inspection.test.ts`.

## Inspector (`Inspector`, `src/Inspector.tsx`, `src/value.ts`; M4 #33)

- Empty states: "Select a component to inspect it." and, for `gone()`, "This component unmounted."
- Header (`[data-testid=inspector-header]`, fixed above the sections): the name, the tree's badge for `memo`/`forwardRef`/`lazy`, and `key="…"`, from `tree.info(id)`.
- Hook names (M4 #37): the header's "Hook names" toggle (`IconButton`, `aria-pressed`), off by default. The `settings` prop (`{ hookNames(), setHookNames(on) }`, type `Settings` in `Inspector.tsx`) comes from `createSettings(store)` (`src/settings.ts`; `main.tsx` passes `storage.local`, key `hookNames`): off until the stored value arrives, which is ignored if the developer already changed the setting (a late read on a slow machine undid the press). On, each hook row with a `site` asks `sources.hookName(site)` (one `createResource` per row, nothing asked while off) and reads `<type>(<name>)` (`State(count): 0`, `useCart(cart): "2 items"`, `Context(Theme)(theme)`); no name leaves the type.
- Naming (`src/names.ts`, `createHookNamer(fetch)`): fetches the served module at the call site (`http(s)` only), parses it once per URL for the panel's lifetime (a failure is retried), with `src/hook-names.ts` loaded by dynamic `import()`: `acorn` and the parser are their own chunk (`chunks/hook-names-*.js`), never loaded while the setting is off. Dev output keeps local names, so the served code (Vite module, Next chunk) is parsed, not the original: no TypeScript/JSX parser, no source map. `parseModule` tries `sourceType: "module"`, then `"script"`. `hookNameAt(ast, code, line, column)`: the innermost `CallExpression` containing the frame's position; only one that initializes a `VariableDeclarator` is named: an `Identifier` gives its name, an `ArrayPattern` its first element's, an `ObjectPattern` its first property's value; anything else (bare call, assignment, argument) gives null.
- Inspector rows (values, hook groups, owners) are at least `min-h-5` (20 px), the tree's `ROW_HEIGHT`.
- Order (`byName`, `sortedEntries` in `src/value.ts`): object keys (Props, State, nested objects, an array's extra props, and inline previews like `{a: 1, b: 2}`) and the Context list read alphabetically, case ignored, numbers in order (`a2` before `a10`). Hooks keep call order, arrays index order, maps and sets insertion order (their order is part of the value), and Rendered by nearest owner first. Sorting is the panel's: the page sends its own order.
- Sections (`[data-testid=section]`): Props, State, Hooks (M4 #34), Context, Rendered by (M4 #35). The header button (`aria-expanded`, the tree's triangle) collapses one; collapsed sections stay collapsed while the panel is open. A section with nothing in it isn't shown.
- Value rows (`[data-testid=value]`): `name:` (`text-syntax-key`), then `previewText(value)` as one text node (so both browsers' e2e readers get it whole), colored by kind (string, number, muted for undefined/function/symbol/getter/hole/unreadable, accent for null and booleans). Containers and refs get a toggle (`[data-testid=value-toggle]`) that opens them in place, indented 12 px per level; map entries read `key => value`; a paged container ends with "Show more (N left)". Circular refs don't open.
- Hooks: each hook in call order, `name: value`, or just its name when it has no value (an effect without deps). A custom hook (`useCart: "2 items"`, its DebugValue as the value) opens to the hooks it called; paths are `Hooks.<index>...`. "Couldn't read hooks: <reason>" when the shadow render threw.
- Context: one value row per context read, `Theme: "dark"`, paths `Context.<index>`.
- Source row (`[data-testid=source]`, under the header, M4 #36): `label(location)` (`Counter.jsx:13`, file name and line), its title the full `locationText` (`file:line:column`); an "Open in editor" button. When opening copied instead, "Copied", and for an absolute path a "VS Code" link (`vscode://file<path>:<line>:<column>`). Hidden while there's no source or it resolves to nothing. Resolutions are keyed by the source's value (`JSON.stringify`): an equal re-send keeps the row (no flash), and another source shows nothing until its own resolves, never the previous component's location (an "Open in editor" click would open the wrong file; M4 #38).
- Sources (`src/source.ts`, `createSourceResolver(fetch)`): a `{ file }` source (React 18) is itself. A `{ url }` frame (React 19) is read only from an `http(s)` script: its last `//# sourceMappingURL=`, inline (`data:`, base64 or percent-encoded) or an `http(s)` `.map` (sectioned maps too, Next's), resolved with `@jridgewell/trace-mapping` `AnyMap` (no dynamic code: docs/check.md; 1-based columns in and out). A source URL becomes a path: `file:` its path (Next: absolute), `http(s)` its pathname without the leading slash (Vite: `src/Counter.jsx`, relative to the dev server's root). No map or no mapping: the frame's own script path. Scripts and maps are fetched once per script URL for the panel's lifetime (a failed load is retried); anything else resolves to no location. Requests use the extension's host permission; the page can only point them at URLs it could load itself, and the results are shown as text.
- Open in editor (`src/editor.ts`, `openInEditor(location, io)`): to the inspected page's origin (`inspectedWindow.eval("location.origin")`; Firefox resolves `[result, exception]`, Chrome before 151 only calls back). No server detection: Vite's `GET /__open-in-editor?file=<file>:<line>:<column>` (launch-editor-middleware: always 200 and empty; relative paths resolve against the server's cwd; editor from `LAUNCH_EDITOR`), then Next's `GET /__nextjs_launch-editor?file=<file>&line1=<n>&column1=<n>` (204 opened, 404 no such file; editor from `REACT_EDITOR`). Only an empty 2xx counts, so an app's catch-all page doesn't. Else `file:line:column` is copied with a selected textarea and `execCommand("copy")` (the Clipboard API needs a focused document, which a DevTools panel often isn't).
- Rendered by: the owners nearest first (`[data-testid=owner]`). One in the tree is an accent text button that calls `tree.reveal(id)` (select, expand its ancestors; `main.tsx` then inspects it); one that isn't (a Server Component) is muted text.
- `previewText(value)` (`src/value.ts`): DevTools-console-like one-liners: `"text"` (over 50 chars cut, with the full length), `ƒ name()`, `Symbol(x)`, `{a: 1, b: "x"}` and `[1, 2]` inline up to 5 entries (nested containers as `{...}`, `Array(n)`, `Map(n)`), `Array(n)` past 5 items, a class name before an instance's braces, `<Counter key="k" />`, `<button#id.class>`, `(getter)`, `empty`, `[circular]`, `(unreadable: message)`.
- `test/Inspector.test.tsx`, `test/value.test.ts`.

## Tree view (`TreeView`, `src/TreeView.tsx`, `src/virtual.ts`; M3 #26)

One per development root: `TreeView(props: { tree: TreeStore; rootId: number })`.

- Virtual list: `[data-testid=tree]` (`role="tree"`, focusable, not a scroller) holds a spacer of `rows × ROW_HEIGHT` (20px) and only the window of rows `windowOf(top, height, count)` returns: the rows in the pane's view plus `OVERSCAN` (10) each side. `top` is the pane's view top in the tree's coordinates (the tree's offset from the pane's top, negated: negative while the tree starts below the view, and an empty window once it's entirely below), `height` the pane's `clientHeight`. The pane is the closest `[data-testid=trees]`, else `document.documentElement` (unit tests). Measured on mount, on the pane's `scroll`, and from a `ResizeObserver` on the pane (the panel's size) and on the tree (trees above it change its offset). jsdom has no `ResizeObserver`: `test/setup.ts` stubs one for the `panel` Vitest project. Fixed row height keeps the window arithmetic and unit-testable without layout (`test/virtual.test.ts`).
- Rows (`[data-testid=node]`, `role="treeitem"`, `aria-level`, `aria-selected`, `aria-expanded` when expandable, `data-id`): a toggle (`[data-toggle]` area, `[data-testid=toggle]` CSS-border triangle, rotated when expanded; no text so the e2e text readers don't take it for a name), the name, a `[data-testid=badge]` for `memo`/`forwardRef`/`lazy`, and `[data-testid=key]` as one text node `key="…"`. All page data is text nodes.
- Selected row: `bg-selected`, badge and key `text-fg` (dark `muted` on `selected` is 2.9:1). The rows' wrapper is `w-max min-w-full` (as wide as the widest row in the window, at least the pane's content), so in a tree deeper than the pane every row, and the selection's background, spans the sideways scroll.
- Search matches: `data-match`, and the name (`[data-testid=name]`) in `text-accent`, except on the selected row (`text-fg`; accent on `selected` isn't a checked contrast pair).
- Clicks and keys are handled once on the container: rows are recycled as the window moves, and the container holds focus. A click on an expandable row's toggle area toggles it; any other row click selects. Handled keys (`tree.key`) are `preventDefault`ed.
- Hover: a delegated `onPointerOver` hovers the row under the pointer; `onPointerLeave` on the tree clears it. Pointer rather than mouse events because Biome's a11y rule asks for a focus counterpart to `onMouseOver`; keyboard selection doesn't highlight the page (not in M3's scope).
- A selection change scrolls the pane to the selected row (End on 10,000 rows renders the last one). Only selection changes scroll, so a commit doesn't pull the view back.
- Perf marks: `main.tsx` marks `reactdx:subscribe` on every subscribe; `TreeView` marks `reactdx:rows` each time its rows go from empty to non-empty. `e2e/perf.test.ts` reads them (`docs/e2e.md`).
- `test/TreeView.test.tsx`: a 1,000-row tree keeps fewer than 100 rows in the DOM, badges, keys and toggles, text-only keys, click, toggle and keyboard, match marking.

## Toolbar (`Toolbar`, `src/Toolbar.tsx`; M3 #27)

Above the copies, only when a development copy is present (`ConnectionList`), so the no-React and production notices stay exactly as they were.

Laid out like SnapQL's search bar (`~/Code/snapql/apps/extension/src/panel/search.tsx`): a `<search>` bar `h-10`, its buttons copied from SnapQL's `IconButton`.

- `Pick element` icon button (`[data-testid=pick]`, crosshair icon; the name is its `aria-label` and `title`; `aria-pressed` from `picking()`, `bg-accent/20 text-accent` when on).

- Search field: a rounded `bg-surface` label filling the bar (search icon, accent focus ring) around the input (`[data-testid=search]`, `aria-label="Search components"`, bound to `query()`, native cancel button hidden): input sets the query; Enter steps to the next match, Shift+Enter to the previous.
- Inside the field, only while there's a query: the counter (`[data-testid=search-count]`, `<position> of <matches>`: "1 of 3" after typing, "0 of 0" with no matches) and a `Clear search` icon button.
- `Show DOM elements` icon button (`[data-testid=show-dom]`, `</>` icon, the name as `aria-label` and `title`, `aria-pressed`, accent when on): `setShowHosts`. An icon rather than a labelled pill, so the search field keeps the bar's width.
- `test/Toolbar.test.tsx`: counter, Enter and Shift+Enter, no matches, clearing, the DOM toggle, the picker button.

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
