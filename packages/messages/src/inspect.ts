// Values the agent describes for the inspector (packages/page/src/inspect.ts), and
// the replies that carry them. Every one is checked before the panel sees it.

export const MAX_VALUE_STRING = 1000
export const MAX_NAME = 256
export const PAGE = 100
// Containers inside containers: the serializer sends at most 3 (MAX_DEPTH 2).
const MAX_NESTING = 4
const MAX_VALUES = 50_000

export type Preview =
  | { type: "object"; className: string | null; size: number }
  | { type: "array"; length: number }
  | { type: "typed-array"; className: string | null; length: number }
  | { type: "map" | "set"; size: number }

type Page = { id: number; nextOffset?: number }

export type Container =
  | ({
      type: "object"
      className: string | null
      size: number
      props: Record<string, Value>
    } & Page)
  | ({
      type: "array"
      length: number
      items: Value[]
      props?: Record<string, Value>
    } & Page)
  | ({
      type: "typed-array"
      className: string | null
      length: number
      items: Value[]
    } & Page)
  | ({ type: "map"; size: number; entries: [Value, Value][] } & Page)
  | ({ type: "set"; size: number; values: Value[] } & Page)

export type Value =
  | string
  | number
  | boolean
  | null
  | {
      type:
        | "undefined"
        | "getter"
        | "hole"
        | "promise"
        | "weak-map"
        | "weak-set"
    }
  | { type: "number"; value: "NaN" | "Infinity" | "-Infinity" | "-0" }
  | { type: "bigint"; value: string }
  | { type: "string"; preview: string; length: number }
  | { type: "function"; name: string }
  | { type: "symbol"; description: string | null }
  | { type: "unreadable"; message: string }
  | { type: "react-element"; name: string; key: string | null }
  | { type: "date"; iso: string }
  | { type: "regexp"; source: string; flags: string }
  | { type: "error"; name: string; message: string }
  | { type: "element"; tag: string; id: string; className: string }
  | { type: "node"; nodeName: string }
  | { type: "array-buffer" | "data-view"; byteLength: number }
  | { type: "ref"; id: number; circular: true }
  | { type: "ref"; id: number; preview: Preview }
  | Container

// The selected node's values. Null: the agent has no such node (it unmounted).
// A hook, or a custom hook (named after its function) holding the hooks it called.
export type HookValue = { name: string; value?: Value; hooks?: HookValue[] }

// A context the node read, by its displayName ("Context" without one).
export type ContextValue = { name: string; value: Value }
// A component that rendered the node, nearest first. `id` null: not in the tree
// (a Server Component).
export type Owner = { id: number | null; name: string }

// `hooksError`: why the hooks couldn't be read (the shadow render threw).
export type InspectedData = {
  props: Value
  state?: Value
  hooks?: HookValue[]
  hooksError?: string
  contexts?: ContextValue[]
  owners?: Owner[]
}

const MAX_CONTEXTS = 50
const MAX_OWNERS = 50

const MAX_HOOKS = 200
const MAX_HOOK_NESTING = 8

// Agent to panel (relay, tree port, background).
export type InspectedMessage = {
  source: "reactdx"
  type: "inspected"
  id: number
  data: InspectedData | null
}
export const inspected = (
  id: number,
  data: InspectedData | null,
): InspectedMessage => ({ source: "reactdx", type: "inspected", id, data })

// Agent to panel: one page of an object the panel asked to expand.
export type ExpandedMessage = {
  source: "reactdx"
  type: "expanded"
  objectId: number
  offset: number
  value: Value
}
export const expanded = (
  objectId: number,
  offset: number,
  value: Value,
): ExpandedMessage => ({
  source: "reactdx",
  type: "expanded",
  objectId,
  offset,
  value,
})

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0
const isId = (value: unknown): value is number => isCount(value) && value >= 1
const isText = (value: unknown, max = MAX_VALUE_STRING): value is string =>
  typeof value === "string" && value.length <= max
const isName = (value: unknown): value is string => isText(value, MAX_NAME)
const isNameOrNull = (value: unknown) => value === null || isName(value)

