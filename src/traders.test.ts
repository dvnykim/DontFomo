/**
 * Aggregation tests. These pin down the product's editorial judgment, so they
 * assert on *ranking* and not just on arithmetic — the order is the opinion.
 *
 * All fixtures invented; see the note in sources/fomo-manual.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTraderLedTokens, isDistribution, DEFAULT_TRADER_CONFIG } from "./traders.ts";
import type { TraderDay, FomoTrade, FomoThesis } from "./types.ts";

const AT = "2026-09-11T12:00:00.000Z";

function trade(over: Partial<FomoTrade> = {}): FomoTrade {
  return {
    symbol: "alpha",
    action: "buy",
    amountUsd: 500,
    mcapUsd: 50_000,
    agoMinutes: 30,
    at: "2026-09-11T11:30:00.000Z",
    ...over,
  };
}

function thesis(over: Partial<FomoThesis> = {}): FomoThesis {
  return {
    symbol: "alpha",
    author: "someone",
    text: "invented reasoning",
    agoMinutes: 30,
    at: "2026-09-11T11:30:00.000Z",
    pnlUsd: 100,
    changePct: 10,
    likes: 5,
    closed: false,
    ...over,
  };
}

function day(handle: string, followers: number, trades: FomoTrade[], theses: FomoThesis[] = []): TraderDay {
  return {
    handle,
    displayName: null,
    followers,
    following: null,
    bio: null,
    portfolioUsd: null,
    pnl24hUsd: null,
    tradeCount: null,
    avgHold: null,
    trades,
    theses,
    positions: [],
    exportedAt: AT,
    parseWarnings: [],
  };
}

test("ranks consensus above conviction", () => {
  // beta has one trader committing far more money; alpha has three independent
  // traders. Three people independently buying is the rarer signal.
  const days = [
    day("a", 1000, [trade({ symbol: "alpha" }), trade({ symbol: "beta", amountUsd: 50_000 })]),
    day("b", 1000, [trade({ symbol: "alpha" })]),
    day("c", 1000, [trade({ symbol: "alpha" })]),
  ];

  const out = buildTraderLedTokens(days);
  assert.equal(out[0]!.symbol, "alpha");
  assert.equal(out[0]!.buyers.length, 3);
  assert.equal(out[1]!.symbol, "beta");
});

test("breaks ties on follower reach", () => {
  const days = [
    day("small", 100, [trade({ symbol: "alpha" })]),
    day("big", 90_000, [trade({ symbol: "beta" })]),
  ];

  const out = buildTraderLedTokens(days);
  assert.equal(out[0]!.symbol, "beta", "same buyer count, more eyes on it");
  assert.equal(out[0]!.followerReach, 90_000);
});

test("counts each trader once no matter how often they buy", () => {
  const days = [
    day("a", 500, [trade(), trade({ agoMinutes: 20 }), trade({ agoMinutes: 10 })]),
  ];

  const out = buildTraderLedTokens(days);
  assert.equal(out[0]!.buyers.length, 1, "one trader, three buys");
  assert.equal(out[0]!.buyCount, 3);
  assert.equal(out[0]!.followerReach, 500, "reach must not multiply by trade count");
});

test("ignores dust buys", () => {
  const days = [day("a", 100, [trade({ amountUsd: 10 })])];

  const out = buildTraderLedTokens(days);
  assert.equal(out.length, 0, "$10 probe buys are not calls");
});

test("takes market cap from the earliest buy, not the latest", () => {
  const days = [
    day("a", 100, [
      trade({ agoMinutes: 10, mcapUsd: 900_000, at: "2026-09-11T11:50:00.000Z" }),
      trade({ agoMinutes: 240, mcapUsd: 22_000, at: "2026-09-11T08:00:00.000Z" }),
      trade({ agoMinutes: 60, mcapUsd: 300_000, at: "2026-09-11T11:00:00.000Z" }),
    ]),
  ];

  const out = buildTraderLedTokens(days);
  assert.equal(out[0]!.firstBuyMcapUsd, 22_000, "entry is the oldest trade");
  assert.equal(out[0]!.firstBuyAt, "2026-09-11T08:00:00.000Z");
  assert.equal(out[0]!.lastTradeMcapUsd, 900_000, "latest is the most recent");
});

test("is not stateful across calls", () => {
  const first = [day("a", 100, [trade({ agoMinutes: 240, mcapUsd: 22_000 })])];
  const second = [day("b", 100, [trade({ agoMinutes: 30, mcapUsd: 80_000 })])];

  buildTraderLedTokens(first);
  const out = buildTraderLedTokens(second);

  assert.equal(out[0]!.firstBuyMcapUsd, 80_000, "prior call must not leak ordering state");
});

test("attaches theses to their token", () => {
  const days = [
    day("a", 100, [trade({ symbol: "alpha" })], [thesis({ symbol: "alpha", text: "why alpha" })]),
  ];

  const out = buildTraderLedTokens(days);
  assert.equal(out[0]!.theses.length, 1);
  assert.equal(out[0]!.theses[0]!.text, "why alpha");
});

test("matches symbols case-insensitively", () => {
  const days = [
    day("a", 100, [trade({ symbol: "Verity" })]),
    day("b", 100, [trade({ symbol: "VERITY" })]),
  ];

  const out = buildTraderLedTokens(days);
  assert.equal(out.length, 1, "same token, different casing");
  assert.equal(out[0]!.buyers.length, 2);
});

test("flags a token the group is distributing", () => {
  const days = [
    day("a", 100, [
      trade({ amountUsd: 500, action: "buy" }),
      trade({ amountUsd: 4_000, action: "sell", agoMinutes: 5 }),
    ]),
  ];

  const out = buildTraderLedTokens(days);
  assert.ok(isDistribution(out[0]!), "sold more than bought — worth saying out loud");
});

test("respects maxTokens", () => {
  const trades = Array.from({ length: 30 }, (_, i) => trade({ symbol: `tok${i}` }));
  const out = buildTraderLedTokens([day("a", 100, trades)]);

  assert.equal(out.length, DEFAULT_TRADER_CONFIG.maxTokens);
});
