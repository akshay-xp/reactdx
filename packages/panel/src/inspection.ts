import type {
  Container,
  ExpandedMessage,
  InspectedData,
  InspectedMessage,
  Value,
} from "@reactdx/messages"
import { createSignal } from "solid-js"

// What the store asks the page for; the panel adds the tab (InspectMessage).
export type InspectorCommand =
  | { type: "inspect"; id: number | null }
  | { type: "expand"; objectId: number; offset: number }

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
export function createInspectorStore(
  send: (command: InspectorCommand) => void,
) {
  const [id, setId] = createSignal<number>()
  const [data, setData] = createSignal<InspectedData | null>()
  // Open paths (dot-joined keys from the section) to the ref each one loads, if any.
  const [open, setOpen] = createSignal(new Map<string, number | undefined>())
  const [expansions, setExpansions] = createSignal(new Map<number, Value>())

  const expand = (objectId: number, offset = 0) =>
    send({ type: "expand", objectId, offset })
  const ask = () => send({ type: "inspect", id: id() ?? null })

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
    isOpen: (path: string) => open().has(path),
    // `ref`: the object to load, for a value the page sent as a ref.
    open(path: string, ref?: number) {
      if (open().has(path)) return
      setOpen(new Map(open()).set(path, ref))
      if (ref !== undefined && !expansions().has(ref)) expand(ref)
    },
    close(path: string) {
      const map = new Map(open())
      map.delete(path)
      setOpen(map)
    },
    expansion: (objectId: number) => expansions().get(objectId),
    more: expand,
  }
}