const BARE = new Set<unknown>([
  "undefined",
  "getter",
  "hole",
  "promise",
  "weak-map",
  "weak-set",
])
const NUMBERS = new Set<unknown>(["NaN", "Infinity", "-Infinity", "-0"])

// Leaf descriptors: each field and its check.
const LEAVES: Record<string, Record<string, (v: unknown) => boolean>> = {
  number: { value: (v) => NUMBERS.has(v) },
  bigint: { value: (v) => isText(v) },
  string: { preview: (v) => isText(v), length: isCount },
  function: { name: isName },
  symbol: { description: isNameOrNull },
  unreadable: { message: (v) => isText(v) },
  "react-element": { name: isName, key: isNameOrNull },
  date: { iso: (v) => isText(v, 64) },
  regexp: { source: (v) => isText(v), flags: (v) => isText(v, 16) },
  error: { name: isName, message: (v) => isText(v) },
  element: { tag: isName, id: (v) => isText(v), className: (v) => isText(v) },
  node: { nodeName: isName },
  "array-buffer": { byteLength: isCount },
  "data-view": { byteLength: isCount },
}

function leaf(o: Record<string, unknown>): Value | undefined {
  const fields = LEAVES[o.type as string]
  if (!fields) return
  const out: Record<string, unknown> = { type: o.type }
  for (const [key, check] of Object.entries(fields)) {
    if (!check(o[key])) return
    out[key] = o[key]
  }
  return out as Value
}

function preview(data: unknown): Preview | undefined {
  if (typeof data !== "object" || data === null) return
  const { type, className, size, length } = data as Record<string, unknown>
  if (type === "object" && isNameOrNull(className) && isCount(size))
    return { type, className: className as string | null, size }
  if (type === "array" && isCount(length)) return { type, length }
  if (type === "typed-array" && isNameOrNull(className) && isCount(length))
    return { type, className: className as string | null, length }
  if ((type === "map" || type === "set") && isCount(size)) return { type, size }
}

type Budget = { left: number }

// Undefined unless the whole value is valid; a fresh copy with only known fields.
export function parseValue(
  data: unknown,
  depth = 0,
  budget: Budget = { left: MAX_VALUES },
): Value | undefined {
  if (--budget.left < 0) return
  if (data === null || typeof data === "boolean") return data
  if (typeof data === "number") return Number.isFinite(data) ? data : undefined
  if (typeof data === "string") return isText(data) ? data : undefined
  if (typeof data !== "object" || Array.isArray(data)) return
  const o = data as Record<string, unknown>
  if (BARE.has(o.type)) return { type: o.type } as Value
  if (o.type === "ref") {
    if (!isId(o.id)) return
    if (o.circular === true) return { type: "ref", id: o.id, circular: true }
    const shape = preview(o.preview)
    return shape && { type: "ref", id: o.id, preview: shape }
  }
  const found = leaf(o)
  if (found) return found
  return container(o, depth, budget)
}

function container(
  o: Record<string, unknown>,
  depth: number,
  budget: Budget,
): Value | undefined {
  if (depth >= MAX_NESTING) return
  const shape = preview(o)
  if (!shape || !isId(o.id)) return
  if (o.nextOffset !== undefined && !isId(o.nextOffset)) return
  const page = {
    ...shape,
    id: o.id,
    ...(o.nextOffset !== undefined && { nextOffset: o.nextOffset }),
  }
  const child = (item: unknown) => parseValue(item, depth + 1, budget)
  const list = <T>(
    items: unknown,
    each: (item: unknown) => T | undefined,
  ): T[] | undefined => {
    if (!Array.isArray(items) || items.length > PAGE) return
    const out: T[] = []
    for (const item of items) {
      const value = each(item)
      if (value === undefined) return
      out.push(value)
    }
    return out
  }
  const record = (props: unknown) => {
    if (typeof props !== "object" || props === null) return
    const entries = Object.entries(props)
    if (entries.length > PAGE) return
    const out: Record<string, Value> = {}
    for (const [key, item] of entries) {
      const value = child(item)
      if (!isText(key) || value === undefined) return
      out[key] = value
    }
    return out
  }
  switch (shape.type) {
    case "object": {
      const props = record(o.props)
      return props && ({ ...page, props } as Value)
    }
    case "array":
    case "typed-array": {
      const items = list(o.items, child)
      if (!items) return
      if (shape.type === "typed-array" || o.props === undefined)
        return { ...page, items } as Value
      const props = record(o.props)
      return props && ({ ...page, items, props } as Value)
    }
    case "map": {
      const entries = list<[Value, Value]>(o.entries, (entry) => {
        if (!Array.isArray(entry) || entry.length !== 2) return
        const key = child(entry[0])
        const value = child(entry[1])
        return key === undefined || value === undefined
          ? undefined
          : [key, value]
      })
      return entries && ({ ...page, entries } as Value)
    }
    case "set": {
      const values = list(o.values, child)
      return values && ({ ...page, values } as Value)
    }
  }
}

