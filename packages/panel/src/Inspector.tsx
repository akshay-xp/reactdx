import type {
  CallSite,
  Container,
  HookValue,
  Value,
  ValueKey,
  ValueTarget,
} from "@reactdx/messages"
import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import { Empty, EmptyAction } from "./Empty"
import type { InspectorStore } from "./inspection"
import { type MenuItem, RowMenu } from "./RowMenu"
import { matches, searchRanges } from "./search"
import {
  label,
  locationText,
  type SourceLocation,
  type Sources,
} from "./source"
import { IconButton, PickGlyph, SearchField } from "./Toolbar"
import { BADGES, TRIANGLE } from "./TreeView"
import type { TreeStore } from "./tree"
import { byName, previewText, sortedEntries } from "./value"

// Text color per kind of value, from the theme's syntax tokens.
function tone(value: Value) {
  if (typeof value === "string") return "text-syntax-string"
  if (typeof value === "number") return "text-syntax-number"
  if (value === null || typeof value === "boolean") return "text-accent"
  switch (value.type) {
    case "string":
      return "text-syntax-string"
    case "number":
    case "bigint":
      return "text-syntax-number"
    case "undefined":
    case "function":
    case "symbol":
    case "getter":
    case "hole":
    case "unreadable":
      return "text-muted"
    default:
      return "text-fg"
  }
}

// `key`: where the page finds it in its container (ValueTarget).
type Entry = { name: string; value: Value; arrow?: boolean; key?: ValueKey }
type OnMenu = (event: MouseEvent, key: string, target?: ValueTarget) => void

const isContainer = (value: Value): value is Container =>
  value !== null &&
  typeof value === "object" &&
  "id" in value &&
  value.type !== "ref"

// A container's loaded entries, and how many are still on the page.
function entriesOf(value: Container): { entries: Entry[]; left: number } {
  const named = (props: Record<string, Value> = {}) =>
    sortedEntries(props).map(([name, item]) => ({
      name,
      value: item,
      key: name,
    }))
  const indexed = (items: Value[]) =>
    items.map((item, i) => ({ name: String(i), value: item, key: i }))
  switch (value.type) {
    case "object": {
      const entries = named(value.props)
      return { entries, left: value.size - entries.length }
    }
    case "array":
    case "typed-array":
      return {
        entries: [
          ...indexed(value.items),
          ...named(value.type === "array" ? value.props : undefined),
        ],
        left: value.length - value.items.length,
      }
    case "map":
      return {
        entries: value.entries.map(([key, item], i) => ({
          name: previewText(key),
          value: item,
          arrow: true,
          key: i,
        })),
        left: value.size - value.entries.length,
      }
    case "set":
      return {
        entries: indexed(value.values),
        left: value.size - value.values.length,
      }
  }
}

// A value's children the panel holds: an inline container (or what was loaded
// for it since), or what the page sent for an opened ref. Never asks the page.
function loadedOf(inspector: InspectorStore, value: Value) {
  if (value === null || typeof value !== "object") return undefined
  if (isContainer(value))
    return (inspector.expansion(value.id) as Container | undefined) ?? value
  return value.type === "ref" && "preview" in value
    ? (inspector.expansion(value.id) as Container | undefined)
    : undefined
}

// Whether any loaded descendant of a value shows under the query. `seen`
// guards circular refs.
function descendantShows(
  inspector: InspectorStore,
  value: Value,
  query: string,
  seen = new Set<number>(),
): boolean {
  const loaded = loadedOf(inspector, value)
  if (!query || !loaded || seen.has(loaded.id)) return false
  seen.add(loaded.id)
  return entriesOf(loaded).entries.some((entry) =>
    entryShows(inspector, entry, query, seen),
  )
}

// Whether a row shows under the search query: its name or value text matches,
// or a loaded descendant's does.
function entryShows(
  inspector: InspectorStore,
  entry: Entry,
  query: string,
  seen = new Set<number>(),
): boolean {
  return (
    matches(entry.name, query) ||
    matches(previewText(entry.value), query) ||
    descendantShows(inspector, entry.value, query, seen)
  )
}

