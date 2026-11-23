import type { CommitSummary, CommittedMessage } from "@reactdx/messages"
import { createSignal } from "solid-js"

// What the store asks the page for; the panel adds the tab (CommitMessage).
export type TimelineCommand = { type: "commit"; seq: number }

export type TimelineStore = ReturnType<typeof createTimelineStore>

// The page keeps its last 100 commits; the strip shows as many.
const MAX_COMMITS = 100

// The recent commits (docs/panel.md, Timeline), the one picked (none: Live,
// following new commits) and the ids that rendered in it. A pick pins the
// inspector to that commit.
export function createTimelineStore(
  send: (command: TimelineCommand) => void,
  inspector: { pin(seq: number | undefined): void },
) {
  const [commits, setCommits] = createSignal<CommitSummary[]>([])
  const [picked, setPicked] = createSignal<number>()
  const [marks, setMarks] = createSignal(new Set<number>())

  const pick = (seq: number) => {
    setPicked(seq)
    setMarks(new Set<number>())
    send({ type: "commit", seq })
    inspector.pin(seq)
  }
  const live = () => {
    setPicked(undefined)
    setMarks(new Set<number>())
    inspector.pin(undefined)
  }

  return {
    commits,
    picked,
    marks,
    pick,
    live,
    receiveCommits(list: CommitSummary[]) {
      setCommits([...commits(), ...list].slice(-MAX_COMMITS))
    },
    receiveCommitted(message: CommittedMessage) {
      if (message.seq !== picked() || !message.ids) return
      setMarks(new Set([...marks(), ...message.ids]))
    },
    // Left/Right step through the commits (Left from Live takes the newest,
    // Right past it goes Live); End and Escape go Live. True if handled.
    key(key: string) {
      const seqs = commits().map((commit) => commit.seq)
      const at = picked()
      const index = at === undefined ? seqs.length : seqs.indexOf(at)
      if (key === "End" || key === "Escape") live()
      else if (key === "ArrowLeft") {
        const seq = seqs[index - 1]
        if (seq !== undefined) pick(seq)
      } else if (key === "ArrowRight") {
        const seq = seqs[index + 1]
        if (seq !== undefined) pick(seq)
        else if (at !== undefined) live()
      } else return false
      return true
    },
    // A new watch: the page sends its buffer again.
    reset() {
      setCommits([])
      live()
    },
  }
}
