const sorted = (values: number[]) => [...values].sort((a, b) => a - b)

export const median = (values: number[]): number => {
  const s = sorted(values)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Nearest-rank p95.
export const p95 = (values: number[]): number => {
  const s = sorted(values)
  return s[Math.ceil(0.95 * s.length) - 1]
}
