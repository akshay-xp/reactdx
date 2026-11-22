import type { Container, EditValue, Value } from "@reactdx/messages"

// Typed edit text (docs/panel.md, Editing): JSON, plus what JSON can't hold.
const MARKERS: Record<string, EditValue> = {
  undefined: { type: "undefined" },
  NaN: { type: "number", value: "NaN" },
  Infinity: { type: "number", value: "Infinity" },
  "-Infinity": { type: "number", value: "-Infinity" },
  "-0": { type: "number", value: "-0" },
}

// JSON as an EditValue: objects tagged, so the page can tell them from markers.
function fromJson(value: unknown): EditValue {
  // JSON overflows to Infinity (1e999): no value, not one the page would drop.
  if (typeof value === "number" && !Number.isFinite(value))
    throw new RangeError("not a finite number")
  if (Array.isArray(value)) return value.map(fromJson)
  if (value === null || typeof value !== "object") return value as EditValue
  return {
    type: "object",
    props: Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, fromJson(item)]),
    ),
  }
}

// The value `text` stands for, or undefined when it reads as none.
export function parseTyped(text: string): EditValue | undefined {
  const trimmed = text.trim()
  if (Object.hasOwn(MARKERS, trimmed)) return MARKERS[trimmed]
  try {
    return fromJson(JSON.parse(trimmed))
  } catch {
    return undefined
  }
}

// A plain object or array: the page writes through these only (a Map, Set,
// typed array or class instance is replaced whole, never edited inside).
export const isPlain = (value: Container) =>
  value.type === "array" ||
  (value.type === "object" &&
    (value.className === "Object" || value.className === null))

const NONE = Symbol("none")

// The JSON a value is, if the panel holds all of it: primitives, and plain
// containers fully loaded with JSON inside (no refs, pages, extras or markers).
function jsonOf(value: Value): unknown {
  if (value === null || typeof value !== "object") return value
  if (value.type !== "object" && value.type !== "array") return NONE
  if (!isPlain(value)) return NONE
  if (value.nextOffset !== undefined) return NONE
  if (value.type === "array") {
    if (value.props || value.items.length !== value.length) return NONE
    const items = value.items.map(jsonOf)
    return items.includes(NONE) ? NONE : items
  }
  if (value.type !== "object") return NONE
  const entries = Object.entries(value.props).map(([k, v]) => [k, jsonOf(v)])
  return entries.length !== value.size || entries.some(([, v]) => v === NONE)
    ? NONE
    : Object.fromEntries(entries)
}

// The text the editor opens with, which parseTyped reads back as the value;
// empty when the panel can't write it whole (it's replaced, not edited).
export function editText(value: Value): string {
  const json = jsonOf(value)
  if (json !== NONE) return JSON.stringify(json)
  if (value !== null && typeof value === "object") {
    if (value.type === "undefined") return "undefined"
    if (value.type === "number") return value.value
  }
  return ""
}
