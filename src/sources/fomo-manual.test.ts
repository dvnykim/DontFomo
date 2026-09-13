/**
 * Parser tests.
 *
 * COMPLIANCE NOTE: every fixture below is invented. Handles, tokens and thesis
 * text are fabricated to mimic the *shape* of a real export without containing
 * any of it. A committed test file holding real thesis text would re-create the
 * archive we agreed not to build — the same leak `validateOutput` blocks in
 * generated notes, just through a different door.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfile, parseAgo, parseCompact, parseUsd } from "./fomo-manual.ts";

const EXPORTED_AT = "2026-09-11T12:00:00.000Z";

/** Mimics the line-per-cell shape of the rendered profile page. */
const PAGE = [
  "someone ⚘",
  "@testtrader",
  "1",
  "Mutuals",
  "152",
  "Following",
  "15,815",
  "Followers",
  "Share",
  "Following",
  "",
  "turned pocket change into rent money",
  "",
  "1d 5h avg. hold",
  "4.9K trades",
  "Joined Dec 2025",
  // --- feed: a thesis with an open position ---
  "testtrader",
  "Thesis",
  "3m",
  "faketoken",
  "$1,807.80",
  "(",
  "▲",
  "72.64%",
  ")",
  "invented thesis text about a made up coin",
  "1",
  // --- feed: a closed thesis, and a missing-image placeholder before the symbol ---
  "testtrader",
  "Thesis",
  "Closed",
  "14m",
  "?",
  "othercoin",
  "▼",
  "19.03%",
  "a second invented thesis, this one closed",
  "2",
  // --- positions ---
  "RAYFAKE",
  "5.3M RAYFAKE",
  "$62,501.07",
  "▲",
  "725.71%",
  // --- the swaps table ---
  "All swaps",
  "Token",
  "Action",
  "Amount",
  "MCap",
  "Time",
  "faketoken",
  "Buy",
  "$99.05",
  "$25.1K MC",
  "1m",
  "othercoin",
  "Sell",
  "$2,426.20",
  "$119.6K MC",
  "9m",
  "thirdcoin",
  "Buy",
  "$1,498.50",
  "$200K MC",
  "2h",
].join("\n");

test("parses the profile header", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  assert.equal(d.handle, "testtrader");
  assert.equal(d.followers, 15_815);
  assert.equal(d.following, 152);
  assert.equal(d.tradeCount, 4_900);
  assert.equal(d.avgHold, "1d 5h");
});

test("parses trades from the swaps table", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  assert.equal(d.trades.length, 3);

  const [first] = d.trades;
  assert.equal(first!.symbol, "faketoken");
  assert.equal(first!.action, "buy");
  assert.equal(first!.amountUsd, 99.05);
  assert.equal(first!.mcapUsd, 25_100);
  assert.equal(first!.agoMinutes, 1);
});

test("resolves relative ages into absolute timestamps", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  const twoHoursAgo = d.trades.find((t) => t.symbol === "thirdcoin")!;

  assert.equal(twoHoursAgo.agoMinutes, 120);
  assert.equal(twoHoursAgo.at, "2026-09-11T10:00:00.000Z");
});

test("parses theses including the closed flag", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  assert.equal(d.theses.length, 2);

  const open = d.theses.find((t) => t.symbol === "faketoken")!;
  assert.equal(open.text, "invented thesis text about a made up coin");
  assert.equal(open.pnlUsd, 1807.8);
  assert.equal(open.changePct, 72.64);
  assert.equal(open.closed, false);
  assert.equal(open.at, "2026-09-11T11:57:00.000Z");

  const closed = d.theses.find((t) => t.symbol === "othercoin")!;
  assert.equal(closed.closed, true, "Closed marker must be detected");
  assert.equal(closed.text, "a second invented thesis, this one closed");
});

test("skips the missing-image placeholder before a symbol", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  assert.ok(
    d.theses.every((t) => t.symbol !== "?"),
    "'?' is a broken image, not a ticker",
  );
});

