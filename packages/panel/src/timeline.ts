import type {
  CommitRender,
  CommitSummary,
  CommitsMessage,
  CommittedMessage,
  Updater,
} from "@reactdx/messages"
import { createSignal } from "solid-js"
import { type Waterfall, waterfalls } from "./waterfall"

// What the store asks the page for; the panel adds the tab (CommitMessage).
export type TimelineCommand =
  | { type: "commit"; seq: number }
  | { type: "clear-updates" }

export type TimelineStore = ReturnType<typeof createTimelineStore>

export type CommitDetail = { renders: CommitRender[]; updaters: Updater[] }

// A row of the Updates list: one update, or a run of updates with the same
// cause (`id` its oldest member's seq), its members following while open.
export type UpdateRow =
  | { kind: "update"; commit: CommitSummary; member?: true }
  | {
      kind: "group"
      id: number
      commits: CommitSummary[]
      wasted: number
      open: boolean
    }
  // Awaits that ran one after another (M7 #81), at its newest member update;
  // the members, wherever they fell, follow it while open.
  | { kind: "waterfall"; waterfall: Waterfall; open: boolean }

// Same updaters, same changed hook: the same cause again (a burst of typing).
const sameCause = (a: CommitSummary, b: CommitSummary) =>
  a.updaters.length > 0 &&
  a.updaters.join() === b.updaters.join() &&
  a.change?.hook === b.change?.hook

// The recent commits (docs/panel.md, Commits), the one picked and what it
// rendered and why: undefined while loading, null once the page released it.
// A pick pins the inspector to that commit. Filtered, the list holds only the
// commits in the selected node's history. The page bounds the list: each
// message says the oldest commit it still holds.
export function createTimelineStore(
  send: (command: TimelineCommand) => void,
  inspector: { pin(seq: number | undefined): void },
) {
  const [commits, setCommits] = createSignal<CommitSummary[]>([])
  const [picked, setPicked] = createSignal<number>()
  const [detail, setDetail] = createSignal<CommitDetail | null>()
  const [filtered, setFiltered] = createSignal(false)
  const [dropped, setDropped] = createSignal(false)
  // Only the updates that had renders for nothing.
  const [wasted, setWasted] = createSignal(false)

  const shown = (history: number[]) =>
    commits()
      .filter(
        (commit) =>
          (!filtered() || history.includes(commit.seq)) &&
          (!wasted() || commit.wasted > 0),
      )
      .reverse()
  // Groups opened or closed by hand, by id; a pick resets them, so the
  // group holding it opens.
  const [groups, setGroups] = createSignal(new Map<number, boolean>())
  const isOpen = (id: number, members: CommitSummary[]) =>
    groups().get(id) ?? members.some((commit) => commit.seq === picked())
  const rows = (history: number[]): UpdateRow[] => {
    const all = shown(history)
    const fallOf = new Map<number, Waterfall>()
    for (const fall of waterfalls([...all].reverse()))
      for (const seq of fall.seqs) fallOf.set(seq, fall)
    // A waterfall's members leave the list; its row stands at the newest.
    const list = all.filter((commit) => {
      const fall = fallOf.get(commit.seq)
      return !fall || fall.id === commit.seq
    })
    const out: UpdateRow[] = []
    for (let at = 0; at < list.length; ) {
      const first = list[at] as CommitSummary
      const fall = fallOf.get(first.seq)
      if (fall) {
        at++
        const members = [...fall.seqs]
          .reverse()
          .map(
            (seq) => all.find((commit) => commit.seq === seq) as CommitSummary,
          )
        const open = isOpen(fall.id, members)
        out.push({ kind: "waterfall", waterfall: fall, open })
        if (open)
          for (const commit of members)
            out.push({ kind: "update", commit, member: true })
        continue
      }
      let end = at + 1
      while (
        end < list.length &&
        !fallOf.has((list[end] as CommitSummary).seq) &&
        sameCause(first, list[end] as CommitSummary)
      )
        end++
      const run = list.slice(at, end)
      at = end
      if (run.length < 2) {
        out.push({ kind: "update", commit: first })
        continue
      }
      const id = (run.at(-1) as CommitSummary).seq
      const open = isOpen(id, run)
      out.push({
        kind: "group",
        id,
        commits: run,
        wasted: run.reduce((sum, commit) => sum + commit.wasted, 0),
        open,
      })
      if (open)
        for (const commit of run)
          out.push({ kind: "update", commit, member: true })
    }
    return out
  }
  const setGroup = (id: number, open: boolean) =>
    setGroups(new Map(groups()).set(id, open))
  // The group holding the picked update, if any.
  // The group or waterfall holding the picked update, by its id.
  const pickedGroup = (history: number[]) => {
    const seq = picked()
    for (const row of rows(history)) {
      if (row.kind === "group" && row.commits.some((c) => c.seq === seq))
        return { id: row.id }
      if (row.kind === "waterfall" && row.waterfall.seqs.includes(seq ?? -1))
        return { id: row.waterfall.id }
    }
  }
  const pick = (seq: number) => {
    setGroups(new Map())
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
    wasted,
    setWasted,
    rows,
    setGroup,
    // Empties the page's recorded updates and the list.
    clearUpdates() {
      send({ type: "clear-updates" })
      setCommits([])
      live()
    },
    // Whether the page's limits dropped older commits.
    dropped,
    pick,
    live,
    receiveCommits(message: CommitsMessage) {
      const { oldest } = message
      setCommits([
        ...commits().filter((commit) => commit.seq >= oldest),
        ...message.commits,
      ])
      setDropped(message.dropped)
      const at = picked()
      if (at !== undefined && at < oldest) live()
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
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const group = pickedGroup(history)
        if (group) setGroup(group.id, key === "ArrowRight")
        return group !== undefined
      }
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
    // A new watch of the same document (a reconnect): the page sends its
    // buffer again; the pick stays if it's still there.
    reset() {
      setCommits([])
      setDropped(false)
    },
    // A new document: nothing carries over.
    clear() {
      setCommits([])
      setDropped(false)
      live()
    },
  }
}
