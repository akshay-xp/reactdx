// Describes page values for the panel (docs/page.md, Values): JSON-safe, lazy past
// MAX_DEPTH, paged past PAGE, and without running app code (getters aren't called).
const MAX_STRING = 1000
const MAX_NAME = 256
const MAX_DEPTH = 2
const PAGE = 100

function number(value: number) {
  if (Number.isNaN(value)) return { type: "number", value: "NaN" }
  if (value === Number.POSITIVE_INFINITY)
    return { type: "number", value: "Infinity" }
  if (value === Number.NEGATIVE_INFINITY)
    return { type: "number", value: "-Infinity" }
  if (Object.is(value, -0)) return { type: "number", value: "-0" }
  return value
}

const bounded = (value: string, max = MAX_STRING) => value.slice(0, max)
const name = (value: string) => bounded(value, MAX_NAME)
const keyName = (key: unknown) =>
  typeof key === "string" ? name(key) : (key ?? null)

const className = (value: object): string | null => {
  const found = Object.getPrototypeOf(value)?.constructor?.name
  return typeof found === "string" ? name(found) : null
}

// One page, taken by iterating, so a 10k Map isn't copied to send 100 entries.
function pageOf<T>(iterable: Iterable<T>, offset: number) {
  const items: T[] = []
  let index = 0
  for (const item of iterable) {
    if (index >= offset + PAGE) return { items, nextOffset: offset + PAGE }
    if (index >= offset) items.push(item)
    index++
  }
  return { items }
}

const REACT_ELEMENT = new Set([
  Symbol.for("react.element"),
  Symbol.for("react.transitional.element"),
])

type Named = { displayName?: string; name?: string }
const elementName = (type: unknown) =>
  name(
    typeof type === "string"
      ? type
      : ((type as Named)?.displayName ?? (type as Named)?.name ?? "Anonymous"),
  )

// Values better summarized than walked: nothing to expand, so no id.
function leaf(value: object) {
  if (typeof Node !== "undefined" && value instanceof Node)
    return value instanceof Element
      ? {
          type: "element",
          tag: name(value.tagName.toLowerCase()),
          id: bounded(value.id),
          // An SVG element's className is an SVGAnimatedString.
          className: bounded(value.getAttribute("class") ?? ""),
        }
      : { type: "node", nodeName: name(value.nodeName) }
  const element = value as { $$typeof?: unknown; type?: unknown; key?: unknown }
  if (REACT_ELEMENT.has(element.$$typeof as symbol))
    return {
      type: "react-element",
      name: elementName(element.type),
      key: keyName(element.key),
    }
  if (value instanceof Date) return { type: "date", iso: value.toISOString() }
  if (value instanceof RegExp)
    return { type: "regexp", source: bounded(value.source), flags: value.flags }
  if (value instanceof Error)
    return {
      type: "error",
      name: name(String(value.name)),
      message: bounded(String(value.message)),
    }
  if (value instanceof Promise) return { type: "promise" }
  if (value instanceof ArrayBuffer)
    return { type: "array-buffer", byteLength: value.byteLength }
  if (value instanceof DataView)
    return { type: "data-view", byteLength: value.byteLength }
  if (value instanceof WeakMap) return { type: "weak-map" }
  if (value instanceof WeakSet) return { type: "weak-set" }
}

type TypedArray = ArrayLike<number | bigint>
// A DataView is a view too, but is summarized in leaf().
const isTypedArray = (value: object): value is TypedArray =>
  ArrayBuffer.isView(value)

// Own keys, symbols included, read without running getters.
const keysOf = (value: object) =>
  Reflect.ownKeys(Object.getOwnPropertyDescriptors(value))

const isIndex = (key: string | symbol) =>
  typeof key === "string" && String(Number(key) >>> 0) === key

function* indexes(length: number) {
  for (let i = 0; i < length; i++) yield i
}

// Through descriptors, so getters (app code) never run.
function propsOf(
  value: object,
  keys: (string | symbol)[],
  child: (item: unknown) => unknown,
) {
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const props: Record<string, unknown> = {}
  for (const key of keys) {
    const descriptor = descriptors[key as string] as PropertyDescriptor
    props[String(key)] =
      "value" in descriptor ? child(descriptor.value) : { type: "getter" }
  }
  return props
}

