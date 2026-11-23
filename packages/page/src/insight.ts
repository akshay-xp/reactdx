// Why each component rendered, recorded per commit while the panel watches
// (docs/page.md, Render insight). Values stay as references: nothing is
// serialized until the panel shows a record.

import type { Fiber } from "./tree.ts"

export type RenderKind =
  | "mount"
  | "props"
  | "state"
  | "context"
  | "parent"
  | "force"

export type RenderRecord = { seq: number; kinds: RenderKind[] }

type Commit = {
  seq: number
  time: number
  rootId: number
  records: Map<number, RenderRecord>
}

// Function, class, forwardRef and memo components: the fibers that render.
const COMPONENTS = new Set([0, 1, 11, 14, 15])
// React's PerformedWork flag: the fiber rendered in this commit.
const PERFORMED_WORK = 1

type Flagged = Fiber & { flags: number }

export function createRecorder() {
  let seq = 1
  const commits: Commit[] = []

  const reasons = (fiber: Fiber): RenderKind[] =>
    fiber.alternate ? ["parent"] : ["mount"]

  return {
    // `walk` visits the commit's fibers (the tree's commit walk).
    commit(
      rootId: number,
      _updaters: Set<unknown>,
      walk: (visit: (fiber: Fiber, id: number) => void) => void,
    ) {
      const records = new Map<number, RenderRecord>()
      const at = seq++
      walk((fiber, id) => {
        if (
          COMPONENTS.has(fiber.tag) &&
          (fiber as Flagged).flags & PERFORMED_WORK
        )
          records.set(id, { seq: at, kinds: reasons(fiber) })
      })
      commits.push({ seq: at, time: performance.now(), rootId, records })
    },
    latest(id: number) {
      for (let i = commits.length - 1; i >= 0; i--) {
        const found = commits[i]?.records.get(id)
        if (found) return found
      }
    },
  }
}
