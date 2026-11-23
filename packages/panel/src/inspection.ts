import type {
  Container,
  EditRoot,
  EditValue,
  ExpandedMessage,
  InspectedData,
  InspectedMessage,
  Value,
  ValueKey,
  ValueStoredMessage,
  ValueTarget,
  ValueTextMessage,
} from "@reactdx/messages"
import { createSignal } from "solid-js"
import { pathKey, type RowPath } from "./paths"

// What the store asks the page for; the panel adds the tab (InspectMessage).
export type InspectorCommand =
  | { type: "inspect"; id: number | null }
  | { type: "expand"; objectId: number; offset: number }
  | { type: "copy-value" | "store-value"; target: ValueTarget }
  | {
      type: "edit"
      id: number
      root: EditRoot
      path: ValueKey[]
      value: EditValue
    }
  | { type: "delete-path"; id: number; root: EditRoot; path: ValueKey[] }
  | { type: "rerender"; id: number }
  | { type: "force"; id: number; kind: "fallback" | "error"; on: boolean }
  | {
      type: "rename-path"
      id: number
      root: EditRoot
      path: ValueKey[]
      to: string
    }

export type InspectorStore = ReturnType<typeof createInspectorStore>

// A later page of a container appended to what's loaded.
function merge(loaded: Value | undefined, page: Value): Value {
  const a = loaded as Container | undefined
  const b = page as Container
  if (!a || a.type !== b.type) return page
  const { nextOffset: _, ...rest } = a
  const next = b.nextOffset === undefined ? {} : { nextOffset: b.nextOffset }
  if (a.type === "object" && b.type === "object")
    return { ...rest, ...next, props: { ...a.props, ...b.props } } as Value
  if (a.type === "map" && b.type === "map")
    return { ...rest, ...next, entries: [...a.entries, ...b.entries] } as Value
  if (a.type === "set" && b.type === "set")
    return { ...rest, ...next, values: [...a.values, ...b.values] } as Value
  if ("items" in a && "items" in b)
    return { ...rest, ...next, items: [...a.items, ...b.items] } as Value
  return page
}

// The inspected node as the page last described it, which paths the user opened,
// and the objects loaded for them (docs/panel.md, Inspector).
// `copy` puts text on the clipboard: a row's key, or a value's text from the page.
export function createInspectorStore(
  send: (command: InspectorCommand) => void,
  copy: (text: string) => void,
) {
  const [id, setId] = createSignal<number>()
  const [data, setData] = createSignal<InspectedData | null>()
  // Open paths (by pathKey) to the ref each one loads, if any.
  const [open, setOpen] = createSignal(new Map<string, number | undefined>())
  const [expansions, setExpansions] = createSignal(new Map<number, Value>())
  let copyAsked = false
  let storeAsked = false
  // The page global the last Store as global variable went to, while shown.
  const [stored, setStored] = createSignal<string>()

  const expand = (objectId: number, offset = 0) =>
    send({ type: "expand", objectId, offset })
  const ask = () => send({ type: "inspect", id: id() ?? null })
  // A write to the inspected node at a row's path; its re-send shows the result.
  const write = (
    path: RowPath,
    command:
      | { type: "edit"; value: EditValue }
      | { type: "delete-path" }
      | { type: "rename-path"; to: string },
  ) => {
    const at = id()
    if (at === undefined) return
    // Only editable rows write, and a render reason's never are.
    send({ ...command, id: at, root: path.root as EditRoot, path: path.keys })
  }

  return {
    id,
    data: () => data() ?? undefined,
    gone: () => data() === null,
    inspect(next: number | undefined) {
      setId(next)
      setData(undefined)
      setOpen(new Map())
      setExpansions(new Map())
      ask()
    },
    // The agent lost the selection (a new watch): ask for it again.
    resend: ask,
    // A re-send can change any object: drop what was loaded and load it again.
    receive(message: InspectedMessage) {
      if (message.id !== id()) return
      setData(message.data)
      setExpansions(new Map())
      for (const ref of open().values()) if (ref !== undefined) expand(ref)
    },
    receiveExpanded(message: ExpandedMessage) {
      const map = new Map(expansions())
      map.set(
        message.objectId,
        message.offset === 0
          ? message.value
          : merge(map.get(message.objectId), message.value),
      )
      setExpansions(map)
    },
    isOpen: (path: RowPath) => open().has(pathKey(path)),
    // `ref`: the object to load, for a value the page sent as a ref.
    open(path: RowPath, ref?: number) {
      const key = pathKey(path)
      if (open().has(key)) return
      setOpen(new Map(open()).set(key, ref))
      if (ref !== undefined && !expansions().has(ref)) expand(ref)
    },
    close(path: RowPath) {
      const map = new Map(open())
      map.delete(pathKey(path))
      setOpen(map)
    },
    expansion: (objectId: number) => expansions().get(objectId),
    // Writes a value at `path`.
    edit: (path: RowPath, value: EditValue) =>
      write(path, { type: "edit", value }),
    // Renders the inspected node again, nothing changed.
    rerender() {
      const at = id()
      if (at !== undefined) send({ type: "rerender", id: at })
    },
    // Shows the nearest boundary's fallback or error UI (on), or its children.
    force(kind: "fallback" | "error", on: boolean) {
      const at = id()
      if (at !== undefined) send({ type: "force", id: at, kind, on })
    },
    // Deletes the key or item at `path`.
    remove: (path: RowPath) => write(path, { type: "delete-path" }),
    // Renames the key at `path` (its last) to `to`.
    rename: (path: RowPath, to: string) =>
      write(path, { type: "rename-path", to }),
    copyKey: copy,
    // Values are copied whole from the page: the panel's are cut and paged.
    copyValue(target: ValueTarget) {
      copyAsked = true
      send({ type: "copy-value", target })
    },
    storeValue(target: ValueTarget) {
      storeAsked = true
      send({ type: "store-value", target })
    },
    stored,
    clearStored: () => setStored(undefined),
    // Like value text: only as the reply to a store.
    receiveValueStored(message: ValueStoredMessage) {
      if (!storeAsked) return
      storeAsked = false
      setStored(message.name)
    },
    // Only as the reply to a Copy value: the page could post one at any time.
    receiveValueText(message: ValueTextMessage) {
      if (!copyAsked) return
      copyAsked = false
      copy(message.text)
    },
    // The next page of a loaded container, appended to it when it arrives.
    more(value: Container) {
      if (value.nextOffset === undefined) return
      if (!expansions().has(value.id))
        setExpansions(new Map(expansions()).set(value.id, value))
      expand(value.id, value.nextOffset)
    },
  }
}
