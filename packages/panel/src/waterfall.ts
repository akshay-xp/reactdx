import type { CommitSummary, OwnedAwait } from "@reactdx/messages"

// Awaits that ran one after another (M7 #81): each started within GAP_MS of
// the one before it ending, so it could have started sooner. `id` is the
// newest member commit's seq, `seqs` the member commits oldest first, `ms`
// the first start to the last end.
export type Waterfall = {
  id: number
  seqs: number[]
  waits: OwnedAwait[]
  ms: number
}

const GAP_MS = 5

// An await, with the commit its boundary arrived in.
type Timed = { wait: OwnedAwait; seq: number }

export function waterfalls(commits: CommitSummary[]): Waterfall[] {
  const awaits: Timed[] = commits
    .flatMap((commit) =>
      (commit.arrived ?? []).flatMap((arrival) =>
        arrival.awaits.map((wait) => ({ wait, seq: commit.seq })),
      ),
    )
    .sort((a, b) => a.wait.start - b.wait.start)
  const chains: Timed[][] = []
  for (const item of awaits) {
    const chain = chains.find((chain) => {
      const gap = item.wait.start - (chain.at(-1) as Timed).wait.end
      return gap >= 0 && gap <= GAP_MS
    })
    if (chain) chain.push(item)
    else chains.push([item])
  }
  return chains
    .filter((chain) => chain.length > 1)
    .map((chain) => {
      const seqs = [...new Set(chain.map((item) => item.seq))].sort(
        (a, b) => a - b,
      )
      const waits = chain.map((item) => item.wait)
      const first = waits[0] as OwnedAwait
      const last = waits.at(-1) as OwnedAwait
      return {
        id: seqs.at(-1) as number,
        seqs,
        waits,
        ms: last.end - first.start,
      }
    })
}
