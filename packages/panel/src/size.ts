import type { Size } from "@reactdx/messages"

// A page-measured size: bytes under 1,000, else KB with one decimal; past the
// page's caps, what was counted before it stopped.
export function sizeText({ bytes, over }: Size) {
  if (over) return `over ${Math.floor(bytes / 1024).toLocaleString("en-US")} KB`
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