// Undefined unless every hook is valid: at most MAX_HOOKS in all, groups nested at
// most MAX_HOOK_NESTING deep, values checked against the message's budget.
function parseHooks(
  data: unknown,
  budget: Budget,
  count: { left: number },
  depth = 0,
): HookValue[] | undefined {
  if (!Array.isArray(data) || depth > MAX_HOOK_NESTING) return
  const out: HookValue[] = []
  for (const item of data) {
    if (--count.left < 0 || typeof item !== "object" || item === null) return
    const { name, value, hooks } = item as Record<string, unknown>
    if (!isName(name)) return
    const hook: HookValue = { name }
    if (value !== undefined) {
      const parsed = parseValue(value, 0, budget)
      if (parsed === undefined) return
      hook.value = parsed
    }
    if (hooks !== undefined) {
      const parsed = parseHooks(hooks, budget, count, depth + 1)
      if (!parsed) return
      hook.hooks = parsed
    }
    out.push(hook)
  }
  return out
}

export function parseInspected(data: unknown): InspectedMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const message = data as Record<string, unknown>
  if (message.source !== "reactdx" || message.type !== "inspected") return
  if (!isId(message.id)) return
  if (message.data === null) return inspected(message.id, null)
  if (typeof message.data !== "object") return
  const { props, state, hooks, hooksError, contexts, owners } =
    message.data as Record<string, unknown>
  const budget = { left: MAX_VALUES }
  const parsed: InspectedData = { props: null }
  const value = parseValue(props, 0, budget)
  if (value === undefined) return
  parsed.props = value
  if (state !== undefined) {
    const value = parseValue(state, 0, budget)
    if (value === undefined) return
    parsed.state = value
  }
  if (hooks !== undefined) {
    const list = parseHooks(hooks, budget, { left: MAX_HOOKS })
    if (!list) return
    parsed.hooks = list
  }
  if (hooksError !== undefined) {
    if (!isText(hooksError)) return
    parsed.hooksError = hooksError
  }
  if (contexts !== undefined) {
    const list = parseList(contexts, MAX_CONTEXTS, (item) => {
      const value = parseValue(item.value, 0, budget)
      return isName(item.name) && value !== undefined
        ? { name: item.name, value }
        : undefined
    })
    if (!list) return
    parsed.contexts = list
  }
  if (owners !== undefined) {
    const list = parseList(owners, MAX_OWNERS, ({ id, name }) =>
      isName(name) && (id === null || isId(id)) ? { id, name } : undefined,
    )
    if (!list) return
    parsed.owners = list
  }
  return inspected(message.id, parsed)
}

// Undefined unless `data` is an array of at most `max` objects `each` accepts.
function parseList<T>(
  data: unknown,
  max: number,
  each: (item: Record<string, unknown>) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(data) || data.length > max) return
  const out: T[] = []
  for (const item of data) {
    if (typeof item !== "object" || item === null) return
    const parsed = each(item as Record<string, unknown>)
    if (parsed === undefined) return
    out.push(parsed)
  }
  return out
}

export function parseExpanded(data: unknown): ExpandedMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, objectId, offset, value } = data as Record<
    string,
    unknown
  >
  if (source !== "reactdx" || type !== "expanded") return
  if (!isId(objectId) || !isCount(offset)) return
  const parsed = parseValue(value)
  return parsed === undefined ? undefined : expanded(objectId, offset, parsed)
}
