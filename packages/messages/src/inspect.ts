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
// Where a call was made, in a served script (a hook's, for its variable name).
export type CallSite = { url: string; line: number; column: number }

export type HookValue = {
  name: string
  value?: Value
  hooks?: HookValue[]
  site?: CallSite
  // A context read: its index in `contexts` (read order), where it's edited.
  context?: number
}

// A context the node read, by its displayName ("Context" without one).
// `default`: no provider above, so it's the context's default value (read-only).
export type ContextValue = { name: string; value: Value; default?: true }
// A component that rendered the node, nearest first. `id` null: not in the tree
// (a Server Component).
export type Owner = { id: number | null; name: string }

// `hooksError`: why the hooks couldn't be read (the shadow render threw).
// Where a component is: an original file (React 18's _debugSource) or a call site
// in a served script (React 19's _debugStack), which the panel maps to a file.
export type SourceRef =
  | { file: string; line: number; column: number }
  | CallSite

export type InspectedData = {
  props: Value
  state?: Value
  hooks?: HookValue[]
  hooksError?: string
  contexts?: ContextValue[]
  owners?: Owner[]
  source?: SourceRef
  boundaries?: Boundaries
  render?: RenderReason
}

// Why the node last rendered, while the panel watched (M6; docs/messages.md,
// Render reasons): the changes with both values, hooks by call indexes (as in
// `hooks`) and contexts by read order (as in `contexts`).
export const RENDER_KINDS = [
  "mount",
  "props",
  "state",
  "context",
  "parent",
  "force",
] as const
export type RenderKind = (typeof RENDER_KINDS)[number]
// `reference` (props only, M6 #62): the new value is only a new reference, an
// equal object or array, or a different function.
export const REFERENCE_KINDS = ["same-value", "new-function"] as const
const isReference = (
  value: unknown,
): value is (typeof REFERENCE_KINDS)[number] =>
  REFERENCE_KINDS.includes(value as never)
export type KeyChange = {
  key: string
  old: Value
  new: Value
  reference?: (typeof REFERENCE_KINDS)[number]
}
export type HookChange = { hook: number[]; old: Value; new: Value }
export type ContextChange = { context: number; old: Value; new: Value }
// An effect the render ran (M6 #63): `changed` the deps that differ, absent
// for an effect with no deps array.
export type EffectRun = {
  hook: number[]
  changed?: { dep: number; old: Value; new: Value }[]
}
export type RenderReason = {
  seq: number
  kinds: RenderKind[]
  props?: KeyChange[]
  state?: KeyChange[]
  hooks?: HookChange[]
  contexts?: ContextChange[]
  effects?: EffectRun[]
  remount?: Remount
  // What triggered the render's commit (M6 #65): the components whose update
  // scheduled it, with their changed state hooks labeled as in Hooks.
  updaters?: Updater[]
}
export type UpdaterHook = { name: string; old: Value; new: Value }
export type Updater = { id: number; hooks: UpdaterHook[] }
// A mount in place of a same-type fiber deleted in that commit (M6 #64): its
// key changed, or an ancestor (a tree id) remounted or changed type.
export type Remount =
  | { cause: "key"; from: string | null; to: string | null }
  | { cause: "ancestor"; ancestor: number }
export const MAX_CHANGES = 1000

// The nearest Suspense boundary (`fallback`) and error boundary at or above the
// node, by tree id, and whether the panel forced each (M5 #56).
export type Boundary = { id: number; on: boolean }
export type Boundaries = { fallback?: Boundary; error?: Boundary }

const MAX_CONTEXTS = 50
export const MAX_OWNERS = 50

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

// Panel to agent: which value a row shows. `objectId`: a container the agent
// described (the row's own, or its parent's with `key`: a property name, or an
// index into an array, typed array, map's entries or set). `hook`: a hook by
// call index, through custom hooks. `context`: a context read by index.
export type ValueKey = string | number
export type ValueTarget =
  | { objectId: number; key?: ValueKey }
  | { hook: number[] }
  | { context: number }

export function parseValueTarget(data: unknown): ValueTarget | undefined {
  if (typeof data !== "object" || data === null) return
  const { objectId, key, hook, context } = data as Record<string, unknown>
  if (isId(objectId)) {
    if (key === undefined) return { objectId }
    if (isCount(key) || isText(key)) return { objectId, key }
    return
  }
  if (isHookPath(hook)) return { hook: [...hook] }
  if (isCount(context)) return { context }
}

// Panel to agent: where an edit writes (docs/messages.md, Edits): the selected
// node's props or class state, a hook by call indexes, or a context by read order.
export type EditRoot =
  | "props"
  | "state"
  | { hook: number[] }
  | { context: number }

