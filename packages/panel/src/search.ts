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
