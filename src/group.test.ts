/**
 * Grouping tests. The clustering IS the recap's structure, so these assert on
 * which coins end up together and in what order.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRunners, flatten } from "./group.ts";
import type { Runner, Pairing } from "./types.ts";

function runner(symbol: string, capM: number, pair?: string, ageDays = 0.5): Runner {
  const pairing: Pairing | null = pair
    ? { symbol: pair, volumeUsd: 5_000_000, share: 0.5, dominant: true }
    : null;
  return {
    symbol, ageDays, pairing,
    mcap: { low: capM * 1e5, high: capM * 1e6, current: capM * 1e6, multiple: 10, peakAt: null },
    poolAddress: `pool-${symbol}`, name: `${symbol} / SOL`, dex: "x",
    baseTokenId: `t-${symbol}`, quoteTokenId: "sol", createdAt: null,
    priceUsd: 1, fdvUsd: capM * 1e6, liquidityUsd: 1e5, volume24hUsd: 1e6,
    change: { m5: 0, h1: 0, h6: 0, h24: 0 },
    txns24h: { buys: 0, sells: 0, buyers: 0, sellers: 0 },
    sources: ["volume"], churn: 1, buyerSellerRatio: 1, buysPerBuyer: 1,
    sellsPerSeller: 1, score: capM, flags: [], traders: null,
    bigWinners: null, botTraders: null,
  };
}

test("clusters coins that share a pairing", () => {
  const groups = groupRunners([
    runner("KNOTS", 45, "STONK"),
    runner("btc", 18, "STONK"),
    runner("NEARKAT", 9, "STONK"),
    runner("lonely", 5),
  ]);

  const stonk = groups.find((g) => g.pairedWith === "STONK")!;
  assert.equal(stonk.runners.length, 3, "eight coins running for one reason is the story");
  assert.deepEqual(stonk.runners.map((r) => r.symbol), ["KNOTS", "btc", "NEARKAT"]);
});

test("leads with the theme, not merely the biggest coin", () => {
  // A lone $80m coin is a smaller story than three coins rotating into one pair.
  const groups = groupRunners([
    runner("whale", 80),
    runner("a", 20, "STONK"),
    runner("b", 15, "STONK"),
  ]);

  assert.equal(groups[0]!.pairedWith, "STONK");
});

test("orders groups by combined size", () => {
  const groups = groupRunners([
    runner("a", 5, "SMALL"), runner("b", 5, "SMALL"),
    runner("c", 50, "BIG"), runner("d", 40, "BIG"),
  ]);

  assert.equal(groups[0]!.pairedWith, "BIG");
});

test("gives a lone paired coin its own section", () => {
  const groups = groupRunners([runner("mario", 8, "NVIDIA"), runner("x", 1), runner("y", 1)]);
  const solo = groups.find((g) => g.pairedWith === "NVIDIA")!;

  assert.equal(solo.runners.length, 1);
  assert.match(solo.title, /mario/);
});

test("splits unpaired coins by age", () => {
  const groups = groupRunners([
    runner("new1", 3, undefined, 0.2),
    runner("new2", 2, undefined, 0.4),
    runner("old", 20, undefined, 40),
  ]);

  const fresh = groups.find((g) => g.kind === "fresh")!;
  const est = groups.find((g) => g.kind === "established")!;

  assert.deepEqual(fresh.runners.map((r) => r.symbol), ["new1", "new2"]);
  assert.deepEqual(est.runners.map((r) => r.symbol), ["old"]);
});

test("sorts coins inside a group by peak market cap", () => {
  const groups = groupRunners([
    runner("small", 2, "STONK"),
    runner("big", 45, "STONK"),
    runner("mid", 18, "STONK"),
  ]);

  assert.deepEqual(groups[0]!.runners.map((r) => r.symbol), ["big", "mid", "small"]);
});

test("every runner lands in exactly one group", () => {
  const runners = [
    runner("a", 5, "STONK"), runner("b", 4, "STONK"), runner("c", 3, "PUMP"),
    runner("d", 2), runner("e", 1, undefined, 90),
  ];
  const flat = flatten(groupRunners(runners));

  assert.equal(flat.length, runners.length, "no coin dropped or duplicated");
  assert.equal(new Set(flat.map((r) => r.symbol)).size, runners.length);
});

test("handles a day with no pairings at all", () => {
  const groups = groupRunners([runner("a", 5), runner("b", 4)]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.kind, "fresh");
});

test("returns nothing for an empty day", () => {
  assert.deepEqual(groupRunners([]), []);
});
