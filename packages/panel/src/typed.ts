import type { EditValue } from "@reactdx/messages"

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
