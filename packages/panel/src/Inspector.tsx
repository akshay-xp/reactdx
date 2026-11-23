import type {
  CallSite,
  Container,
  HookValue,
  RenderKind,
  RenderReason,
  Value,
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
import { type PathRoot, pathKey } from "./paths"
import { type MenuItem, RowMenu } from "./RowMenu"
import { keyboardRows } from "./rows"
import { matches, searchRanges } from "./search"
import {
  label,
  locationText,
  type SourceLocation,
  type Sources,
} from "./source"
import {
  ErrorGlyph,
  IconButton,
  PickGlyph,
  ReloadGlyph,
  SearchField,
  SuspenseGlyph,
} from "./Toolbar"
import { BADGES } from "./TreeView"
import type { TreeStore } from "./tree"
import { isPlain } from "./typed"
import { byName, isContainer } from "./value"
import {
  ChangeRow,
  Children,
  type Entry,
  entriesOf,
  entryShows,
  HookRows,
  hookShows,
  type OnMenu,
  ROW,
  Triangle,
  ValueRow,
} from "./values"

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

// What each reason kind reads as, above its changes if it has any.
const KIND_TEXT: Record<RenderKind, string> = {
  mount: "Mounted",
  props: "Props changed",
  state: "State changed",
  context: "Context changed",
  parent: "Parent rendered",
  force: "Forced",
}
const WHY = "Why did this render"

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
  // Show fallback and Show error, for the boundaries the page found above.
  const toggles = () => {
    const found = props.inspector.data()?.boundaries
    return [
      {
        kind: "fallback" as const,
        label: "Show fallback",
        glyph: <SuspenseGlyph />,
      },
      { kind: "error" as const, label: "Show error", glyph: <ErrorGlyph /> },
    ].flatMap((toggle) => {
      const boundary = found?.[toggle.kind]
      return boundary ? [{ ...toggle, boundary }] : []
    })
  }
  // The open right-click menu (RowMenu): a row's key to copy, and where the page
  // finds its value to copy or store.
  const [menu, setMenu] = createSignal<{
    x: number
    y: number
    items: MenuItem[]
  }>()
  const onMenu: OnMenu = (event, key, target, more = []) => {
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
    items.push(...more)
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
  const section = (name: string, root: PathRoot, value: Value | undefined) => (
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
            path={{ root, keys: [] }}
            depth={0}
            query={query()}
            editable={isPlain(container())}
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
  // A context hook's value is edited in its Context row (the provider's value,
  // which every reader sees): opening the section, that row's editor. None for
  // a default value (read-only).
  let values!: HTMLDivElement
  const editContext = (read: number) => {
    const context = props.inspector.data()?.contexts?.[read]
    if (!context || context.default) return undefined
    return () => {
      if (collapsed().has("Context")) toggle("Context")
      const key = pathKey({ root: { context: read }, keys: [] })
      const row = [
        ...values.querySelectorAll<HTMLElement>("[role=treeitem]"),
      ].find((at) => at.dataset.path === key)
      row?.focus()
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    }
  }
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
              <span class="ml-auto flex">
                <For each={toggles()}>
                  {(toggle) => (
                    <IconButton
                      label={toggle.label}
                      pressed={toggle.boundary.on}
                      onClick={() => {
                        props.inspector.force(toggle.kind, !toggle.boundary.on)
                        // Showing it hides or unmounts this node: keep the
                        // boundary, and the toggle to turn it off, in view.
                        if (!toggle.boundary.on)
                          props.tree.reveal(toggle.boundary.id)
                      }}
                    >
                      {toggle.glyph}
                    </IconButton>
                  )}
                </For>
                <Show when={node().kind !== "host"}>
                  <IconButton
                    label="Force re-render"
                    onClick={() => props.inspector.rerender()}
                  >
                    <ReloadGlyph />
                  </IconButton>
                </Show>
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
            <div
              role="tree"
              aria-label="Values"
              class="overflow-y-auto"
              ref={(el) => {
                values = el
                paintMatches(el, query)
                keyboardRows(el)
              }}
            >
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
              {/* Reasons aren't keys or values: the search hides them. */}
              <Show when={query() === ""}>
                <Section
                  name={WHY}
                  open={!collapsed().has(WHY)}
                  forced={false}
                  onToggle={() => toggle(WHY)}
                >
                  <Reasons
                    inspector={props.inspector}
                    labelOf={labelOf}
                    onMenu={onMenu}
                  />
                </Section>
              </Show>
              {section("Props", "props", props.inspector.data()?.props)}
              {section("State", "state", props.inspector.data()?.state)}
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
                    at={[]}
                    depth={0}
                    query={query()}
                    labelOf={labelOf}
                    nameFound={nameFound}
                    editContext={editContext}
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
                    {(context) => (
                      <Show when={contextShows(context)}>
                        <ValueRow
                          inspector={props.inspector}
                          entry={context}
                          path={{ root: { context: context.read }, keys: [] }}
                          depth={0}
                          query={query()}
                          target={{ context: context.read }}
                          editable={!context.default}
                          badge={
                            context.default
                              ? {
                                  text: "default",
                                  title:
                                    "No provider above: its default value, read-only",
                                }
                              : undefined
                          }
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
      {/* A row of the values tree (Keyboard), above its rows. */}
      <button
        type="button"
        role="treeitem"
        aria-level={1}
        aria-expanded={open()}
        data-path={`section:${props.name}`}
        class="flex w-full items-center gap-1 px-2 py-0.5 font-medium text-muted hover:text-fg focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
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

// Why the node last rendered: a row per reason, its changes under it.
function Reasons(props: {
  inspector: InspectorStore
  labelOf: (hook: HookValue) => string
  onMenu: OnMenu
}) {
  // A changed hook as the Hooks section shows it, numbered by its row there
  // (depth-first, groups included): two State hooks read apart.
  const hookName = (path: number[]) => {
    let n = 0
    let name = "Hook"
    const walk = (hooks: HookValue[], at: number[]) =>
      hooks.forEach((hook, i) => {
        n++
        const here = [...at, i]
        if (here.join() === path.join()) name = `${props.labelOf(hook)} #${n}`
        walk(hook.hooks ?? [], here)
      })
    walk(props.inspector.data()?.hooks ?? [], [])
    return name
  }
  type Section = "props" | "state" | "hooks" | "contexts"
  const change = (
    section: Section,
    name: string,
    { old, new: next }: { old: Value; new: Value },
  ) => ({ name, old, new: next, root: { render: section } })
  const changesOf = (render: RenderReason, kind: RenderKind) => {
    if (kind === "props")
      return (render.props ?? []).map((c) => change("props", c.key, c))
    if (kind === "state")
      return [
        ...(render.state ?? []).map((c) => change("state", c.key, c)),
        ...(render.hooks ?? []).map((c) =>
          change("hooks", hookName(c.hook), c),
        ),
      ]
    if (kind === "context")
      return (render.contexts ?? []).map((c) =>
        change(
          "contexts",
          props.inspector.data()?.contexts?.[c.context]?.name ?? "Context",
          c,
        ),
      )
    return []
  }
  return (
    <Show
      when={props.inspector.data()?.render}
      fallback={
        <p class="pl-6 text-muted">
          No renders recorded since DevTools opened.
        </p>
      }
    >
      {(render) => (
        <For each={render().kinds}>
          {(kind) => (
            <>
              <div
                role="treeitem"
                aria-level={2}
                tabIndex={-1}
                data-testid="reason"
                data-path={`reason:${kind}`}
                class={ROW}
                style={{ "padding-left": "24px" }}
              >
                {KIND_TEXT[kind]}
              </div>
              <For each={changesOf(render(), kind)}>
                {(change) => (
                  <ChangeRow
                    inspector={props.inspector}
                    name={change.name}
                    old={change.old}
                    new={change.new}
                    path={{ root: change.root, keys: [change.name] }}
                    depth={1}
                    onMenu={props.onMenu}
                  />
                )}
              </For>
            </>
          )}
        </For>
      )}
    </Show>
  )
}
