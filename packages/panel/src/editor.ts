import { locationText, type SourceLocation } from "./source.ts"

export type EditorIO = {
  fetch: typeof globalThis.fetch
  // The inspected page's origin, where its dev server answers.
  origin(): Promise<string>
  copy(text: string): void
}

// Vite's and Next's dev servers open a file in the developer's editor. Neither is
// detected: each is asked in turn, and only an empty 2xx counts (an app's
// catch-all page doesn't). Otherwise `file:line:column` goes to the clipboard.
export async function openInEditor(
  location: SourceLocation,
  io: EditorIO,
): Promise<"opened" | "copied"> {
  const { file, line, column } = location
  const origin = await io.origin()
  const requests = [
    `${origin}/__open-in-editor?${new URLSearchParams({ file: locationText(location) })}`,
    `${origin}/__nextjs_launch-editor?${new URLSearchParams({ file, line1: String(line), column1: String(column) })}`,
  ]
  for (const url of requests) {
    try {
      const response = await io.fetch(url)
      if (response.ok && (await response.text()) === "") return "opened"
    } catch {}
  }
  io.copy(locationText(location))
  return "copied"
}