function preview(value: object) {
  if (Array.isArray(value)) return { type: "array", length: value.length }
  if (isTypedArray(value))
    return {
      type: "typed-array",
      className: className(value),
      length: value.length,
    }
  if (value instanceof Map) return { type: "map", size: value.size }
  if (value instanceof Set) return { type: "set", size: value.size }
  return {
    type: "object",
    className: className(value),
    size: keysOf(value).length,
  }
}

const messageOf = (error: unknown) =>
  String(error instanceof Error ? error.message : error)

export function createInspector() {
  let ids = new WeakMap<object, number>()
  const objects = new Map<number, object>()
  // Objects on the current path: meeting one again is a cycle.
  const path = new Set<object>()

  const idOf = (value: object) => {
    let id = ids.get(value)
    if (id === undefined) {
      id = objects.size + 1
      ids.set(value, id)
      objects.set(id, value)
    }
    return id
  }

  function contents(value: object, depth: number, offset: number) {
    const child = (item: unknown) => serialize(item, depth + 1)
    const paged = <T, R>(iterable: Iterable<T>, map: (item: T) => R) => {
      const { items, nextOffset } = pageOf(iterable, offset)
      return { items: items.map(map), ...(nextOffset && { nextOffset }) }
    }
    if (Array.isArray(value)) {
      const extras = keysOf(value).filter(
        (key) => key !== "length" && !isIndex(key),
      )
      return {
        ...paged(indexes(value.length), (i) =>
          i in value ? child(value[i]) : { type: "hole" },
        ),
        ...(extras.length && { props: propsOf(value, extras, child) }),
      }
    }
    // Read by index: walking a million-element array's own properties is slow.
    if (isTypedArray(value))
      return paged(indexes(value.length), (i) => child(value[i]))
    if (value instanceof Map) {
      const { items, ...rest } = paged(value.entries(), ([key, item]) => [
        child(key),
        child(item),
      ])
      return { entries: items, ...rest }
    }
    if (value instanceof Set) {
      const { items, ...rest } = paged(value.values(), child)
      return { values: items, ...rest }
    }
    const { items, nextOffset } = pageOf(keysOf(value), offset)
    return {
      props: propsOf(value, items, child),
      ...(nextOffset && { nextOffset }),
    }
  }

  function object(value: object, depth: number, offset: number) {
    const summary = leaf(value)
    if (summary) return summary
    if (path.has(value)) return { type: "ref", id: idOf(value), circular: true }
    if (depth >= MAX_DEPTH)
      return { type: "ref", id: idOf(value), preview: preview(value) }
    path.add(value)
    try {
      return {
        ...preview(value),
        id: idOf(value),
        ...contents(value, depth, offset),
      }
    } finally {
      path.delete(value)
    }
  }

  function serialize(value: unknown, depth = 0, offset = 0): unknown {
    switch (typeof value) {
      case "undefined":
        return { type: "undefined" }
      case "number":
        return number(value)
      case "bigint":
        return { type: "bigint", value: String(value) }
      case "string":
        return value.length > MAX_STRING
          ? {
              type: "string",
              preview: value.slice(0, MAX_STRING),
              length: value.length,
            }
          : value
      case "function":
        return { type: "function", name: name(value.name) }
      case "symbol":
        return { type: "symbol", description: keyName(value.description) }
      case "object":
        if (value === null) return null
        // A Proxy can't be detected, so its traps run, and may throw.
        try {
          return object(value, depth, offset)
        } catch (error) {
          return { type: "unreadable", message: bounded(messageOf(error)) }
        }
      default:
        return value
    }
  }

  return {
    serialize: (value: unknown) => serialize(value),
    // Undefined for an id this inspector doesn't hold (released, or forged).
    expand: (id: number, offset = 0) =>
      objects.has(id) ? serialize(objects.get(id), 0, offset) : undefined,
    // Drops every described object, so the page keeps none of them alive.
    release() {
      objects.clear()
      ids = new WeakMap()
    },
  }
}