// Whether a hook row shows under the query: its label or value text, a
// sub-hook's, or its value's loaded descendants match.
function hookShows(
  inspector: InspectorStore,
  hook: HookValue,
  labelOf: (hook: HookValue) => string,
  query: string,
): boolean {
  const value = hook.value as Value | undefined
  return (
    matches(labelOf(hook), query) ||
    (value !== undefined &&
      (matches(previewText(value), query) ||
        descendantShows(inspector, value, query))) ||
    (hook.hooks ?? []).some((sub) => hookShows(inspector, sub, labelOf, query))
  )
}

// Paints the query's matches in `root` (the CSS Custom Highlight API: no DOM
// change, so a value stays one text node), again whenever rows render.
const HIGHLIGHT = "reactdx-search"
function paintMatches(root: HTMLElement, query: () => string) {
  // jsdom has no CSS.highlights.
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return
  const paint = () => {
    const ranges = searchRanges(root, query())
    if (ranges.length) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges))
    else CSS.highlights.delete(HIGHLIGHT)
  }
  const observer = new MutationObserver(paint)
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  createEffect(paint)
  onCleanup(() => {
    observer.disconnect()
    CSS.highlights.delete(HIGHLIGHT)
  })
}

// Panel settings, kept by the extension (storage.local).
export type Settings = {
  hookNames(): boolean
  setHookNames(on: boolean): void
}

const STORED_MS = 4000

