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
    flags: [], mcap: null, pairing: null, tickerCopies: 0,
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
