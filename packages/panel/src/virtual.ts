export const ROW_HEIGHT = 20
export const OVERSCAN = 10

// The rows in view plus OVERSCAN on each side, as [start, end). `top` is the
// view's top in the tree's coordinates: negative when the tree starts below it.
export function windowOf(top: number, height: number, count: number) {
  const start = Math.max(Math.floor(top / ROW_HEIGHT) - OVERSCAN, 0)
  const end = Math.max(Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN, 0)
  return { start: Math.min(start, count), end: Math.min(end, count) }
}