test("parses open positions", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  const pos = d.positions.find((p) => p.symbol === "RAYFAKE");

  assert.ok(pos, "position with repeated symbol on the quantity line");
  assert.equal(pos!.valueUsd, 62_501.07);
  assert.equal(pos!.changePct, 725.71);
});

test("never mistakes UI chrome for a ticker", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  const symbols = [
    ...d.trades.map((t) => t.symbol),
    ...d.theses.map((t) => t.symbol),
    ...d.positions.map((p) => p.symbol),
  ].map((s) => s.toLowerCase());

  for (const junk of ["token", "action", "amount", "mcap", "time", "all swaps", "followers"]) {
    assert.ok(!symbols.includes(junk), `"${junk}" is layout, not a token`);
  }
});

test("warns loudly when the layout yields nothing", () => {
  const d = parseProfile("some unrelated page\nwith no trades", EXPORTED_AT);

  assert.equal(d.trades.length, 0);
  assert.ok(
    d.parseWarnings.some((w) => /0 trades/.test(w)),
    "a layout change must surface, not silently produce an empty day",
  );
  assert.ok(d.parseWarnings.some((w) => /@handle/.test(w)));
});

test("rejects an invalid exportedAt", () => {
  // Every age on the page is relative, so without a valid anchor no trade can
  // be placed on a timeline. Failing loudly beats inventing "now".
  assert.throws(() => parseProfile(PAGE, "not-a-date"), /valid ISO timestamp/);
});

test("unit helpers handle the formats fomo actually renders", () => {
  assert.equal(parseUsd("$1,807.80"), 1807.8);
  assert.equal(parseUsd("nope"), null);

  assert.equal(parseCompact("$25.2K"), 25_200);
  assert.equal(parseCompact("$10.6M"), 10_600_000);
  assert.equal(parseCompact("15,815"), 15_815);
  assert.equal(parseCompact("4.9K"), 4_900);

  assert.equal(parseAgo("17m"), 17);
  assert.equal(parseAgo("2h"), 120);
  assert.equal(parseAgo("1d 5h"), 1740);
  assert.equal(parseAgo("30s"), 1);
  assert.equal(parseAgo("tomorrow"), null);
});

test("never reads a figure as a ticker", () => {
  // "3.58%" became its own coin in the recap — a percentage rendered as a
  // token, with theses attached to it.
  const page = [
    "someone", "Thesis", "12m", "3.58%", "$1,200.00", "a thesis about the real token", "4",
  ].join("\n");

  const d = parseProfile(page, EXPORTED_AT, "REAL");

  assert.equal(d.theses.length, 1);
  assert.equal(d.theses[0]!.symbol, "REAL", "falls back to the page's token");
});

test("still reads a genuine per-row symbol on a profile page", () => {
  const page = ["someone", "Thesis", "12m", "faketoken", "$1,200.00", "why faketoken", "4"].join("\n");
  const d = parseProfile(page, EXPORTED_AT, null);

  assert.equal(d.theses[0]!.symbol, "faketoken");
});

test("records the mint address from the capture's own URL", () => {
  // Symbols collide — six tokens used "EMBER" in one day — so the join has to
  // be on the address, and the capture already carries it in its URL line.
  const page = [
    "FOMO-EXPORT",
    "$26.0M MC | FLYBRAIN | fomo",
    "https://fomo.family/tokens/solana/GThRMoMhW973m8ki1wxwSjKfCWbZ5z8TSPDZ52NgtrSN",
    "",
    "someone", "Thesis", "12m", "$1,200.00", "why this token", "4",
  ].join("\n");

  const d = parseProfile(page, EXPORTED_AT, "FLYBRAIN");
  assert.equal(d.tokenAddress, "GThRMoMhW973m8ki1wxwSjKfCWbZ5z8TSPDZ52NgtrSN");
});

test("has no address when the capture is a trader profile", () => {
  const d = parseProfile(PAGE, EXPORTED_AT);
  assert.equal(d.tokenAddress, null, "a profile is about a person, not a token");
});
