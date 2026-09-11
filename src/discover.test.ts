/**
 * Discovery tests. Currently focused on ticker collisions, which are a
 * presentation bug and a real trading hazard at the same time.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeBySymbol } from "./discover.ts";
import type { Runner } from "./types.ts";

function runner(symbol: string, addr: string, liq: number, score: number): Runner {
  return {
    symbol, score, liquidityUsd: liq, baseTokenId: addr,
    poolAddress: `pool-${addr}`, name: `${symbol} / SOL`, dex: "pumpswap",
    quoteTokenId: "sol", createdAt: null, priceUsd: 1, fdvUsd: 1e6,
    volume24hUsd: 1e6, change: { m5: 0, h1: 0, h6: 0, h24: 0 },
    txns24h: { buys: 0, sells: 0, buyers: 0, sellers: 0 }, sources: ["volume"],
    ageDays: 0.5, churn: 1, buyerSellerRatio: 1, buysPerBuyer: 1, sellsPerSeller: 1,
    flags: [], mcap: null, pairing: null, namesake: null, tickerCopies: 0,
    traders: null, bigWinners: null, botTraders: null,
  };
}

test("keeps one token per ticker, the deepest book", () => {
  // Real shape: three separate EMBER contracts cleared the filters on the same
  // day. Liquidity decides, not score — among tokens wearing the same name, the
  // deepest book is the one a reader actually ends up trading.
  const out = dedupeBySymbol([
    runner("EMBER", "aaa", 429_000, 90),
    runner("EMBER", "bbb", 1_749_000, 85),
    runner("EMBER", "ccc", 302_000, 80),
  ]);

  assert.equal(out.length, 1);
  assert.equal(out[0]!.baseTokenId, "bbb");
});

test("records how many copies were dropped", () => {
  const out = dedupeBySymbol([
    runner("EMBER", "aaa", 429_000, 90),
    runner("EMBER", "bbb", 1_749_000, 85),
    runner("EMBER", "ccc", 302_000, 80),
  ]);

  assert.equal(out[0]!.tickerCopies, 2, "buying the wrong contract is a real hazard");
});

test("leaves distinct tickers alone", () => {
  const out = dedupeBySymbol([
    runner("EMBER", "aaa", 100, 90),
    runner("NVIDIA", "bbb", 200, 80),
  ]);

  assert.equal(out.length, 2);
  assert.equal(out[0]!.tickerCopies, 0);
});

test("preserves score order", () => {
  const out = dedupeBySymbol([
    runner("A", "a", 100, 90),
    runner("B", "b", 999, 80),
    runner("C", "c", 100, 70),
  ]);

  assert.deepEqual(out.map((r) => r.symbol), ["A", "B", "C"]);
});

test("matches tickers case-insensitively", () => {
  const out = dedupeBySymbol([runner("ember", "a", 100, 90), runner("EMBER", "b", 200, 80)]);

  assert.equal(out.length, 1);
  assert.equal(out[0]!.tickerCopies, 1);
});

// ---------------------------------------------------- liquidity is unreliable

import { selectRunners } from "./discover.ts";
import { DEFAULT_FILTERS, type RawPool } from "./types.ts";

function pool(over: Partial<RawPool> = {}): RawPool {
  return {
    poolAddress: "p", name: "TOK / SOL", dex: "pumpswap",
    baseTokenId: "t", quoteTokenId: "sol", createdAt: null,
    priceUsd: 1, fdvUsd: 5_000_000, liquidityUsd: 200_000, volume24hUsd: 5_000_000,
    change: { m5: 0, h1: 0, h6: 0, h24: 200 },
    txns24h: { buys: 100, sells: 50, buyers: 2000, sellers: 40 },
    sources: ["volume"], ...over,
  };
}

test("admits a pool with no reported depth but real trading", () => {
  // The day's biggest mover reported $0 liquidity against $158m of volume.
  // GeckoTerminal does not report reserve_in_usd for most pools on this
  // network, so a flat depth floor rejected the market rather than the rugs.
  const { runners } = selectRunners([pool({ liquidityUsd: 0, volume24hUsd: 158_000_000 })], DEFAULT_FILTERS);

  assert.equal(runners.length, 1);
});

test("still rejects a thin pool with thin flow", () => {
  const { runners, stats } = selectRunners(
    [pool({ liquidityUsd: 3_000, volume24hUsd: 80_000, txns24h: { buys: 20, sells: 10, buyers: 25, sellers: 5 } })],
    DEFAULT_FILTERS,
  );

  assert.equal(runners.length, 0, "a rug has neither depth nor flow");
  assert.ok(stats.rejections["liquidity"]! > 0 || stats.rejections["volume"]! > 0);
});

test("reports which filter did the rejecting", () => {
  const { stats } = selectRunners(
    [pool({ fdvUsd: 1_000 }), pool({ change: { m5: 0, h1: 0, h6: 0, h24: 1 } })],
    DEFAULT_FILTERS,
  );

  assert.equal(stats.rejections["market cap"], 1);
  assert.equal(stats.rejections["24h gain"], 1);
});

test("treats dust liquidity as unreported, not as a real market", () => {
  // The trap: GeckoTerminal signals "no reserves data" with 0.01 and 0.00
  // rather than a missing field, so a `> 0` check looks correct and does
  // nothing. A pool showing $0.01 against $43m of volume produced a churn of
  // 43 trillion, which flagged wash trading and zeroed the score.
  const { runners } = selectRunners(
    [pool({ liquidityUsd: 0.01, volume24hUsd: 43_000_000 })],
    DEFAULT_FILTERS,
  );

  assert.equal(runners.length, 1);
  assert.equal(runners[0]!.churn, null, "$0.01 of depth is not a depth measurement");
  assert.ok(!runners[0]!.flags.includes("possible-wash-trading"));
  assert.ok(!runners[0]!.flags.includes("thin-float"));
  assert.ok(runners[0]!.score > 0, "and it must still be rankable");
});

test("unknown churn is not treated as wash trading", () => {
  // Infinity > any threshold, so a missing depth field used to flag the coin
  // as possible wash trading AND cut its score by 40%. Most of the page would
  // have carried an accusation generated by an absent number.
  const { runners } = selectRunners(
    [pool({ liquidityUsd: 0, volume24hUsd: 50_000_000 })],
    DEFAULT_FILTERS,
  );

  assert.equal(runners[0]!.churn, null, "unknown, not infinite");
  assert.ok(
    !runners[0]!.flags.includes("possible-wash-trading"),
    "unknown is not the same as bad",
  );
});

test("real churn is still flagged", () => {
  const { runners } = selectRunners(
    [pool({ liquidityUsd: 60_000, volume24hUsd: 40_000_000, createdAt: "2020-01-01T00:00:00Z" })],
    DEFAULT_FILTERS,
  );

  assert.ok(runners[0]!.churn! > 500);
  assert.ok(runners[0]!.flags.includes("possible-wash-trading"), "an established coin churning 600x is suspicious");
});

test("scores a coin with unreported depth instead of zeroing it", () => {
  // log10(1 + 0) is 0, and the score is a product — so every zero-liquidity
  // coin scored exactly 0.0 and sorted last in arbitrary order, including the
  // day's biggest movers (one ran 81x).
  const { runners } = selectRunners(
    [
      pool({ baseTokenId: "a", name: "A / SOL", liquidityUsd: 0, volume24hUsd: 30_000_000 }),
      pool({ baseTokenId: "b", name: "B / SOL", liquidityUsd: 0, volume24hUsd: 2_000_000 }),
    ],
    DEFAULT_FILTERS,
  );

  assert.ok(runners[0]!.score > 0, "a real market should not score zero for a missing field");
  assert.ok(runners[0]!.score > runners[1]!.score, "more flow should still outrank less");
});
