import type { Value } from "@reactdx/messages"
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js"
import type { InspectorStore } from "./inspection"
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

// A container's own entries as name/value pairs (an object's props).
const entriesOf = (value: Value | undefined): [string, Value][] =>
  value !== null && typeof value === "object" && value.type === "object"
    ? Object.entries(value.props)
    : []

// The selected node's values (docs/panel.md, Inspector). Page data is text only.
export function Inspector(props: {
  tree: TreeStore
  inspector: InspectorStore
}) {
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
    <Show when={entriesOf(value).length > 0}>
      <Section
        name={name}
        open={!collapsed().has(name)}
        onToggle={() => toggle(name)}
      >
        <For each={entriesOf(value)}>
          {([key, item]) => <ValueRow name={key} value={item} />}
        </For>
      </Section>
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
            </header>
            <div class="overflow-y-auto">
              {section("Props", props.inspector.data()?.props)}
              {section("State", props.inspector.data()?.state)}
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

function ValueRow(props: { name: string; value: Value }) {
  return (
    <div
      data-testid="value"
      class="flex items-center whitespace-nowrap pr-2 pl-6"
    >
      <span class="text-syntax-key">{`${props.name}:`}</span>{" "}
      <span class={`truncate ${tone(props.value)}`}>
        {previewText(props.value)}
      </span>
    </div>
  )
}
