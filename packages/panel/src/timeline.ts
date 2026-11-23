import type {
  CommitRender,
  CommitSummary,
  CommittedMessage,
  Updater,
} from "@reactdx/messages"
import { createSignal } from "solid-js"

// What the store asks the page for; the panel adds the tab (CommitMessage).
export type TimelineCommand = { type: "commit"; seq: number }

export type TimelineStore = ReturnType<typeof createTimelineStore>

export type CommitDetail = { renders: CommitRender[]; updaters: Updater[] }

// The page keeps its last 100 commits; the list shows as many.
const MAX_COMMITS = 100

// The recent commits (docs/panel.md, Commits), the one picked and what it
// rendered and why: undefined while loading, null once the page released it.
// A pick pins the inspector to that commit. Filtered, the list holds only the
// commits in the selected node's history.
export function createTimelineStore(
  send: (command: TimelineCommand) => void,
  inspector: { pin(seq: number | undefined): void },
) {
  const [commits, setCommits] = createSignal<CommitSummary[]>([])
  const [picked, setPicked] = createSignal<number>()
  const [detail, setDetail] = createSignal<CommitDetail | null>()
  const [filtered, setFiltered] = createSignal(false)

  const shown = (history: number[]) => {
    const list = filtered()
      ? commits().filter((commit) => history.includes(commit.seq))
      : commits()
    return [...list].reverse()
  }
  const pick = (seq: number) => {
    setPicked(seq)
    setDetail(undefined)
    send({ type: "commit", seq })
    inspector.pin(seq)
  }
  const live = () => {
    setPicked(undefined)
    setDetail(undefined)
    inspector.pin(undefined)
  }

  return {
    commits,
    shown,
    picked,
    detail,
    filtered,
    setFiltered,
    pick,
    live,
    receiveCommits(list: CommitSummary[]) {
      setCommits([...commits(), ...list].slice(-MAX_COMMITS))
    },
    receiveCommitted(message: CommittedMessage) {
      if (message.seq !== picked()) return
      if (!message.renders) return setDetail(null)
      const before = detail()
      setDetail({
        renders: [...(before?.renders ?? []), ...message.renders],
        updaters: message.updaters ?? before?.updaters ?? [],
      })
    },
    // Up/Down step to newer/older commits in the list as shown (Down from none
    // picks the newest); Home and End pick the newest and oldest; Escape
    // unpicks. True if handled.
    key(key: string, history: number[]) {
      const seqs = shown(history).map((commit) => commit.seq)
      const at = picked()
      const index = at === undefined ? -1 : seqs.indexOf(at)
      const to = {
        ArrowDown: Math.min(index + 1, seqs.length - 1),
        ArrowUp: Math.max(index - 1, 0),
        Home: 0,
        End: seqs.length - 1,
      }[key]
      if (key === "Escape") live()
      else if (to === undefined) return false
      else {
        const seq = seqs[to]
        if (seq !== undefined && seq !== at) pick(seq)
      }
      return true
    },
    // A new watch: the page sends its buffer again.
    reset() {
      setCommits([])
      live()
    },
  }
}