// A value to write. Objects are tagged, so a user's `{ type: "undefined" }` is an
// object, not the marker; what JSON can't hold has a marker.
export type EditValue =
  | string
  | number
  | boolean
  | null
  | { type: "undefined" }
  | { type: "number"; value: "NaN" | "Infinity" | "-Infinity" | "-0" }
  | EditValue[]
  | { type: "object"; props: Record<string, EditValue> }

const MAX_EDIT_PATH = 32
const MAX_EDIT_STRING = 100_000
const MAX_EDIT_NESTING = 16
const MAX_EDIT_VALUES = 10_000

export function parseEditRoot(data: unknown): EditRoot | undefined {
  if (data === "props" || data === "state") return data
  const target = parseValueTarget(data)
  if (target && "hook" in target) return { hook: target.hook }
  if (target && "context" in target) return { context: target.context }
}

export function parseEditPath(data: unknown): ValueKey[] | undefined {
  if (!Array.isArray(data) || data.length > MAX_EDIT_PATH) return
  if (!data.every((key) => isCount(key) || isText(key))) return
  return [...data]
}

// A fresh copy within the bounds, or undefined.
export function parseEditValue(data: unknown): EditValue | undefined {
  let count = 0
  const walk = (value: unknown, depth: number): EditValue | undefined => {
    if (++count > MAX_EDIT_VALUES || depth > MAX_EDIT_NESTING) return
    if (value === null || typeof value === "boolean") return value
    if (typeof value === "number")
      return Number.isFinite(value) ? value : undefined
    if (typeof value === "string")
      return value.length <= MAX_EDIT_STRING ? value : undefined
    if (Array.isArray(value)) {
      const items: EditValue[] = []
      for (const item of value) {
        const parsed = walk(item, depth + 1)
        if (parsed === undefined) return
        items.push(parsed)
      }
      return items
    }
    if (typeof value !== "object") return
    const { type, value: marker, props } = value as Record<string, unknown>
    if (type === "undefined") return { type }
    if (type === "number" && NUMBERS.has(marker))
      return { type, value: marker as "NaN" }
    if (type !== "object" || typeof props !== "object" || props === null) return
    const out: Record<string, EditValue> = {}
    for (const [key, item] of Object.entries(props)) {
      const parsed = walk(item, depth + 1)
      if (parsed === undefined || !isText(key)) return
      out[key] = parsed
    }
    return { type, props: out }
  }
  return walk(data, 0)
}

// Agent to panel: a value as text for the clipboard (docs/page.md, Copy).
export const MAX_COPY = 10_000_000
export type ValueTextMessage = {
  source: "reactdx"
  type: "value-text"
  text: string
}
export const valueText = (text: string): ValueTextMessage => ({
  source: "reactdx",
  type: "value-text",
  text,
})
// Agent to panel: the page global a store-value put the value in.
export type ValueStoredMessage = {
  source: "reactdx"
  type: "value-stored"
  name: string
}
export const valueStored = (name: string): ValueStoredMessage => ({
  source: "reactdx",
  type: "value-stored",
  name,
})
export function parseValueStored(
  data: unknown,
): ValueStoredMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, name } = data as Record<string, unknown>
  if (
    source === "reactdx" &&
    type === "value-stored" &&
    typeof name === "string" &&
    /^\$reactdx[1-9]\d{0,8}$/.test(name)
  )
    return valueStored(name)
}

export function parseValueText(data: unknown): ValueTextMessage | undefined {
  if (typeof data !== "object" || data === null) return
  const { source, type, text } = data as Record<string, unknown>
  if (source === "reactdx" && type === "value-text" && isText(text, MAX_COPY))
    return valueText(text)
}

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0
const isId = (value: unknown): value is number => isCount(value) && value >= 1
// A hook's call indexes, from the top through custom hooks.
const isHookPath = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= MAX_HOOK_NESTING &&
  value.every(isCount)
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
    const { name, value, hooks, site, context } = item as Record<
      string,
      unknown
    >
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
    if (site !== undefined) {
      const parsed = parseCallSite(site)
      if (!parsed) return
      hook.site = parsed
    }
    if (context !== undefined) {
      if (!isCount(context)) return
      hook.context = context
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
  const {
    props,
    state,
    hooks,
    hooksError,
    contexts,
    owners,
    source,
    boundaries,
    render,
  } = message.data as Record<string, unknown>
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
      if (!isName(item.name) || value === undefined) return
      if (item.default === undefined) return { name: item.name, value }
      if (item.default === true)
        return { name: item.name, value, default: true as const }
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
  if (source !== undefined) {
    const ref = parseSource(source)
    if (!ref) return
    parsed.source = ref
  }
  if (boundaries !== undefined) {
    const found = parseBoundaries(boundaries)
    if (!found) return
    parsed.boundaries = found
  }
  if (render !== undefined) {
    const reason = parseRender(render, budget)
    if (!reason) return
    parsed.render = reason
  }
  return inspected(message.id, parsed)
}

