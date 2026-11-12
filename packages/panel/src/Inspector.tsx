import type { Container, HookValue, Value } from "@reactdx/messages"
import {
  createResource,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js"
import type { InspectorStore } from "./inspection"
import {
  label,
  locationText,
  type SourceLocation,
  type Sources,
} from "./source"
import { IconButton } from "./Toolbar"
import { BADGES, TRIANGLE } from "./TreeView"
import type { TreeStore } from "./tree"
import { previewText } from "./value"

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

type Entry = { name: string; value: Value; arrow?: boolean }

const isContainer = (value: Value): value is Container =>
  value !== null &&
  typeof value === "object" &&
  "id" in value &&
  value.type !== "ref"

// A container's loaded entries, and how many are still on the page.
function entriesOf(value: Container): { entries: Entry[]; left: number } {
  const named = (props: Record<string, Value> = {}) =>
    Object.entries(props).map(([name, item]) => ({ name, value: item }))
  const indexed = (items: Value[]) =>
    items.map((item, i) => ({ name: String(i), value: item }))
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
        entries: value.entries.map(([key, item]) => ({
          name: previewText(key),
          value: item,
          arrow: true,
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

// Panel settings, kept by the extension (storage.local).
export type Settings = {
  hookNames(): boolean
  setHookNames(on: boolean): void
}

// The selected node's values (docs/panel.md, Inspector). Page data is text only.
export function Inspector(props: {
  tree: TreeStore
  inspector: InspectorStore
  sources: Sources
  settings: Settings
}) {
  const [resolved] = createResource(
    () => props.inspector.data()?.source,
    (source) => props.sources.resolve(source),
  )
  // The last resolution stays shown while a re-send's equal source resolves.
  const location = () =>
    props.inspector.data()?.source ? resolved.latest : undefined
  // The location last copied because no dev server opened it.
  const [copied, setCopied] = createSignal<string>()
  const open = async (at: SourceLocation) => {
    if ((await props.sources.open(at)) === "copied") setCopied(locationText(at))
  }
  const info = () => {
    const id = props.tree.selected()
    return id === undefined ? undefined : props.tree.info(id)
  }
  // Collapsed sections, kept while the panel is open.
  const [collapsed, setCollapsed] = createSignal(new Set<string>())
  const toggle = (name: string) => {
    const next = new Set(collapsed())
    if (!next.delete(name)) next.add(name)
    setCollapsed(next)
  }
  const section = (name: string, value: Value | undefined) => (
    <Show
      when={
        value !== undefined &&
        isContainer(value) &&
        entriesOf(value).entries.length > 0 &&
        value
      }
    >
      {(container) => (
        <Section
          name={name}
          open={!collapsed().has(name)}
          onToggle={() => toggle(name)}
        >
          <Children
            inspector={props.inspector}
            value={container()}
            path={name}
            depth={0}
          />
        </Section>
      )}
    </Show>
  )
  return (
    <Switch>
      <Match when={!info()}>
        <p class="p-2 text-muted">Select a component to inspect it.</p>
      </Match>
      <Match when={props.inspector.gone()}>
        <p class="p-2 text-muted">This component unmounted.</p>
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
            <div class="overflow-y-auto">
              {section("Props", props.inspector.data()?.props)}
              {section("State", props.inspector.data()?.state)}
              <Show
                when={
                  props.inspector.data()?.hooks?.length ||
                  props.inspector.data()?.hooksError
                }
              >
                <Section
                  name="Hooks"
                  open={!collapsed().has("Hooks")}
                  onToggle={() => toggle("Hooks")}
                >
                  <Show when={props.inspector.data()?.hooksError}>
                    {(error) => (
                      <p class="pl-6 text-error">{`Couldn't read hooks: ${error()}`}</p>
                    )}
                  </Show>
                  <HookRows
                    inspector={props.inspector}
                    hooks={props.inspector.data()?.hooks ?? []}
                    path="Hooks"
                    depth={0}
                  />
                </Section>
              </Show>
              <Show when={props.inspector.data()?.contexts?.length}>
                <Section
                  name="Context"
                  open={!collapsed().has("Context")}
                  onToggle={() => toggle("Context")}
                >
                  <For each={props.inspector.data()?.contexts}>
                    {(context, index) => (
                      <ValueRow
                        inspector={props.inspector}
                        entry={context}
                        path={`Context.${index()}`}
                        depth={0}
                      />
                    )}
                  </For>
                </Section>
              </Show>
              <Show when={props.inspector.data()?.owners?.length}>
                <Section
                  name="Rendered by"
                  open={!collapsed().has("Rendered by")}
                  onToggle={() => toggle("Rendered by")}
                >
                  <For each={props.inspector.data()?.owners}>
                    {(owner) => (
                      <div class="whitespace-nowrap pr-2 pl-6">
                        {owner.id === null ? (
                          <span data-testid="owner" class="text-muted">
                            {owner.name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            data-testid="owner"
                            class="text-accent hover:underline"
                            onClick={() =>
                              props.tree.reveal(owner.id as number)
                            }
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
          </div>
        )}
      </Match>
    </Switch>
  )
}

function Section(props: {
  name: string
  open: boolean
  onToggle: () => void
  children: JSX.Element
}) {
  return (
    <section data-testid="section" class="border-border border-b py-1">
      <button
        type="button"
        aria-expanded={props.open}
        class="flex w-full items-center gap-1 px-2 py-0.5 font-medium text-muted hover:text-fg"
        onClick={props.onToggle}
      >
        <Triangle open={props.open} />
        {props.name}
      </button>
      <Show when={props.open}>
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
}) {
  const loaded = () =>
    (props.inspector.expansion(props.value.id) as Container | undefined) ??
    props.value
  const list = () => entriesOf(loaded())
  return (
    <>
      <For each={list().entries}>
        {(entry) => (
          <ValueRow
            inspector={props.inspector}
            entry={entry}
            path={`${props.path}.${entry.name}`}
            depth={props.depth}
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
  hooks: HookValue[]
  path: string
  depth: number
}) {
  return (
    <For each={props.hooks}>
      {(hook, index) => {
        const path = () => `${props.path}.${index()}`
        const open = () => props.inspector.isOpen(path())
        return (
          <Switch>
            <Match when={hook.hooks}>
              {(hooks) => (
                <>
                  <div
                    data-testid="value"
                    class="flex items-center whitespace-nowrap pr-2"
                    style={{ "padding-left": `${(props.depth + 1) * 12}px` }}
                  >
                    <Toggle
                      open={open()}
                      onClick={() =>
                        open()
                          ? props.inspector.close(path())
                          : props.inspector.open(path())
                      }
                    />
                    <span class="text-syntax-key">
                      {hook.value === undefined ? hook.name : `${hook.name}:`}
                    </span>
                    <Show when={hook.value !== undefined}>
                      {" "}
                      <span class={`truncate ${tone(hook.value as Value)}`}>
                        {previewText(hook.value as Value)}
                      </span>
                    </Show>
                  </div>
                  <Show when={open()}>
                    <HookRows
                      inspector={props.inspector}
                      hooks={hooks()}
                      path={path()}
                      depth={props.depth + 1}
                    />
                  </Show>
                </>
              )}
            </Match>
            <Match when={hook.value !== undefined}>
              <ValueRow
                inspector={props.inspector}
                entry={{ name: hook.name, value: hook.value as Value }}
                path={path()}
                depth={props.depth}
              />
            </Match>
            <Match when={hook.value === undefined}>
              <div
                data-testid="value"
                class="whitespace-nowrap pr-2 text-syntax-key"
                style={{ "padding-left": `${(props.depth + 1) * 12 + 12}px` }}
              >
                {hook.name}
              </div>
            </Match>
          </Switch>
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
  const toggle = () =>
    open()
      ? props.inspector.close(props.path)
      : props.inspector.open(props.path, ref())
  return (
    <>
      <div
        data-testid="value"
        class="flex items-center whitespace-nowrap pr-2"
        style={{ "padding-left": `${(props.depth + 1) * 12}px` }}
      >
        <Show when={openable()} fallback={<span class="w-3 shrink-0" />}>
          <Toggle open={open()} onClick={toggle} />
        </Show>
        <span class="text-syntax-key">
          {props.entry.arrow ? props.entry.name : `${props.entry.name}:`}
        </span>
        {props.entry.arrow ? " => " : " "}
        <span class={`truncate ${tone(value())}`}>{previewText(value())}</span>
      </div>
      <Show when={open() && target()}>
        {(container) => (
          <Children
            inspector={props.inspector}
            value={container()}
            path={props.path}
            depth={props.depth + 1}
          />
        )}
      </Show>
    </>
  )
}
