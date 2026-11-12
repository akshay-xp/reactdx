import type { Container, Preview, Value } from "@reactdx/messages"

// Inline contents for containers this small; bigger ones show their size.
const INLINE = 5
const STRING = 50

const quoted = (text: string, length = text.length) =>
  length > STRING || text.length > STRING
    ? `"${text.slice(0, STRING)}..." (${length} chars)`
    : `"${text}"`

const prefix = (className: string | null) =>
  className && className !== "Object" ? `${className} ` : ""

// A container without its contents: what a nested one shows inside a preview.
function shape(value: Preview): string {
  switch (value.type) {
    case "object":
      return `${prefix(value.className)}{...}`
    case "array":
      return `Array(${value.length})`
    case "typed-array":
      return `${value.className ?? "TypedArray"}(${value.length})`
    case "map":
      return `Map(${value.size})`
    case "set":
      return `Set(${value.size})`
  }
}

const isContainer = (value: Value): value is Container =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  value.type !== "ref"

// Containers inside a preview show only their shape.
const nested = (value: Value) =>
  isContainer(value) ? shape(value as Preview) : previewText(value)

function inline(value: Container): string {
  if (value.type === "object") {
    const entries = Object.entries(value.props).slice(0, INLINE)
    const more = value.size > entries.length ? ", ..." : ""
    const body = entries.map(([key, item]) => `${key}: ${nested(item)}`)
    return `${prefix(value.className)}{${body.join(", ")}${more}}`
  }
  if (value.type === "array" && value.length <= INLINE)
    return `[${value.items.map(nested).join(", ")}]`
  return shape(value as Preview)
}

// One line for any value (docs/panel.md, Inspector).
export function previewText(value: Value): string {
  if (value === null || typeof value !== "object")
    return typeof value === "string" ? quoted(value) : String(value)
  switch (value.type) {
    case "undefined":
      return "undefined"
    case "number":
      return value.value
    case "bigint":
      return `${value.value}n`
    case "string":
      return quoted(value.preview, value.length)
    case "function":
      return `ƒ ${value.name}()`
    case "symbol":
      return `Symbol(${value.description ?? ""})`
    case "getter":
      return "(getter)"
    case "hole":
      return "empty"
    case "promise":
      return "Promise"
    case "weak-map":
      return "WeakMap"
    case "weak-set":
      return "WeakSet"
    case "unreadable":
      return `(unreadable: ${value.message})`
    case "react-element":
      return value.key === null
        ? `<${value.name} />`
        : `<${value.name} key="${value.key}" />`
    case "date":
      return value.iso
    case "regexp":
      return `/${value.source}/${value.flags}`
    case "error":
      return `${value.name}: ${value.message}`
    case "element":
      return `<${value.tag}${value.id ? `#${value.id}` : ""}${value.className
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => `.${name}`)
        .join("")}>`
    case "node":
      return value.nodeName
    case "array-buffer":
      return `ArrayBuffer(${value.byteLength})`
    case "data-view":
      return `DataView(${value.byteLength})`
    case "ref":
      return "circular" in value ? "[circular]" : shape(value.preview)
    default:
      return inline(value)
  }
}
