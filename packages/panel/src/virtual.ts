export const ROW_HEIGHT = 20
export const OVERSCAN = 10

// The rows in view plus OVERSCAN on each side, as [start, end).
export function windowOf(scrollTop: number, height: number, count: number) {
  const start = Math.max(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, 0)
  const end = Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN
  return { start: Math.min(start, count), end: Math.min(end, count) }
}