function parseRemount(data: unknown): Remount | undefined {
  if (typeof data !== "object" || data === null) return
  const { cause, from, to, ancestor } = data as Record<string, unknown>
  if (cause === "ancestor" && isId(ancestor)) return { cause, ancestor }
  if (cause === "key" && isNameOrNull(from) && isNameOrNull(to))
    return { cause, from, to }
}

function parseRender(
  data: unknown,
  budget: { left: number },
): RenderReason | undefined {
  if (typeof data !== "object" || data === null) return
  const {
    seq,
    kinds,
    props,
    state,
    hooks,
    contexts,
    effects,
    remount,
    updaters,
  } = data as Record<string, unknown>
  if (!isId(seq) || !Array.isArray(kinds) || kinds.length === 0) return
  if (
    new Set(kinds).size !== kinds.length ||
    !kinds.every((kind) => RENDER_KINDS.includes(kind))
  )
    return
  const reason: RenderReason = { seq, kinds: [...kinds] }
  // The old and new values of one change, or undefined if either is invalid.
  const sides = (item: Record<string, unknown>) => {
    const old = parseValue(item.old, 0, budget)
    const next = parseValue(item.new, 0, budget)
    return old === undefined || next === undefined
      ? undefined
      : { old, new: next }
  }
  const keyed = (list: unknown) =>
    parseList(list, MAX_CHANGES, (item) => {
      const both = sides(item)
      const { reference } = item
      if (!both || !isName(item.key)) return
      if (reference === undefined) return { key: item.key, ...both }
      if (isReference(reference)) return { key: item.key, ...both, reference }
    })
  if (props !== undefined) {
    const list = keyed(props)
    if (!list) return
    reason.props = list
  }
  if (state !== undefined) {
    const list = keyed(state)
    if (!list) return
    reason.state = list
  }
  if (hooks !== undefined) {
    const list = parseList(hooks, MAX_CHANGES, (item) => {
      const both = sides(item)
      return both && isHookPath(item.hook)
        ? { hook: [...item.hook], ...both }
        : undefined
    })
    if (!list) return
    reason.hooks = list
  }
  if (contexts !== undefined) {
    const list = parseList(contexts, MAX_CHANGES, (item) => {
      const both = sides(item)
      return both && isCount(item.context)
        ? { context: item.context, ...both }
        : undefined
    })
    if (!list) return
    reason.contexts = list
  }
  if (effects !== undefined) {
    const list = parseList(effects, MAX_CHANGES, (item) => {
      if (!isHookPath(item.hook)) return
      const run: EffectRun = { hook: [...item.hook] }
      if (item.changed === undefined) return run
      const changed = parseList(item.changed, MAX_CHANGES, (dep) => {
        const both = sides(dep)
        return both && isCount(dep.dep) ? { dep: dep.dep, ...both } : undefined
      })
      return changed && { ...run, changed }
    })
    if (!list) return
    reason.effects = list
  }
  if (remount !== undefined) {
    const parsed = parseRemount(remount)
    if (!parsed) return
    reason.remount = parsed
  }
  if (updaters !== undefined) {
    const list = parseList(updaters, MAX_CHANGES, (item) => {
      const changes = parseList(item.hooks, MAX_CHANGES, (hook) => {
        const both = sides(hook)
        return both && isName(hook.name)
          ? { name: hook.name, ...both }
          : undefined
      })
      return changes && isId(item.id)
        ? { id: item.id, hooks: changes }
        : undefined
    })
    if (!list) return
    reason.updaters = list
  }
  return reason
}

function parseBoundaries(data: unknown): Boundaries | undefined {
  if (typeof data !== "object" || data === null) return
  const out: Boundaries = {}
  for (const kind of ["fallback", "error"] as const) {
    const item = (data as Record<string, unknown>)[kind]
    if (item === undefined) continue
    const { id, on } = (item ?? {}) as Record<string, unknown>
    if (!isId(id) || typeof on !== "boolean") return
    out[kind] = { id, on }
  }
  return out
}

function parseSource(data: unknown): SourceRef | undefined {
  if (typeof data !== "object" || data === null) return
  const { file, line, column } = data as Record<string, unknown>
  if (file === undefined) return parseCallSite(data)
  if (isId(line) && isId(column) && isText(file) && file && !("url" in data))
    return { file, line, column }
}

function parseCallSite(data: unknown): CallSite | undefined {
  if (typeof data !== "object" || data === null) return
  const { url, line, column } = data as Record<string, unknown>
  if (isId(line) && isId(column) && isText(url) && url)
    return { url, line, column }
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
