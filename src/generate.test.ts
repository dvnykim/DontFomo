/**
 * Guardrail tests. Run: node --experimental-strip-types --test src/generate.test.ts
 *
 * These cover the mechanical filter that drops unsupported claims. It is the
 * layer that actually enforces the people-claims policy in DECISIONS.md, so it
 * needs tests that don't depend on model behaviour.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOutput, type GeneratedNarrative } from "./generate.ts";
import type { Snapshot, Runner, Trader } from "./types.ts";
import { DEFAULT_FILTERS, SCHEMA_VERSION } from "./types.ts";

function trader(over: Partial<Trader> = {}): Trader {
  return {
    wallet: "So1111111111111111111111111111111111111111",
    pnlUsd: 20_000,
    realizedPnlUsd: 4_000,
    volumeUsd: 300_000,
    trades: 33,
    tags: [],
    isBot: false,
    firstBuyAt: null,
    lastSellAt: null,
    handle: "realtrader",
    thesis: null,
    thesisPostedAt: null,
    followers: 1000,
    ...over,
  };
}

function snapshot(runners: Partial<Runner>[]): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    date: "2026-09-10",
    generatedAt: "2026-09-10T09:00:00.000Z",
    network: "solana",
    window: { from: "2026-09-09T09:00:00.000Z", to: "2026-09-10T09:00:00.000Z" },
    config: DEFAULT_FILTERS,
    stats: {
      poolsScanned: 0,
      afterDedupe: 0,
      afterFilters: 0,
      runnersKept: runners.length,
      tradersFetched: null,
    },
    runners: runners.map(
      (r) =>
        ({
          poolAddress: "pool",
          name: `${r.symbol} / SOL`,
          dex: "pumpswap",
          baseTokenId: "solana_x",
          quoteTokenId: "solana_sol",
          createdAt: null,
          priceUsd: 1,
          fdvUsd: 1_000_000,
          liquidityUsd: 100_000,
          volume24hUsd: 1_000_000,
          change: { m5: 0, h1: 0, h6: 0, h24: 0 },
          txns24h: { buys: 0, sells: 0, buyers: 0, sellers: 0 },
          sources: ["volume"],
          symbol: "X",
          ageDays: 0.5,
          churn: 10,
          buyerSellerRatio: 1,
          buysPerBuyer: 1,
          sellsPerSeller: 1,
          score: 1,
          flags: [],
          mcap: null,
          traders: null,
          bigWinners: null,
          botTraders: null,
          ...r,
        }) as Runner,
    ),
  };
}

function narrative(text: string, symbol = "CATE"): GeneratedNarrative {
  return {
    mood: "test",
    groups: [],
    coins: [{ symbol, label: "", timeline: [{ time: "12:00", text }] }],
  };
}

test("keeps a line naming a handle present in the evidence", () => {
  const snap = snapshot([{ symbol: "CATE", traders: [trader()] }]);
  const n = narrative("@realtrader bought early and banked $4k");
  const report = validateOutput(n, snap);

  assert.equal(report.kept, 1);
  assert.equal(report.dropped.length, 0);
  assert.equal(n.coins[0]!.timeline.length, 1);
});

test("drops a line naming a handle absent from the evidence", () => {
  const snap = snapshot([{ symbol: "CATE", traders: [trader()] }]);
  const n = narrative("@someguy called the top");
  const report = validateOutput(n, snap);

  assert.equal(report.kept, 0);
  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0]!.reason, /@someguy/);
  assert.equal(n.coins[0]!.timeline.length, 0, "offending line must be removed");
});

test("drops a line referencing a ticker not in the snapshot", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("ran alongside $FAKECOIN all afternoon");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0]!.reason, /\$fakecoin/i);
});

test("allows tickers that are in the snapshot", () => {
  const snap = snapshot([{ symbol: "CATE" }, { symbol: "baton" }]);
  const n = narrative("moved with $baton on the same meta");
  const report = validateOutput(n, snap);

  assert.equal(report.kept, 1);
  assert.equal(report.dropped.length, 0);
});

test("bot wallets have no handle, so naming one is dropped", () => {
  const snap = snapshot([
    { symbol: "baton", traders: [trader({ handle: null, isBot: true, tags: ["bundler"] })] },
  ]);
  const n = narrative("@bundlerbot accumulated the whole float", "baton");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1, "unnamed bot wallets must not be nameable");
});

test("drops a line reproducing thesis text verbatim", () => {
  const thesis = "runescape hats are the meta right now and nobody has noticed yet";
  const snap = snapshot([{ symbol: "CATE", traders: [trader({ thesis })] }]);
  const n = narrative(`@realtrader said runescape hats are the meta right now and nobody has noticed yet`);
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0]!.reason, /verbatim/);
});

test("allows paraphrase of a thesis", () => {
  const thesis = "runescape hats are the meta right now and nobody has noticed yet";
  const snap = snapshot([{ symbol: "CATE", traders: [trader({ thesis })] }]);
  const n = narrative("@realtrader posted a thesis on the runescape hat meta");
  const report = validateOutput(n, snap);

  assert.equal(report.kept, 1);
  assert.equal(report.dropped.length, 0);
});

test("keeps figures that match the snapshot", () => {
  const snap = snapshot([
    {
      symbol: "CATE",
      mcap: { low: 35_274_815, high: 70_118_466, current: 60_000_000, multiple: 2, peakAt: null },
      txns24h: { buys: 0, sells: 0, buyers: 13_407, sellers: 13_202 },
    },
  ]);
  const n = narrative("marked $70m, a 2x off the $35m base. 13407 buyers");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 0, JSON.stringify(report.dropped));
  assert.equal(report.kept, 1);
});

test("drops a fabricated market cap", () => {
  const snap = snapshot([
    {
      symbol: "CATE",
      mcap: { low: 35_274_815, high: 70_118_466, current: 60_000_000, multiple: 2, peakAt: null },
    },
  ]);
  const n = narrative("ripped to $250m on the day");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0]!.reason, /\$250m/);
});

test("drops a fabricated multiple", () => {
  const snap = snapshot([
    {
      symbol: "CATE",
      mcap: { low: 35_274_815, high: 70_118_466, current: 60_000_000, multiple: 2, peakAt: null },
    },
  ]);
  const n = narrative("a clean 9x off the base");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0]!.reason, /9x/);
});

test("does not mistake clock times for unsupported figures", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("peaked 15:00 after launching 06:35");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 0, JSON.stringify(report.dropped));
});

test("market-narrative lines with no named entities pass through", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("hated rally, every top wallet was automated");
  const report = validateOutput(n, snap);

  assert.equal(report.kept, 1);
  assert.equal(report.dropped.length, 0);
});

// ---------------------------------------------------------------- cross-day claims

test("drops a line claiming continuity with another day", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("ran the same as yesterday, no new buyers");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0]!.reason, /another day/);
});

test("allows intraday repetition wording", () => {
  // "again" and "still" have legitimate same-day readings; blocking them would
  // cost real lines to prevent a problem that isn't there.
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("bounced again off the same level, still bid into the close");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 0, JSON.stringify(report.dropped));
});

test("blanks an unsupported label but keeps the timeline", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("held the range all afternoon");
  n.coins[0]!.label = "Same As Yesterday";

  const report = validateOutput(n, snap);

  assert.equal(n.coins[0]!.label, "", "label must not survive");
  assert.equal(n.coins[0]!.timeline.length, 1, "timeline is still good");
  assert.match(report.dropped[0]!.reason, /unsupported label/);
});

test("blanks a label naming a ticker not in the snapshot", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("held the range");
  n.coins[0]!.label = "Rode $FAKECOIN's Wave";

  validateOutput(n, snap);
  assert.equal(n.coins[0]!.label, "");
});

test("blanks a label with a fabricated figure", () => {
  const snap = snapshot([
    {
      symbol: "CATE",
      mcap: { low: 35_000_000, high: 70_000_000, current: 60_000_000, multiple: 2, peakAt: null },
    },
  ]);
  const n = narrative("held the range");
  n.coins[0]!.label = "The Clean 9x";

  validateOutput(n, snap);
  assert.equal(n.coins[0]!.label, "", "labels were previously unchecked");
});

test("keeps a legitimate label untouched", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("held the range");
  n.coins[0]!.label = "Runner Of The Day";

  const report = validateOutput(n, snap);
  assert.equal(n.coins[0]!.label, "Runner Of The Day");
  assert.equal(report.dropped.length, 0);
});

// ------------------------------------------------- population claims from a sample

test("drops a count of winners stated as a population fact", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("two real winners cleared here");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0]!.reason, /population claim/);
});

test("a disclosure in another clause does not launder an undisclosed claim", () => {
  // The failure this was written for: "of 8" in the first clause made the
  // second clause's bare "0 real winners" look disclosed.
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("8 of 8 top wallets bots, 0 real winners");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1, "claims must not cross clause boundaries");
});

test("keeps a winner count that discloses the sample", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("2 of 8 sampled traders cleared the bar");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 0, JSON.stringify(report.dropped));
});

test("keeps statements about wallets, which are not people claims", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("8 of 8 top wallets were bots");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 0, JSON.stringify(report.dropped));
});

test("drops vague absolutes about nobody making money", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("big print but nothing real underneath");
  const report = validateOutput(n, snap);

  assert.equal(report.dropped.length, 1);
});

// ------------------------------------------------------------- section titles

test("blanks a section title naming an unsupported ticker", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("held the range");
  n.groups = [{ key: "pair:fake", title: "Rotation Into $GHOSTCOIN" }];

  const report = validateOutput(n, snap);

  assert.equal(n.groups[0]!.title, "", "a header is the most prominent text on the page");
  assert.match(report.dropped[0]!.reason, /section title/);
});

test("blanks a section title claiming another day", () => {
  const snap = snapshot([{ symbol: "CATE" }]);
  const n = narrative("held the range");
  n.groups = [{ key: "fresh", title: "Same As Yesterday" }];

  validateOutput(n, snap);
  assert.equal(n.groups[0]!.title, "");
});

test("keeps a legitimate section title", () => {
  const snap = snapshot([{ symbol: "CATE" }, { symbol: "baton" }]);
  const n = narrative("held the range");
  n.groups = [{ key: "pair:baton", title: "Rotate Back Into $baton" }];

  const report = validateOutput(n, snap);
  assert.equal(n.groups[0]!.title, "Rotate Back Into $baton");
  assert.equal(report.dropped.length, 0, JSON.stringify(report.dropped));
});
