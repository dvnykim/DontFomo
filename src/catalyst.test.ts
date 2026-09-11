/**
 * Catalyst tests. The rule under test: a catalyst explains WHY. A line built
 * from price is a caption for a chart the reader is already looking at.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPriceRestatement, checkCatalyst, buildThesisEvidence } from "./catalyst.ts";
import type { FomoThesis, TraderLedToken } from "./types.ts";

function th(over: Partial<FomoThesis> = {}): FomoThesis {
  return {
    symbol: "TOK", author: "someone", text: "a post", agoMinutes: 60,
    at: "2026-09-11T11:00:00.000Z", pnlUsd: null, changePct: null, likes: null,
    closed: false, ...over,
  };
}

function token(over: Partial<TraderLedToken> = {}): TraderLedToken {
  return {
    symbol: "TOK", buyers: ["a"], buyCount: 1, sellCount: 0, totalBuyUsd: 500,
    totalSellUsd: 0, theses: [], followerReach: 1000, firstBuyMcapUsd: 25_000,
    lastTradeMcapUsd: 40_000, firstBuyAt: null, onchain: null, ...over,
  };
}

test("rejects a line that is only price", () => {
  assert.ok(isPriceRestatement("$142m to $236m (1.7x) on $46m volume"));
  assert.ok(isPriceRestatement("12.7x to $6.0m"));
  assert.ok(isPriceRestatement("up 240% on the session with $46m traded"));
});

test("accepts price when a mechanism is named", () => {
  // Not a blanket ban on numbers: the move is worth citing once there is a
  // reason attached to it.
  assert.ok(!isPriceRestatement("revenue hit $1.5m a day and the token ran 1.7x"));
  assert.ok(!isPriceRestatement("burnt $900k of buybacks; supply down ~10%"));
});

test("ignores lines with no price at all", () => {
  assert.ok(!isPriceRestatement("traders framed it as day four of the first leg"));
});

test("blocks verbatim reproduction of a thesis", () => {
  const source = th({
    text: "stonkfun just posted their revenue for the day and bought back supply and burnt it",
  });
  const copied = checkCatalyst(
    "stonkfun just posted their revenue for the day and bought back supply and burnt it",
    [source],
  );

  assert.equal(copied.ok, false);
  assert.match(copied.reason!, /verbatim/);
});

test("allows a paraphrase of the same thesis", () => {
  const source = th({
    text: "stonkfun just posted their revenue for the day and bought back supply and burnt it",
  });
  const summary = checkCatalyst("the platform reported daily revenue and burnt the buyback", [source]);

  assert.equal(summary.ok, true, summary.reason);
});

test("evidence forbids price claims on an unverified token", () => {
  const ev = buildThesisEvidence(token({ onchain: null }));

  assert.match(ev, /UNVERIFIED/);
  assert.match(ev, /do not state any price/);
});

test("evidence flags a low-confidence on-chain match", () => {
  const ev = buildThesisEvidence(
    token({
      onchain: {
        poolAddress: "p", name: "TOK / SOL", fdvUsd: 400_000, liquidityUsd: 10_000,
        volume24hUsd: 5_000, priceUsd: 0.0004, createdAt: null, mcapRatio: 9.4, mcap: null,
      },
    }),
  );

  assert.match(ev, /LOW CONFIDENCE MATCH/);
});

test("evidence surfaces the ranked theses and tells the model to summarise", () => {
  const ev = buildThesisEvidence(
    token({
      theses: [
        th({ text: "revenue and burns keep compounding across the ecosystem", likes: 40 }),
        th({ text: "breh", author: "other" }),
      ],
    }),
  );

  assert.match(ev, /SUMMARISE, never quote/);
  assert.match(ev, /revenue and burns/);
  assert.ok(!/breh/.test(ev), "noise must not reach the model at all");
});

test("evidence says to write nothing when no thesis qualifies", () => {
  const ev = buildThesisEvidence(token({ theses: [th({ text: "breh" })] }));

  assert.match(ev, /none worth quoting/);
  assert.match(ev, /write no line/);
});

test("exempts short launch and peak markers", () => {
  // These anchor the day rather than pretending to explain it, and the style
  // guide explicitly wants them.
  assert.ok(!isPriceRestatement("launched at $471k"));
  assert.ok(!isPriceRestatement("peaked 15:00 at $3.2m"));
  assert.ok(!isPriceRestatement("topped at $2.4m"));
});

test("a marker that grows into an argument still needs a reason", () => {
  assert.ok(
    isPriceRestatement("peaked 24 min after launch, 3.1x to $1.4m on $16m volume and $80k liquidity"),
    "once it argues, it must explain",
  );
});

test("aggregate participation is not a reason on its own", () => {
  // Buyer and seller counts are on every terminal, so a line built from them
  // is still something the reader can see at a glance.
  assert.ok(isPriceRestatement("$142m to $236m (1.7x) on $46m volume, 16161 buyers vs 14067 sellers"));
});

test("a specific wallet fact is a reason", () => {
  // Per-wallet P&L needs data no chart carries.
  assert.ok(!isPriceRestatement("@someone bought early and banked $4k"));
  assert.ok(!isPriceRestatement("8 of 8 top wallets were bundlers, all underwater on $2.5m"));
});

test("a pairing stated as routing is a mechanism", () => {
  // Real dropped line: the pairing IS the catalyst, but the filter only knew
  // the word "paired" and not the way the model actually phrased it.
  assert.ok(!isPriceRestatement("hit $52m (2.8x), 60% of volume routed through the $STONK pool"));
  assert.ok(!isPriceRestatement("$2.1m to $49m (23.6x), paired with $MET at 23% of volume"));
});
