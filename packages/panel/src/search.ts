// Inspector search (docs/panel.md, Inspector search): case-insensitive substring.

// Every non-overlapping occurrence of `query` in `text`, as [start, end).
export function matchRanges(text: string, query: string): [number, number][] {
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const ranges: [number, number][] = []
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    ranges.push([at, at + needle.length])
  return ranges
}

// An empty query matches everything.
export const matches = (text: string, query: string) =>
  !query || matchRanges(text, query).length > 0

// DOM ranges over each match in the text of `root`'s `[data-search-text]`
// elements. The DOM is left alone: ranges are painted (CSS.highlights), so a
// value stays one text node.
export function searchRanges(root: Element, query: string): Range[] {
  const ranges: Range[] = []
  if (!query) return ranges
  for (const marked of root.querySelectorAll("[data-search-text]")) {
    const walker = document.createTreeWalker(marked, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      for (const [start, end] of matchRanges(node.textContent ?? "", query)) {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        ranges.push(range)
      }
    }
  }
  return ranges
}
