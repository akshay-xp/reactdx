import { parseStack } from "../src/stack.ts"

// Where an Error was made: an element or hook call on its line has that location.
export const lineOf = (error: Error | undefined) => {
  const [, url, line] =
    /\(?([^ (]+):(\d+):\d+\)?$/.exec(
      parseStack(error?.stack ?? "")[0]?.source ?? "",
    ) ?? []
  return { url, line: Number(line) }
}
