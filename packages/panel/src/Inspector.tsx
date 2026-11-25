import type {
  CallSite,
  Container,
  HookValue,
  KeyChange,
  Remount,
  RenderKind,
  RenderReason,
  Updater,
  Value,
} from "@reactdx/messages"
import {
  createEffect,
  createResource,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import { ago } from "./ago"
import { answerOf, fromServerOf, hintOf, type Part } from "./answer"
import { Empty, EmptyAction } from "./Empty"
import type { InspectorStore } from "./inspection"
import { type PathRoot, pathKey } from "./paths"
import { type MenuItem, RowMenu } from "./RowMenu"
import { keyboardRows } from "./rows"
import { matches, searchRanges } from "./search"
import { durationText, sizeText } from "./size"
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
import { byName, isContainer, previewText } from "./value"
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
export const KIND_TEXT: Record<RenderKind, string> = {
  mount: "Mounted",
  props: "Props changed",
  state: "State changed",
  context: "Context changed",
  parent: "Parent rendered",
  force: "Forced",
}
const WHY = "Renders"
// A line in a Server Component's Awaited or Client components section.
const SERVER_ROW =
  "flex min-h-5 items-center whitespace-nowrap pr-2 pl-6 font-mono"
// The detail behind one-line summaries until opened.
const FOLDED = [WHY, "Context", "Rendered by"]
// A prop change that's only a new reference (M6 #62), which still re-renders a
// memo child.
const REFERENCE_BADGE = {
  "same-value": {
    text: "same value, new reference",
    title: "A new object equal to the old one: memo sees a change",
  },
  "new-function": {
    text: "new function",
    title: "A function made in the parent's render: memo sees a change",
  },
} as const

// The selected node's values (docs/panel.md, Inspector). Page data is text only.
export function Inspector(props: {
  tree: TreeStore
  inspector: InspectorStore
  // Into the Commits tab: the node's renders, the latest render (unpinned),
  // and a commit by seq.
  onRenders?: () => void
  onLatest?: () => void
  onCommit?: (seq: number) => void
  sources: Sources
  settings: Settings
  // The clock "2s ago" is shown against (Date.now, ticking).
  now?: () => number
  // The sections that start folded (FOLDED).
  folded?: string[]
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
  // Collapsed sections, kept while the panel is open: the detail starts folded
  // behind its header's summary.
  const [collapsed, setCollapsed] = createSignal(
    new Set<string>(props.folded ?? FOLDED),
  )
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
  // A Server Component (M7 #79): run on the server, nothing to edit or re-render.
  const server = () => info()?.kind === "server"
  const awaits = () => props.inspector.data()?.server?.awaits ?? []
  const clients = () => props.inspector.data()?.server?.rendered ?? []
  const fromServer = () => {
    const from = props.inspector.data()?.fromServer
    const name = info()?.name
    return from && name !== undefined
      ? { ...fromServerOf(from, name), from }
      : undefined
  }
  const section = (name: string, root: PathRoot, value: Value | undefined) => (
    <Show when={shown(value) && (value as Container)}>
      {(container) => (
        <Section
          name={name}
          open={!collapsed().has(name)}
          forced={query() !== ""}
          onToggle={() => toggle(name)}
          summary={firstEntry(container())}
        >
          <Children
            inspector={props.inspector}
            value={container()}
            path={{ root, keys: [] }}
            depth={0}
            query={query()}
            editable={!server() && isPlain(container())}
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
  // Where the node sits: its nearest two owners, outer first.
  const nearestOwners = () =>
    (props.inspector.data()?.owners ?? []).slice(0, 2).reverse()
  // Renders' summary: the selected node's counts since the watch.
  const rendersSummary = () => {
    const id = props.tree.selected()
    const count = id === undefined ? undefined : props.tree.countOf(id)
    if (!count) return "none since DevTools opened"
    const wasted = count.wasted ? ` · ${count.wasted} wasted` : ""
    return `${count.renders} since DevTools opened${wasted}`
  }
  // The answer for the render shown (the latest, or the pinned commit's).
  const answer = (): Part[] => {
    if (server()) return ["Ran on the server."]
    const inspector = props.inspector
    if (inspector.absent()) return ["Didn't render in this update."]
    const render = inspector.render()
    if (render === null) return ["This render is no longer recorded."]
    // Stepped back, the render is loading: nothing yet.
    if (!render && inspector.history().length) return []
    const data = inspector.data()
    const now = props.now?.() ?? Date.now()
    return answerOf(render, {
      ago: render?.time === undefined ? undefined : ago(now - render.time),
      parent: data?.owners?.[0],
      hookName: (path) => hookNameOf(data?.hooks ?? [], path, labelOf),
      contextName: (read) => data?.contexts?.[read]?.name ?? "Context",
      nodeName: (id) => props.tree.info(id)?.name,
    })
  }
  const hint = () => {
    if (server()) return
    const render = props.inspector.render()
    const node = info()
    const id = props.tree.selected()
    if (!render || !node || id === undefined || props.inspector.absent()) return
    return hintOf(render, {
      name: node.name,
      memo: node.kind === "memo",
      count: props.tree.countOf(id),
    })
  }
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
              <Show when={props.inspector.data()?.owners?.length}>
                <span data-testid="owners" class="truncate text-muted">
                  in{" "}
                  {(props.inspector.data()?.owners?.length ?? 0) > 2 && "… › "}
                  <For each={nearestOwners()}>
                    {(owner, i) => (
                      <>
                        {i() > 0 && " › "}
                        <Parts
                          parts={[{ node: owner.id, name: owner.name }]}
                          tree={props.tree}
                        />
                      </>
                    )}
                  </For>
                </span>
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
                <Show when={node().kind !== "host" && !server()}>
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
                      {server() ? `Rendered at ${label(at())}` : label(at())}
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
              <Show when={query() === ""}>
                <div class="flex flex-col gap-1 border-border border-b px-2 py-2">
                  <Show when={fromServer()}>
                    {(server) => (
                      <>
                        <p data-testid="server-answer">
                          <Parts parts={server().answer} tree={props.tree} />
                        </p>
                        <For each={server().hints}>
                          {(hint) => (
                            <p
                              data-testid="size-hint"
                              class="rounded bg-highlight/40 px-2 py-1"
                            >
                              {hint}
                            </p>
                          )}
                        </For>
                      </>
                    )}
                  </Show>
                  <p data-testid="answer">
                    <Parts parts={answer()} tree={props.tree} />
                  </p>
                  <Show when={hint()}>
                    {(parts) => (
                      <p
                        data-testid="hint"
                        class="rounded bg-highlight/40 px-2 py-1"
                      >
                        <Parts parts={parts()} tree={props.tree} />{" "}
                        <button
                          type="button"
                          class="text-accent hover:underline"
                          onClick={() => {
                            if (collapsed().has(WHY)) toggle(WHY)
                          }}
                        >
                          See renders
                        </button>
                      </p>
                    )}
                  </Show>
                </div>
              </Show>
              {section("Props", "props", props.inspector.data()?.props)}
              <Show when={fromServer()}>
                {(server) => (
                  <Section
                    name={`Props from ${server().from.owner.name}`}
                    open={!collapsed().has("Props from")}
                    forced={query() !== ""}
                    onToggle={() => toggle("Props from")}
                    summary={server()
                      .from.props.map((prop) => prop.key)
                      .join(", ")}
                  >
                    <For each={server().from.props}>
                      {(prop) => (
                        <div data-testid="server-row" class={SERVER_ROW}>
                          <span data-search-text>{prop.key}</span>{" "}
                          <span class="text-muted">{sizeText(prop)}</span>
                        </div>
                      )}
                    </For>
                  </Section>
                )}
              </Show>
              <Show when={props.inspector.data()?.server?.awaits.length}>
                <Section
                  name="Awaited"
                  open={!collapsed().has("Awaited")}
                  forced={query() !== ""}
                  onToggle={() => toggle("Awaited")}
                  summary={awaits()
                    .map((wait) => wait.name)
                    .join(", ")}
                >
                  <For each={awaits()}>
                    {(wait) => (
                      <div data-testid="server-row" class={SERVER_ROW}>
                        <span data-search-text>{wait.name}</span>{" "}
                        <span class="text-muted">
                          {durationText(wait.end - wait.start)}
                        </span>
                      </div>
                    )}
                  </For>
                </Section>
              </Show>
              <Show when={props.inspector.data()?.server?.rendered.length}>
                <Section
                  name="Client components"
                  open={!collapsed().has("Client components")}
                  forced={query() !== ""}
                  onToggle={() => toggle("Client components")}
                  summary={clients()
                    .map((client) => client.name)
                    .join(", ")}
                >
                  <For each={clients()}>
                    {(client) => (
                      <div data-testid="server-row" class={SERVER_ROW}>
                        <NodeButton
                          tree={props.tree}
                          id={client.id}
                          name={client.name}
                        />{" "}
                        <span class="text-muted">{sizeText(client)}</span>
                      </div>
                    )}
                  </For>
                </Section>
              </Show>
              {section("State", "state", props.inspector.data()?.state)}
              <Show when={hooksShow()}>
                <Section
                  name="Hooks"
                  open={!collapsed().has("Hooks")}
                  forced={query() !== ""}
                  onToggle={() => toggle("Hooks")}
                  summary={[
                    ...new Set(
                      (props.inspector.data()?.hooks ?? []).map(
                        (hook) => hook.name,
                      ),
                    ),
                  ].join(", ")}
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
              {/* Reasons aren't keys or values: the search hides them. */}
              <Show when={query() === "" && !server()}>
                <Section
                  name={WHY}
                  open={!collapsed().has(WHY)}
                  forced={false}
                  onToggle={() => toggle(WHY)}
                  summary={rendersSummary()}
                >
                  <Reasons
                    inspector={props.inspector}
                    tree={props.tree}
                    labelOf={labelOf}
                    onMenu={onMenu}
                    onRenders={props.onRenders}
                    onLatest={props.onLatest}
                    onCommit={props.onCommit}
                  />
                </Section>
              </Show>
              <Show when={contexts().some(contextShows)}>
                <Section
                  name="Context"
                  open={!collapsed().has("Context")}
                  forced={query() !== ""}
                  onToggle={() => toggle("Context")}
                  summary={contexts()
                    .map((context) => context.name)
                    .join(", ")}
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
                  summary={owners()[0]?.name}
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
                          <NodeButton
                            tree={props.tree}
                            id={owner.id}
                            name={owner.name}
                            testid="owner"
                          />
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

// A tree node by name: hovering highlights it on the page, a click selects it.
function NodeButton(props: {
  tree: TreeStore
  id: number
  name: string
  testid?: string
}) {
  return (
    <button
      type="button"
      data-testid={props.testid}
      data-search-text
      class="text-accent hover:underline"
      onPointerEnter={() => props.tree.hover(props.id)}
      onPointerLeave={() => props.tree.hover(undefined)}
      onClick={() => {
        // Selecting replaces this list: no leave event.
        props.tree.hover(undefined)
        props.tree.reveal(props.id)
      }}
    >
      {props.name}
    </button>
  )
}

// An empty inspector: centered, the picker's crosshair above what to do.
function Section(props: {
  name: string
  // What's inside, in a line, shown while it's closed.
  summary?: string
  open: boolean
  // Shown open regardless (while searching), without changing `open`.
  forced: boolean
  onToggle: () => void
  children: JSX.Element
}) {
  const open = () => props.open || props.forced
  const summaryId = createUniqueId()
  return (
    <section data-testid="section" class="border-border border-b py-1">
      {/* A row of the values tree (Keyboard), above its rows: named by the
          section, described by its summary. */}
      <button
        type="button"
        role="treeitem"
        aria-level={1}
        aria-label={props.name}
        aria-describedby={!open() && props.summary ? summaryId : undefined}
        aria-expanded={open()}
        data-path={`section:${props.name}`}
        class="flex w-full items-center gap-1 px-2 py-0.5 font-medium text-muted hover:text-fg focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
        onClick={props.onToggle}
      >
        <Triangle open={open()} />
        {props.name}
        <Show when={!open() && props.summary}>
          {" "}
          <span id={summaryId} class="truncate font-normal font-mono">
            {props.summary}
          </span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="pb-1 font-mono">{props.children}</div>
      </Show>
    </section>
  )
}

// A container's first entry and its preview: a folded section's summary.
function firstEntry(value: Container) {
  const [first] = entriesOf(value).entries
  return first && `${first.name}: ${previewText(first.value)}`
}

// A changed hook as the Hooks section shows it, numbered by its row there
// (depth-first, groups included): two State hooks read apart.
function hookNameOf(
  hooks: HookValue[],
  path: number[],
  labelOf: (hook: HookValue) => string,
) {
  let n = 0
  let name = "Hook"
  const walk = (list: HookValue[], at: number[]) =>
    list.forEach((hook, i) => {
      n++
      const here = [...at, i]
      if (here.join() === path.join()) name = `${labelOf(hook)} #${n}`
      walk(hook.hooks ?? [], here)
    })
  walk(hooks, [])
  return name
}

// A sentence's parts (answer.ts): names in code, components as links when the
// tree has them.
function Parts(props: { parts: Part[]; tree: TreeStore }) {
  return (
    <For each={props.parts}>
      {(part) =>
        typeof part === "string" ? (
          part
        ) : "code" in part ? (
          <code class="font-mono">{part.code}</code>
        ) : part.node !== null && props.tree.info(part.node) ? (
          <NodeLink id={part.node} tree={props.tree} />
        ) : (
          <code class="font-mono">{part.name}</code>
        )
      }
    </For>
  )
}

// Why the node last rendered: a row per reason, its changes under it.
function Reasons(props: {
  inspector: InspectorStore
  tree: TreeStore
  labelOf: (hook: HookValue) => string
  onMenu: OnMenu
  onRenders?: () => void
  onLatest?: () => void
  onCommit?: (seq: number) => void
}) {
  const hookName = (path: number[]) =>
    hookNameOf(props.inspector.data()?.hooks ?? [], path, props.labelOf)
  type Section = "props" | "state" | "hooks" | "contexts"
  type KeyChangeLike = {
    old: Value
    new: Value
    reference?: KeyChange["reference"]
  }
  const change = (
    section: Section,
    name: string,
    { old, new: next, reference }: KeyChangeLike,
  ) => ({
    name,
    old,
    new: next,
    root: { render: section },
    badge: reference && REFERENCE_BADGE[reference],
  })
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
    <>
      <Show when={props.inspector.pinned() !== undefined}>
        <ReasonRow name="pinned" testid="pinned">
          An earlier update
          <button
            type="button"
            tabIndex={-1}
            class="ml-2 text-accent hover:underline"
            onClick={() => props.onLatest?.()}
          >
            Show latest
          </button>
        </ReasonRow>
      </Show>
      <Show when={props.inspector.history().length}>
        {(count) => (
          <ReasonRow name="history" testid="history">
            <button
              type="button"
              tabIndex={-1}
              class="text-accent hover:underline"
              onClick={() => props.onRenders?.()}
            >
              {count()} {count() === 1 ? "render" : "renders"} recorded
            </button>
          </ReasonRow>
        )}
      </Show>
      <Show
        when={!props.inspector.absent() && props.inspector.render()}
        fallback={
          <Switch>
            <Match when={props.inspector.absent()}>
              <p class="pl-6 text-muted">Didn't render in this update.</p>
            </Match>
            <Match when={props.inspector.render() === null}>
              <p class="pl-6 text-muted">This render is no longer recorded.</p>
            </Match>
            {/* Stepped back, the render is loading: nothing yet. */}
            <Match when={!props.inspector.history().length}>
              <p class="pl-6 text-muted">
                No renders recorded since DevTools opened.
              </p>
            </Match>
          </Switch>
        }
      >
        {(render) => (
          <>
            <For each={render().kinds}>
              {(kind) => (
                <>
                  <ReasonRow name={kind}>
                    {kind === "mount" && render().remount ? (
                      <Remounted
                        remount={render().remount as Remount}
                        tree={props.tree}
                      />
                    ) : (
                      KIND_TEXT[kind]
                    )}
                  </ReasonRow>
                  <For each={changesOf(render(), kind)}>
                    {(change) => (
                      <ChangeRow
                        inspector={props.inspector}
                        name={change.name}
                        old={change.old}
                        new={change.new}
                        path={{ root: change.root, keys: [change.name] }}
                        badge={change.badge}
                        depth={1}
                        onMenu={props.onMenu}
                      />
                    )}
                  </For>
                </>
              )}
            </For>
            <Show when={render().effects?.length}>
              <ReasonRow name="effects">Effects ran</ReasonRow>
              <For each={render().effects}>
                {(run) => {
                  const name = hookName(run.hook)
                  return (
                    <>
                      <div
                        role="treeitem"
                        aria-level={3}
                        tabIndex={-1}
                        data-testid="effect"
                        data-path={`effect:${run.hook.join()}`}
                        class={ROW}
                        style={{ "padding-left": "36px" }}
                      >
                        {run.changed
                          ? `${name}: deps [${run.changed.map((c) => c.dep).join(", ")}] changed`
                          : `${name}: no deps`}
                      </div>
                      <For each={run.changed}>
                        {(change) => (
                          <ChangeRow
                            inspector={props.inspector}
                            name={`[${change.dep}]`}
                            old={change.old}
                            new={change.new}
                            path={{
                              root: { render: "effects" },
                              keys: [name, change.dep],
                            }}
                            depth={2}
                            onMenu={props.onMenu}
                          />
                        )}
                      </For>
                    </>
                  )
                }}
              </For>
            </Show>
            <Show when={render().updaters}>
              {(updaters) => (
                <Triggered
                  updaters={updaters()}
                  tree={props.tree}
                  onMore={() => props.onCommit?.(render().seq)}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </>
  )
}

// What remounted a node: its key, or an ancestor (selected by its name).
function Remounted(props: { remount: Remount; tree: TreeStore }) {
  const ancestor = () =>
    props.remount.cause === "ancestor" ? props.remount.ancestor : undefined
  const name = () => {
    const id = ancestor()
    return id === undefined ? undefined : props.tree.info(id)?.name
  }
  const keyText = () => {
    const { from, to } = props.remount as Extract<Remount, { cause: "key" }>
    return `Remounted: key changed (${from ?? "none"} → ${to ?? "none"})`
  }
  return (
    <Switch>
      <Match when={props.remount.cause === "key"}>{keyText()}</Match>
      <Match when={name() === undefined}>
        Remounted: an ancestor remounted
      </Match>
      <Match when={ancestor()}>
        {(id) => (
          <>
            Remounted: ancestor <NodeLink id={id()} tree={props.tree} />{" "}
            remounted
          </>
        )}
      </Match>
    </Switch>
  )
}

// A node's name that highlights it on hover and selects it on click (or
// `onReveal`, from another tab).
export function NodeLink(props: {
  id: number
  tree: TreeStore
  onReveal?: (id: number) => void
}) {
  return (
    <button
      type="button"
      data-testid="owner"
      class="text-accent hover:underline"
      onPointerEnter={() => props.tree.hover(props.id)}
      onPointerLeave={() => props.tree.hover(undefined)}
      onClick={() => {
        props.tree.hover(undefined)
        if (props.onReveal) props.onReveal(props.id)
        else props.tree.reveal(props.id)
      }}
    >
      {props.tree.info(props.id)?.name}
    </button>
  )
}

// The first component whose update scheduled the render's commit, with the
// state it changed; the rest are in the commit (`onMore`). None (a root
// render) is unknown.
function Triggered(props: {
  updaters: Updater[]
  tree: TreeStore
  onMore: () => void
}) {
  const known = () =>
    props.updaters.filter((updater) => props.tree.info(updater.id))
  return (
    <ReasonRow name="trigger" testid="trigger">
      <Show when={known()[0]} fallback="Triggered by: unknown">
        {(first) => (
          <>
            Triggered by <NodeLink id={first().id} tree={props.tree} />
            <Show when={first().hooks.length}>
              {` (${first()
                .hooks.map(
                  (hook) =>
                    `${hook.name}: ${previewText(hook.old)} → ${previewText(hook.new)}`,
                )
                .join(", ")})`}
            </Show>
            <Show when={known().length > 1}>
              {" "}
              <button
                type="button"
                tabIndex={-1}
                class="text-accent hover:underline"
                onClick={() => props.onMore()}
              >
                +{known().length - 1} more
              </button>
            </Show>
          </>
        )}
      </Show>
    </ReasonRow>
  )
}

// A reason's own row (a kind, Effects ran, or Triggered by), above its changes.
function ReasonRow(props: {
  name: string
  testid?: string
  children: JSX.Element
}) {
  return (
    <div
      role="treeitem"
      aria-level={2}
      tabIndex={-1}
      data-testid={props.testid ?? "reason"}
      data-path={`reason:${props.name}`}
      class={ROW}
      style={{ "padding-left": "24px" }}
    >
      {/* One inline run: a flex row drops the spaces between its items. */}
      <span>{props.children}</span>
    </div>
  )
}