// The selected node's values (docs/panel.md, Inspector). Page data is text only.
export function Inspector(props: {
  tree: TreeStore
  inspector: InspectorStore
  sources: Sources
  settings: Settings
}) {
  // Keyed by value: a re-send's equal source keeps the last resolution shown
  // (no flash), and another source never shows the previous one's location (an
  // "Open in editor" click would open the wrong file).
  const sourceKey = () => {
    const source = props.inspector.data()?.source
    return source && JSON.stringify(source)
  }
  const [resolved] = createResource(sourceKey, async (key) => ({
    key,
    location: await props.sources.resolve(JSON.parse(key)),
  }))
  const location = () => {
    const latest = resolved.latest
    return latest && latest.key === sourceKey() ? latest.location : undefined
  }
  // The location last copied because no dev server opened it.
  const [copied, setCopied] = createSignal<string>()
  // Names a stored value's global for a few seconds.
  createEffect(() => {
    if (!props.inspector.stored()) return
    const timer = setTimeout(() => props.inspector.clearStored(), STORED_MS)
    onCleanup(() => clearTimeout(timer))
  })
  const open = async (at: SourceLocation) => {
    if ((await props.sources.open(at)) === "copied") setCopied(locationText(at))
  }
  const info = () => {
    const id = props.tree.selected()
    return id === undefined ? undefined : props.tree.info(id)
  }
  // The search query, kept across selections: outside the Switch below.
  const [query, setQuery] = createSignal("")
  // Names found for hooks' call sites (Hook names), shared by the rows and the
  // search: `State(count)` with Hook names on and a name found; else the type.
  const [found, setFound] = createSignal(new Map<string, string>())
  const labelOf = (hook: HookValue) => {
    const name =
      props.settings.hookNames() &&
      hook.site &&
      found().get(JSON.stringify(hook.site))
    return name ? `${hook.name}(${name})` : hook.name
  }
  const nameFound = (site: CallSite, name: string) =>
    setFound(new Map(found()).set(JSON.stringify(site), name))
  // The open right-click menu (RowMenu): a row's key to copy, and where the page
  // finds its value to copy or store.
  const [menu, setMenu] = createSignal<{
    x: number
    y: number
    items: MenuItem[]
  }>()
  const onMenu: OnMenu = (event, key, target) => {
    event.preventDefault()
    const items = [
      { label: "Copy key", run: () => props.inspector.copyKey(key) },
    ]
    if (target)
      items.push(
        {
          label: "Copy value",
          run: () => props.inspector.copyValue(target),
        },
        {
          label: "Store as global variable",
          run: () => props.inspector.storeValue(target),
        },
      )
    setMenu({ x: event.clientX, y: event.clientY, items })
  }
  // Collapsed sections, kept while the panel is open.
  const [collapsed, setCollapsed] = createSignal(new Set<string>())
  const toggle = (name: string) => {
    const next = new Set(collapsed())
    if (!next.delete(name)) next.add(name)
    setCollapsed(next)
  }
  const shown = (value: Value | undefined) =>
    value !== undefined &&
    isContainer(value) &&
    entriesOf(value).entries.some((entry) =>
      entryShows(props.inspector, entry, query()),
    )
  const section = (name: string, value: Value | undefined) => (
    <Show when={shown(value) && (value as Container)}>
      {(container) => (
        <Section
          name={name}
          open={!collapsed().has(name)}
          forced={query() !== ""}
          onToggle={() => toggle(name)}
        >
          <Children
            inspector={props.inspector}
            value={container()}
            path={name}
            depth={0}
            query={query()}
            onMenu={onMenu}
          />
        </Section>
      )}
    </Show>
  )
  // Alphabetical, and only those that show under the query. `read`: the page's
  // index, in read order.
  const contexts = () =>
    (props.inspector.data()?.contexts ?? [])
      .map((context, read) => ({ ...context, read }))
      .sort((a, b) => byName(a.name, b.name))
  const contextShows = (context: Entry) =>
    entryShows(props.inspector, context, query())
  const hooksShow = () =>
    Boolean(props.inspector.data()?.hooksError) ||
    (props.inspector.data()?.hooks ?? []).some((hook) =>
      hookShows(props.inspector, hook, labelOf, query()),
    )
  const owners = () =>
    (props.inspector.data()?.owners ?? []).filter((owner) =>
      matches(owner.name, query()),
    )
  const anyShown = () => {
    const data = props.inspector.data()
    return (
      shown(data?.props) ||
      shown(data?.state) ||
      hooksShow() ||
      contexts().some(contextShows) ||
      owners().length > 0
    )
  }
  return (
    <Switch>
      <Match when={!info()}>
        <Empty
          icon={<PickGlyph />}
          title="Select a component to inspect it."
          hint="Click it in the tree, or pick it on the page."
        >
          <EmptyAction
            icon={<PickGlyph />}
            pressed={props.tree.picking()}
            onClick={() => props.tree.setPicking(!props.tree.picking())}
          >
            {props.tree.picking()
              ? "Click an element on the page"
              : "Pick an element"}
          </EmptyAction>
        </Empty>
      </Match>
      <Match when={props.inspector.gone()}>
        <Empty
          icon={<PickGlyph />}
          title="This component unmounted."
          hint="Select another in the tree."
        />
      </Match>
      <Match when={info()}>
        {(node) => (
          <div class="flex min-h-0 flex-col">
            <header
              data-testid="inspector-header"
              class="flex h-8 shrink-0 items-center gap-2 border-border border-b px-2 font-mono"
            >
              <span class="truncate text-fg">{node().name}</span>
              <Show when={BADGES.has(node().kind)}>
                <span class="rounded bg-surface px-1 text-muted">
                  {node().kind}
                </span>
              </Show>
              <Show when={node().key !== null}>
                <span class="truncate text-muted">{`key="${node().key}"`}</span>
              </Show>
              <span class="ml-auto">
                <IconButton
                  label="Hook names"
                  pressed={props.settings.hookNames()}
                  onClick={() =>
                    props.settings.setHookNames(!props.settings.hookNames())
                  }
                >
                  <path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l6.6-6.6a1 1 0 0 0 0-1.4z" />
                  <circle cx="7" cy="7" r="1.5" />
                </IconButton>
              </span>
            </header>
            <div class="flex h-8 shrink-0 items-center border-border border-b px-2 py-1">
              <SearchField
                label="Search keys and values"
                testid="inspector-search"
                clearLabel="Clear value search"
                value={query()}
                onInput={setQuery}
                onKeyDown={(event) => event.key === "Escape" && setQuery("")}
              />
            </div>
            <div class="overflow-y-auto" ref={(el) => paintMatches(el, query)}>
              <Show when={location()}>
                {(at) => (
                  <div
                    data-testid="source"
                    class="flex h-7 shrink-0 items-center gap-2 border-border border-b px-2 font-mono text-muted"
                  >
                    <span class="truncate" title={locationText(at())}>
                      {label(at())}
                    </span>
                    <button
                      type="button"
                      class="shrink-0 cursor-pointer text-accent hover:underline"
                      onClick={() => open(at())}
                    >
                      Open in editor
                    </button>
                    <Show when={copied() === locationText(at())}>
                      <span class="shrink-0">Copied</span>
                      <Show when={at().file.startsWith("/")}>
                        <a
                          class="shrink-0 text-accent hover:underline"
                          href={`vscode://file${locationText(at())}`}
                        >
                          VS Code
                        </a>
                      </Show>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={query() !== "" && !anyShown()}>
                <p class="p-2 text-muted">No matches</p>
              </Show>
              {section("Props", props.inspector.data()?.props)}
              {section("State", props.inspector.data()?.state)}
              <Show when={hooksShow()}>
                <Section
                  name="Hooks"
                  open={!collapsed().has("Hooks")}
                  forced={query() !== ""}
                  onToggle={() => toggle("Hooks")}
                >
                  <Show when={props.inspector.data()?.hooksError}>
                    {(error) => (
                      <p class="pl-6 text-error">{`Couldn't read hooks: ${error()}`}</p>
                    )}
                  </Show>
                  <HookRows
                    inspector={props.inspector}
                    sources={props.sources}
                    settings={props.settings}
                    hooks={props.inspector.data()?.hooks ?? []}
                    path="Hooks"
                    at={[]}
                    depth={0}
                    query={query()}
                    labelOf={labelOf}
                    nameFound={nameFound}
                    onMenu={onMenu}
                  />
                </Section>
              </Show>
              <Show when={contexts().some(contextShows)}>
                <Section
                  name="Context"
                  open={!collapsed().has("Context")}
                  forced={query() !== ""}
                  onToggle={() => toggle("Context")}
                >
                  <For each={contexts()}>
                    {(context, index) => (
                      <Show when={contextShows(context)}>
                        <ValueRow
                          inspector={props.inspector}
                          entry={context}
                          path={`Context.${index()}`}
                          depth={0}
                          query={query()}
                          target={{ context: context.read }}
                          onMenu={onMenu}
                        />
                      </Show>
                    )}
                  </For>
                </Section>
              </Show>
              <Show when={owners().length}>
                <Section
                  name="Rendered by"
                  open={!collapsed().has("Rendered by")}
                  forced={query() !== ""}
                  onToggle={() => toggle("Rendered by")}
                >
                  <For each={owners()}>
                    {(owner) => (
                      <div class="flex min-h-5 items-center whitespace-nowrap pr-2 pl-6">
                        {owner.id === null ? (
                          <span
                            data-testid="owner"
                            data-search-text
                            class="text-muted"
                          >
                            {owner.name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            data-testid="owner"
                            data-search-text
                            class="text-accent hover:underline"
                            onPointerEnter={() =>
                              props.tree.hover(owner.id as number)
                            }
                            onPointerLeave={() => props.tree.hover(undefined)}
                            onClick={() => {
                              // Selecting replaces this list: no leave event.
                              props.tree.hover(undefined)
                              props.tree.reveal(owner.id as number)
                            }}
                          >
                            {owner.name}
                          </button>
                        )}
                      </div>
                    )}
                  </For>
                </Section>
              </Show>
            </div>
            {/* Always there, so a screen reader announces what it says. */}
            <div
              role="status"
              class="pointer-events-none fixed right-2 bottom-2 max-w-[90vw]"
            >
              <Show when={props.inspector.stored()}>
                {(name) => (
                  <p class="rounded-md border border-border bg-surface px-2 py-1 text-fg shadow-lg">
                    Stored as <code class="font-mono">{name()}</code>. Use it in
                    the Console.
                  </p>
                )}
              </Show>
            </div>
            <Show when={menu()}>
              {(at) => (
                <RowMenu
                  x={at().x}
                  y={at().y}
                  items={at().items}
                  onClose={() => setMenu(undefined)}
                />
              )}
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  )
}

// An empty inspector: centered, the picker's crosshair above what to do.
function Section(props: {
  name: string
  open: boolean
  // Shown open regardless (while searching), without changing `open`.
  forced: boolean
  onToggle: () => void
  children: JSX.Element
}) {
  const open = () => props.open || props.forced
  return (
    <section data-testid="section" class="border-border border-b py-1">
      <button
        type="button"
        aria-expanded={open()}
        class="flex w-full items-center gap-1 px-2 py-0.5 font-medium text-muted hover:text-fg"
        onClick={props.onToggle}
      >
        <Triangle open={open()} />
        {props.name}
      </button>
      <Show when={open()}>
        <div class="pb-1 font-mono">{props.children}</div>
      </Show>
    </section>
  )
}

// The tree's toggle triangle.
function Triangle(props: { open: boolean }) {
  return (
    <span class="flex w-3 shrink-0 justify-center" aria-hidden="true">
      <span style={TRIANGLE} classList={{ "rotate-90": props.open }} />
    </span>
  )
}

// A container's rows, with what was loaded for it since (more pages).
function Children(props: {
  inspector: InspectorStore
  value: Container
  path: string
  depth: number
  query: string
  onMenu: OnMenu
}) {
  const loaded = () =>
    (props.inspector.expansion(props.value.id) as Container | undefined) ??
    props.value
  const list = () => entriesOf(loaded())
  return (
    <>
      <For
        each={list().entries.filter((entry) =>
          entryShows(props.inspector, entry, props.query),
        )}
      >
        {(entry) => (
          <ValueRow
            inspector={props.inspector}
            entry={entry}
            path={`${props.path}.${entry.name}`}
            depth={props.depth}
            query={props.query}
            target={{ objectId: loaded().id, key: entry.key as ValueKey }}
            onMenu={props.onMenu}
          />
        )}
      </For>
      <Show when={list().left > 0 && loaded().nextOffset !== undefined}>
        <button
          type="button"
          class="text-accent hover:underline"
          style={{ "padding-left": `${(props.depth + 2) * 12}px` }}
          onClick={() => props.inspector.more(loaded())}
        >
          {`Show more (${list().left} left)`}
        </button>
      </Show>
    </>
  )
}

// Hooks in call order. A custom hook opens to the hooks it called; a hook with
// nothing to show (an effect without deps) is just its name.
function HookRows(props: {
  inspector: InspectorStore
  sources: Sources
  settings: Settings
  hooks: HookValue[]
  path: string
  // Call indexes from the top: the page's address for a hook (ValueTarget).
  at: number[]
  depth: number
  query: string
  labelOf: (hook: HookValue) => string
  nameFound: (site: CallSite, name: string) => void
  onMenu: OnMenu
}) {
  return (
    <For each={props.hooks}>
      {(hook, index) => {
        // Paths are by call index, so hooks hidden by the search stay in the list.
        const path = () => `${props.path}.${index()}`
        const at = () => [...props.at, index()]
        const target = () =>
          hook.value === undefined ? undefined : { hook: at() }
        const open = () => props.inspector.isOpen(path())
        // While searching, a custom hook opens to a matching sub-hook.
        const shownOpen = () =>
          open() ||
          (props.query !== "" &&
            (hook.hooks ?? []).some((sub) =>
              hookShows(props.inspector, sub, props.labelOf, props.query),
            ))
        createResource(
          () => props.settings.hookNames() && hook.site,
          async (site) => {
            const name = await props.sources.hookName(site)
            if (name) props.nameFound(site, name)
            return name
          },
        )
        const label = () => props.labelOf(hook)
        return (
          <Show
            when={hookShows(props.inspector, hook, props.labelOf, props.query)}
          >
            <Switch>
              <Match when={hook.hooks}>
                {(hooks) => (
                  <>
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: a right-click shortcut; rows take no focus yet */}
                    <div
                      data-testid="value"
                      class="flex min-h-5 items-center whitespace-nowrap pr-2"
                      style={{ "padding-left": `${(props.depth + 1) * 12}px` }}
                      onContextMenu={(event) =>
                        props.onMenu(event, label(), target())
                      }
                    >
                      <Toggle
                        open={shownOpen()}
                        onClick={() =>
                          open()
                            ? props.inspector.close(path())
                            : props.inspector.open(path())
                        }
                      />
                      <span class="min-w-0 truncate">
                        <span data-search-text class="text-syntax-key">
                          {hook.value === undefined ? label() : `${label()}:`}
                        </span>
                        <Show when={hook.value !== undefined}>
                          {" "}
                          <span
                            data-search-text
                            class={tone(hook.value as Value)}
                          >
                            {previewText(hook.value as Value)}
                          </span>
                        </Show>
                      </span>
                    </div>
                    <Show when={shownOpen()}>
                      <HookRows
                        inspector={props.inspector}
                        sources={props.sources}
                        settings={props.settings}
                        hooks={hooks()}
                        path={path()}
                        at={at()}
                        depth={props.depth + 1}
                        query={props.query}
                        labelOf={props.labelOf}
                        nameFound={props.nameFound}
                        onMenu={props.onMenu}
                      />
                    </Show>
                  </>
                )}
              </Match>
              <Match when={hook.value !== undefined}>
                <ValueRow
                  inspector={props.inspector}
                  entry={{ name: label(), value: hook.value as Value }}
                  path={path()}
                  depth={props.depth}
                  query={props.query}
                  target={target()}
                  onMenu={props.onMenu}
                />
              </Match>
              <Match when={hook.value === undefined}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: a right-click shortcut; rows take no focus yet */}
                <div
                  data-testid="value"
                  data-search-text
                  class="flex min-h-5 items-center whitespace-nowrap pr-2 text-syntax-key"
                  style={{ "padding-left": `${(props.depth + 1) * 12 + 12}px` }}
                  onContextMenu={(event) => props.onMenu(event, label())}
                >
                  {label()}
                </div>
              </Match>
            </Switch>
          </Show>
        )
      }}
    </For>
  )
}

// Opens or closes a value or custom hook in place (the tree's triangle).
function Toggle(props: { open: boolean; onClick: () => void }) {
  return (
    <span class="flex w-3 shrink-0 justify-center">
      <button
        type="button"
        data-testid="value-toggle"
        aria-label={props.open ? "Collapse" : "Expand"}
        aria-expanded={props.open}
        class="flex h-3 w-3 items-center justify-center text-muted"
        onClick={() => props.onClick()}
      >
        <span style={TRIANGLE} classList={{ "rotate-90": props.open }} />
      </button>
    </span>
  )
}

function ValueRow(props: {
  inspector: InspectorStore
  entry: Entry
  path: string
  depth: number
  query: string
  // Where the page finds the value; none: only the key can be copied.
  target?: ValueTarget
  onMenu: OnMenu
}) {
  const value = () => props.entry.value
  // A value the page sent as a ref (past its depth limit) loads when opened.
  const ref = () => {
    const v = value()
    return v !== null &&
      typeof v === "object" &&
      v.type === "ref" &&
      "preview" in v
      ? v.id
      : undefined
  }
  // What opening shows: the value itself, or what the page sent for the ref.
  const target = () => {
    const v = value()
    if (isContainer(v)) return v
    const id = ref()
    return id === undefined
      ? undefined
      : (props.inspector.expansion(id) as Container | undefined)
  }
  const openable = () => isContainer(value()) || ref() !== undefined
  const open = () => props.inspector.isOpen(props.path)
  // While searching, open to a match inside, without changing what's open.
  const shownOpen = () =>
    open() || descendantShows(props.inspector, value(), props.query)
  const toggle = () =>
    open()
      ? props.inspector.close(props.path)
      : props.inspector.open(props.path, ref())
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a right-click shortcut; rows take no focus yet */}
      <div
        data-testid="value"
        class="flex min-h-5 items-center whitespace-nowrap pr-2"
        style={{ "padding-left": `${(props.depth + 1) * 12}px` }}
        onContextMenu={(event) =>
          props.onMenu(event, props.entry.name, props.target)
        }
      >
        <Show when={openable()} fallback={<span class="w-3 shrink-0" />}>
          <Toggle open={shownOpen()} onClick={toggle} />
        </Show>
        {/* Inline, not flex items: flex drops the spaces between them. */}
        <span class="min-w-0 truncate">
          <span data-search-text class="text-syntax-key">
            {props.entry.arrow ? props.entry.name : `${props.entry.name}:`}
          </span>
          {props.entry.arrow ? " => " : " "}
          <span data-search-text class={tone(value())}>
            {previewText(value())}
          </span>
        </span>
      </div>
      <Show when={shownOpen() && target()}>
        {(container) => (
          <Children
            inspector={props.inspector}
            value={container()}
            path={props.path}
            depth={props.depth + 1}
            query={props.query}
            onMenu={props.onMenu}
          />
        )}
      </Show>
    </>
  )
}
