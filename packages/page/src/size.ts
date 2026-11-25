import {
  MAX_FIELDS,
  MAX_NAME,
  MAX_PROP_SIZES,
  type PropSize,
  type Size,
} from "@reactdx/messages"

// How much JSON a value would be (docs/page.md, Sizes), without running app
// code: getters and toJSON (but Date's) aren't called. Counting stops, `over`,
// past MAX_SIZE bytes, MAX_SIZE_DEPTH levels, MAX_SIZE_VALUES values or a
// cycle, so a huge or cyclic prop costs a bounded time.
export const MAX_SIZE = 1024 * 1024
const MAX_SIZE_DEPTH = 32
const MAX_SIZE_VALUES = 100_000

// What JSON writes for a value with no text of its own (in an array: null).
const skipped = (value: unknown) =>
  value === undefined ||
  typeof value === "function" ||
  typeof value === "symbol"

// An own data property's value; an accessor gives none (its getter is app code).
const fieldValue = (object: object, key: string) => {
  const field = Object.getOwnPropertyDescriptor(object, key)
  return field && "value" in field ? { value: field.value } : undefined
}

export function sizeOf(value: unknown): Size {
  let bytes = 0
  let values = 0
  let over = false
  const path = new Set<object>()
  const add = (n: number) => {
    bytes += n
    if (bytes > MAX_SIZE) {
      bytes = MAX_SIZE
      over = true
    }
  }
  const visit = (value: unknown, depth: number) => {
    if (over) return
    if (++values > MAX_SIZE_VALUES || depth > MAX_SIZE_DEPTH) {
      over = true
      return
    }
    if (typeof value === "string") {
      const left = MAX_SIZE - bytes
      add(JSON.stringify(value.slice(0, left)).length)
      if (value.length > left) over = true
      return
    }
    if (typeof value === "number")
      return add(Number.isFinite(value) ? String(value).length : 4)
    if (typeof value === "bigint") return add(String(value).length)
    if (typeof value === "boolean") return add(value ? 4 : 5)
    if (value === null || skipped(value)) return add(4)
    const object = value as object
    if (object instanceof Date)
      return add(
        Number.isNaN(object.getTime()) ? 4 : object.toISOString().length + 2,
      )
    if (path.has(object)) {
      over = true
      return
    }
    path.add(object)
    if (Array.isArray(object)) {
      add(2 + Math.max(object.length - 1, 0))
      for (let i = 0; i < object.length && !over; i++)
        visit(object[i], depth + 1)
    } else {
      add(2)
      let first = true
      for (const key of Object.keys(object)) {
        if (over) break
        const field = fieldValue(object, key)
        if (!field || skipped(field.value)) continue
        add(JSON.stringify(key).length + 1 + (first ? 0 : 1))
        first = false
        visit(field.value, depth + 1)
      }
    }
    path.delete(object)
  }
  // At the top, a value JSON can't write is no text at all.
  if (!skipped(value)) visit(value, 0)
  return over ? { bytes, over: true } : { bytes }
}

// A plain object's own data fields by size, largest first: what makes a big
// prop big. Arrays and other values have none.
export function largestFields(value: unknown, count = 3) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return []
  const fields: (Size & { key: string })[] = []
  for (const key of Object.keys(value)) {
    const field = fieldValue(value, key)
    if (field) fields.push({ key, ...sizeOf(field.value) })
  }
  return fields.sort((a, b) => b.bytes - a.bytes).slice(0, count)
}

// A prop this big earns a hint naming its largest fields.
const HINT_BYTES = 10 * 1024

// Each prop's size, in key order; a big one with its largest fields.
export function propSizes(props: unknown): PropSize[] {
  if (typeof props !== "object" || props === null) return []
  const sizes: PropSize[] = []
  for (const key of Object.keys(props).slice(0, MAX_PROP_SIZES)) {
    const field = fieldValue(props, key)
    if (!field) continue
    const size: PropSize = {
      key: key.slice(0, MAX_NAME),
      ...sizeOf(field.value),
    }
    if (size.bytes > HINT_BYTES) {
      const fields = largestFields(field.value, MAX_FIELDS)
      if (fields.length)
        size.fields = fields.map((f) => ({
          ...f,
          key: f.key.slice(0, MAX_NAME),
        }))
    }
    sizes.push(size)
  }
  return sizes
}
