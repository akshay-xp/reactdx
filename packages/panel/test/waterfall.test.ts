import type { Arrival, CommitSummary, OwnedAwait } from "@reactdx/messages"
import { expect, test } from "vitest"
import { waterfalls } from "../src/waterfall"

const wait = (name: string, owner: string, start: number, end: number) => ({
  name,
  owner,
  start,
  end,
})
const commit = (seq: number, ...arrivals: OwnedAwait[][]): CommitSummary => ({
  seq,
  time: seq,
  rootId: 1,
  updaters: [],
  renders: 1,
  wasted: 0,
  arrived: arrivals.map(
    (awaits, i): Arrival => ({
      boundary: seq * 10 + i,
      name: "B",
      waited: 1,
      awaits,
    }),
  ),
})

const reviews = wait("getReviews", "Reviews", 96, 1297)
const recs = wait("getRecommendations", "Recommendations", 1300, 2102)

test("awaits that start as the one before ends make a waterfall, across commits", () => {
  expect(
    waterfalls([commit(1, [reviews]), commit(2, []), commit(3, [recs])]),
  ).toEqual([{ id: 3, seqs: [1, 3], waits: [reviews, recs], ms: 2006 }])
})

test("awaits that overlap don't", () => {
  const product = wait("getProduct", "ProductDetails", 95, 397)
  expect(waterfalls([commit(1, [product]), commit(2, [reviews])])).toEqual([])
})

test("up to 5 ms between them still counts", () => {
  const at = (gap: number) => wait("next", "N", 1297 + gap, 1400)
  expect(waterfalls([commit(1, [reviews]), commit(2, [at(5)])])).toHaveLength(1)
  expect(waterfalls([commit(1, [reviews]), commit(2, [at(6)])])).toEqual([])
})

test("two awaits in one commit, one after the other, are a waterfall too", () => {
  const more = wait("getMore", "Reviews", 1297, 1500)
  expect(waterfalls([commit(1, [reviews, more])])).toEqual([
    { id: 1, seqs: [1], waits: [reviews, more], ms: 1404 },
  ])
})

test("no arrivals, no waterfalls", () => {
  expect(waterfalls([{ ...commit(1), arrived: undefined }])).toEqual([])
})
