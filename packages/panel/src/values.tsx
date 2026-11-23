import type {
  CallSite,
  Container,
  HookValue,
  Value,
  ValueKey,
  ValueTarget,
} from "@reactdx/messages"
import {
  createResource,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from "solid-js"
import type { Settings } from "./Inspector"
import type { InspectorStore } from "./inspection"
import { childPath, pathKey, type RowPath } from "./paths"
import type { MenuItem } from "./RowMenu"
import { matches } from "./search"
import type { Sources } from "./source"
import { TRIANGLE } from "./TreeView"
import { editText, isPlain, parseTyped } from "./typed"
import { isContainer, previewText, sortedEntries } from "./value"

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
export type Entry = {
  name: string
  value: Value
  arrow?: boolean
  key?: ValueKey
}
// `more`: a row's own items (Rename key, Delete), after the copies.
export type OnMenu = (
  event: MouseEvent,
  key: string,
  target?: ValueTarget,
  more?: MenuItem[],
) => void

// A container's loaded entries, and how many are still on the page.
export function entriesOf(value: Container): {
  entries: Entry[]
  left: number
} {
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
export function entryShows(
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
export function hookShows(
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

// A value, hook or context row: one of the keyboard rows (src/rows.ts).
const ROW =
  "group flex min-h-5 items-center whitespace-nowrap pr-2 focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"

// The tree's toggle triangle.
export function Triangle(props: { open: boolean }) {
  return (
    <span class="flex w-3 shrink-0 justify-center" aria-hidden="true">
      <span style={TRIANGLE} classList={{ "rotate-90": props.open }} />
    </span>
  )
}

// A container's rows, with what was loaded for it since (more pages).
export function Children(props: {
  inspector: InspectorStore
  value: Container
  path: RowPath
  depth: number
  query: string
  // Its entries can be written: every container down to it is plain.
  editable: boolean
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
            path={childPath(props.path, entry.key as ValueKey)}
            editable={props.editable}
            objectKey={loaded().type === "object"}
            siblings={list().entries.map((other) => other.name)}
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
export function HookRows(props: {
  inspector: InspectorStore
  sources: Sources
  settings: Settings
  hooks: HookValue[]
  // Call indexes from the top: the hook's row path root and the page's address
  // for it (ValueTarget).
  at: number[]
  depth: number
  query: string
  labelOf: (hook: HookValue) => string
  nameFound: (site: CallSite, name: string) => void
  // A context hook's edit, by the context's read index (Inspector editContext).
  editContext: (read: number) => (() => void) | undefined
  onMenu: OnMenu
}) {
  return (
    <For each={props.hooks}>
      {(hook, index) => {
        // Paths are by call index, so hooks hidden by the search stay in the list.
        const at = () => [...props.at, index()]
        const path = (): RowPath => ({ root: { hook: at() }, keys: [] })
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
                    <div
                      data-testid="value"
                      role="treeitem"
                      tabIndex={-1}
                      aria-level={props.depth + 2}
                      aria-expanded={shownOpen()}
                      data-path={pathKey(path())}
                      class={ROW}
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
                        at={at()}
                        depth={props.depth + 1}
                        query={props.query}
                        labelOf={props.labelOf}
                        nameFound={props.nameFound}
                        editContext={props.editContext}
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
                  editable={hook.name === "State" || hook.name === "Reducer"}
                  editAt={
                    hook.context === undefined
                      ? undefined
                      : props.editContext(hook.context)
                  }
                  path={path()}
                  depth={props.depth}
                  query={props.query}
                  target={target()}
                  onMenu={props.onMenu}
                />
              </Match>
              <Match when={hook.value === undefined}>
                <div
                  data-testid="value"
                  role="treeitem"
                  tabIndex={-1}
                  aria-level={props.depth + 2}
                  data-path={pathKey(path())}
                  data-search-text
                  class={`${ROW} text-syntax-key`}
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

// A value's text being edited: focused on mount; Enter applies, Escape cancels,
// leaving cancels.
function ValueInput(props: {
  text: string
  // The input's accessible name and test id: a value's or a key's editor.
  label: string
  testid: string
  // Why the last Enter was refused, shown until the next.
  error?: string
  onApply: (text: string) => void
  onCancel: () => void
  onBlur: () => void
}) {
  let input!: HTMLInputElement
  onMount(() => input.focus())
  return (
    <>
      <input
        ref={input}
        data-testid={props.testid}
        // No form history: Firefox would make it an autocomplete combobox.
        autocomplete="off"
        aria-label={props.label}
        aria-invalid={Boolean(props.error)}
        value={props.text}
        class="min-w-0 flex-1 rounded-sm bg-surface px-1 font-mono text-fg outline-none ring-1 ring-accent"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            props.onApply(input.value)
          } else if (event.key === "Escape") {
            // DevTools opens its drawer on Escape.
            event.preventDefault()
            event.stopPropagation()
            props.onCancel()
          }
        }}
        onBlur={() => props.onBlur()}
      />
      <Show when={props.error}>
        <span role="alert" class="ml-2 shrink-0 text-error">
          {props.error}
        </span>
      </Show>
    </>
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

export function ValueRow(props: {
  inspector: InspectorStore
  entry: Entry
  path: RowPath
  depth: number
  query: string
  // Where the page finds the value; none: only the key can be copied.
  target?: ValueTarget
  // The page can write it (a top-level prop, a state hook).
  editable?: boolean
  // Edited in another row instead (a context hook, in its Context row).
  editAt?: () => void
  // Its container is a plain object (its key can be renamed), and the names
  // there (a rename can't take one).
  objectKey?: boolean
  siblings?: string[]
  // A muted word after the value, its title saying why.
  badge?: { text: string; title: string }
  onMenu: OnMenu
}) {
  const value = () => props.entry.value
  let row!: HTMLDivElement
  // Any editable value but a boolean (which flips) is typed; what the panel holds
  // only part of opens empty, to be replaced (editText).
  const canEdit = () => (props.editable && !isFlag()) || Boolean(props.editAt)
  // A boolean flips (its checkbox, or Space on the row); the page's re-send
  // shows the result, so the checkbox never runs ahead of it.
  const isFlag = () => props.editable && typeof value() === "boolean"
  const flip = () => props.inspector.edit(props.path, !value())
  const [editing, setEditing] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  const edit = () => {
    if (props.editAt) return props.editAt()
    if (!canEdit()) return
    setInvalid(false)
    setEditing(true)
  }
  const done = () => {
    setEditing(false)
    setRenaming(false)
    row.focus()
  }
  // A key under a plain container can be deleted, and under an object renamed
  // to a name its siblings don't have.
  const [renaming, setRenaming] = createSignal(false)
  const [badName, setBadName] = createSignal(false)
  const rename = (name: string) => {
    if (name === props.entry.name) return done()
    if (!name.trim() || props.siblings?.includes(name)) return setBadName(true)
    props.inspector.rename(props.path, name)
    done()
  }
  const keyItems = () =>
    props.editable && props.path.keys.length > 0
      ? [
          ...(props.objectKey
            ? [
                {
                  label: "Rename key",
                  run: () => {
                    setBadName(false)
                    setRenaming(true)
                  },
                },
              ]
            : []),
          { label: "Delete", run: () => props.inspector.remove(props.path) },
        ]
      : []
  // A plain container gets a key (`newKey`, else the first free `newKey<n>`)
  // or an item at its end; the page's re-send shows it, to edit and rename.
  const addItems = () => {
    const container = target()
    if (!props.editable || !container || !isPlain(container)) return []
    if (container.type === "array")
      return [
        {
          label: "Add item",
          run: () =>
            props.inspector.edit(childPath(props.path, container.length), {
              type: "undefined",
            }),
        },
      ]
    const taken = new Set(entriesOf(container).entries.map((e) => e.name))
    let name = "newKey"
    for (let n = 2; taken.has(name); n++) name = `newKey${n}`
    return [
      {
        label: "Add key",
        run: () => props.inspector.edit(childPath(props.path, name), ""),
      },
    ]
  }
  // JSON plus markers (parseTyped); text that reads as nothing is a string
  // over a string, and refused over anything else.
  const apply = (text: string) => {
    const next =
      parseTyped(text) ?? (typeof value() === "string" ? text : undefined)
    if (next === undefined) return setInvalid(true)
    props.inspector.edit(props.path, next)
    done()
  }
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
      <div
        ref={row}
        data-testid="value"
        role="treeitem"
        tabIndex={-1}
        aria-level={props.depth + 2}
        aria-expanded={openable() ? shownOpen() : undefined}
        data-path={pathKey(props.path)}
        class={ROW}
        style={{ "padding-left": `${(props.depth + 1) * 12}px` }}
        onContextMenu={(event) =>
          props.onMenu(event, props.entry.name, props.target, [
            ...addItems(),
            ...keyItems(),
          ])
        }
        // A click on the value edits it (Enter or F2 on the row too).
        onClick={(event) => {
          if ((event.target as Element).closest("[data-value]")) edit()
        }}
        onKeyDown={(event) => {
          if (event.target !== row) return
          if (event.key === "Enter" || event.key === "F2") {
            event.preventDefault()
            edit()
          } else if (event.key === " " && isFlag()) {
            event.preventDefault()
            flip()
          }
        }}
      >
        <Show when={openable()} fallback={<span class="w-3 shrink-0" />}>
          <Toggle open={shownOpen()} onClick={toggle} />
        </Show>
        <Show when={isFlag()}>
          <input
            type="checkbox"
            tabIndex={-1}
            aria-label={props.entry.name}
            checked={value() as boolean}
            class="mr-1 accent-accent"
            onChange={(event) => {
              event.currentTarget.checked = value() as boolean
              flip()
            }}
          />
        </Show>
        <Show when={renaming()}>
          <ValueInput
            text={props.entry.name}
            label={`Rename ${props.entry.name}`}
            testid="key-input"
            error={badName() ? "Not a valid name" : undefined}
            onApply={rename}
            onCancel={done}
            onBlur={() => setRenaming(false)}
          />
        </Show>
        {/* Inline, not flex items: flex drops the spaces between them. */}
        <span class="min-w-0 truncate" classList={{ hidden: renaming() }}>
          <span data-search-text class="text-syntax-key">
            {props.entry.arrow ? props.entry.name : `${props.entry.name}:`}
          </span>
          {props.entry.arrow ? " => " : " "}
          <Show when={!editing()}>
            <span
              data-search-text
              data-value
              class={tone(value())}
              classList={{ "editable-value": canEdit() }}
            >
              {previewText(value())}
            </span>
          </Show>
          <Show when={props.badge}>
            {(badge) => (
              <>
                {" "}
                <span
                  data-testid="badge"
                  class="text-muted"
                  title={badge().title}
                >
                  {badge().text}
                </span>
              </>
            )}
          </Show>
        </span>
        <Show when={editing()}>
          <ValueInput
            text={editText(value())}
            label={`Edit ${props.entry.name}`}
            testid="value-input"
            error={invalid() ? "Not a valid value" : undefined}
            onApply={apply}
            onCancel={done}
            onBlur={() => setEditing(false)}
          />
        </Show>
      </div>
      <Show when={shownOpen() && target()}>
        {(container) => (
          <Children
            inspector={props.inspector}
            value={container()}
            path={props.path}
            depth={props.depth + 1}
            query={props.query}
            editable={Boolean(props.editable) && isPlain(container())}
            onMenu={props.onMenu}
          />
        )}
      </Show>
    </>
  )
}
