import type { Browser } from "puppeteer"

type BidiResult = {
  type: string
  contexts: { context: string }[]
  result: { type: string; value?: string }
}

// Evaluates in Firefox's own browser UI (chrome scope) over raw WebDriver BiDi, which
// Puppeteer has no API for. Needs MOZ_REMOTE_ALLOW_SYSTEM_ACCESS (e2e/launch.ts).
// The expression must produce a string, or null.
export async function chromeEval(
  browser: Browser,
  expression: string,
): Promise<string | null> {
  const { connection } = browser as unknown as {
    connection: {
      send(method: string, params: object): Promise<{ result: BidiResult }>
    }
  }
  const tree = await connection.send("browsingContext.getTree", {
    "moz:scope": "chrome",
  })
  const { result } = await connection.send("script.evaluate", {
    expression,
    target: { context: tree.result.contexts[0]?.context },
    awaitPromise: true,
  })
  if (result.type === "exception") throw new Error(JSON.stringify(result))
  return result.result.type === "string" ? (result.result.value ?? "") : null
}
