/**
 * Renderer tests.
 *
 * The security one matters most: token symbols and pool names come from
 * on-chain data, which anyone can write. A token can be deployed with a name
 * containing markup, and this page is public.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, type DayNotes } from "./render.ts";
import { DEFAULT_FILTERS, SCHEMA_VERSION, type Snapshot, type Runner } from "../types.ts";

function runner(over: Partial<Runner> = {}): Runner {
  return {
    symbol: "TOK", poolAddress: "p", name: "TOK / SOL", dex: "pumpswap",
    baseTokenId: "t", quoteTokenId: "sol", createdAt: "2026-09-11T06:00:00.000Z",
    priceUsd: 1, fdvUsd: 2_000_000, liquidityUsd: 100_000, volume24hUsd: 5_000_000,
    change: { m5: 0, h1: 0, h6: 0, h24: 200 },
    txns24h: { buys: 100, sells: 50, buyers: 2000, sellers: 40 },
    sources: ["volume"], ageDays: 0.4, churn: 10, buyerSellerRatio: 50,
    buysPerBuyer: 1, sellsPerSeller: 1, score: 50, flags: [],
    mcap: { low: 500_000, high: 2_000_000, current: 1_800_000, multiple: 4, peakAt: "2026-09-11T15:00:00.000Z" },
    pairing: null, namesake: null, tickerCopies: 0,
    traders: null, bigWinners: null, botTraders: null, ...over,
  };
}

function snapshot(runners: Runner[]): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION, date: "2026-09-11",
    generatedAt: "2026-09-11T09:00:00.000Z", network: "solana",
    window: { from: "2026-09-10T09:00:00.000Z", to: "2026-09-11T09:00:00.000Z" },
    config: DEFAULT_FILTERS,
    stats: { poolsScanned: 220, afterDedupe: 178, afterFilters: 81, runnersKept: runners.length, tradersFetched: null },
    runners,
  };
}

test("escapes markup coming from on-chain names", () => {
  // Anyone can deploy a token called anything. This page is public.
  const html = renderPage(
    snapshot([runner({ symbol: `<img src=x onerror="alert(1)">` })]),
  );

  assert.ok(!html.includes("<img src=x"), "raw markup must never reach the page");
  assert.ok(html.includes("&lt;img"), "it should appear escaped instead");
});

test("escapes markup in a pairing symbol", () => {
  const html = renderPage(
    snapshot([
      runner({ pairing: { symbol: "<script>x</script>", volumeUsd: 5e6, share: 0.5, dominant: true } }),
    ]),
  );

  assert.ok(!html.includes("<script>x</script>"));
});

test("renders a section per narrative group", () => {
  const html = renderPage(
    snapshot([
      runner({ symbol: "A", pairing: { symbol: "STONK", volumeUsd: 5e6, share: 0.6, dominant: true } }),
      runner({ symbol: "B", pairing: { symbol: "STONK", volumeUsd: 4e6, share: 0.5, dominant: true } }),
    ]),
  );

  assert.match(html, /class="group-title">Paired With \$STONK/);
  assert.match(html, /2 coins trading against \$STONK/, "the basis must be stated, not just the title");
});

test("uses an editorial title when one is supplied", () => {
  const notes: DayNotes = { groups: { "pair:stonk": { title: "Rotate Back To Stonk" } } };
  const html = renderPage(
    snapshot([
      runner({ symbol: "A", pairing: { symbol: "STONK", volumeUsd: 5e6, share: 0.6, dominant: true } }),
      runner({ symbol: "B", pairing: { symbol: "STONK", volumeUsd: 4e6, share: 0.5, dominant: true } }),
    ]),
    notes,
  );

  assert.match(html, /Rotate Back To Stonk/);
});

test("shows the pairing on the card", () => {
  const html = renderPage(
    snapshot([runner({ pairing: { symbol: "STONK", volumeUsd: 5e6, share: 0.6, dominant: true } })]),
  );

  assert.match(html, /paired with <strong>\$STONK/);
});

test("shows what a coin is named after", () => {
  const html = renderPage(snapshot([runner({ namesake: { kind: "stock", name: "Tesla" } })]));
  assert.match(html, /named after <strong>Tesla/);
});

test("says depth is unreported rather than showing zero", () => {
  // Needs a namesake so it renders as a full card — a compact row has no footer.
  const html = renderPage(
    snapshot([runner({ liquidityUsd: 0, namesake: { kind: "ai", name: "Claude" } })]),
  );

  assert.match(html, /depth not reported/);
  assert.ok(!/liq \$0\b/.test(html), "$0 would read as a fact rather than a gap");
});

test("gives a coin with nothing to say a single row", () => {
  const html = renderPage(snapshot([runner({ symbol: "QUIET" })]));

  assert.match(html, /class="crow"/);
  assert.ok(!/class="card/.test(html), "no catalyst, no pairing, no namesake — one line");
});

test("warns when several tokens share a ticker", () => {
  const html = renderPage(snapshot([runner({ symbol: "EMBER", tickerCopies: 2 })]));
  assert.match(html, /3 same ticker|3 tokens named/);
});

test("never states a winner count without disclosing the sample", () => {
  const html = renderPage(
    snapshot([runner({ traders: [], bigWinners: 0, botTraders: 0 })]),
  );

  assert.ok(!/\b0 traders over\b/.test(html), "a bare count reads as a population fact");
});

test("renders an empty day without throwing", () => {
  const html = renderPage(snapshot([]));
  assert.match(html, /Nothing cleared the filters/);
});

test("a flag on nearly every coin moves to the page, not each card", () => {
  // A warning printed on 22 of 24 cards has no discriminating power left; it
  // just trains the reader to ignore badges.
  const many = Array.from({ length: 6 }, (_, i) =>
    runner({ symbol: `T${i}`, baseTokenId: `t${i}`, flags: ["bot-driven-selling"], namesake: { kind: "ai", name: "Claude" } }),
  );
  const html = renderPage(snapshot(many));

  const badges = html.match(/class="flag[^"]*">[^<]*bot/gi) ?? [];
  assert.equal(badges.length, 0, "not repeated on every card");
  assert.match(html, /applied to\s+most coins today/, "stated once instead");
});

test("a flag on a minority stays on its card", () => {
  const runners = [
    runner({ symbol: "A", baseTokenId: "a", flags: ["fading"], namesake: { kind: "ai", name: "Claude" } }),
    ...Array.from({ length: 5 }, (_, i) =>
      runner({ symbol: `B${i}`, baseTokenId: `b${i}`, namesake: { kind: "ai", name: "Claude" } }),
    ),
  ];
  const html = renderPage(snapshot(runners));

  assert.match(html, /class="flag/, "a discriminating flag is still worth showing");
});

test("never prints a multiple for a launch", () => {
  // The intraday low of a fresh launch is its first print, so a ratio off it
  // measures the mint. One live run produced 37,282x, then 3,158x after a first
  // attempt to clean it up — which is why the number is null rather than fixed.
  const html = renderPage(
    snapshot([
      runner({
        ageDays: 0.3,
        namesake: { kind: "stock", name: "Tesla" },
        mcap: { low: 8_000, high: 293_000_000, current: 81_000_000, multiple: null, peakAt: null },
      }),
    ]),
  );

  assert.ok(!/nullx/.test(html), "an unguarded template would print this");
  assert.ok(!/\d+x<\/div>/.test(html), "and no multiple at all");
  assert.match(html, /hit \$293m|293m/, "the peak is still the headline");
});

test("still prints a multiple for an established coin", () => {
  const html = renderPage(
    snapshot([
      runner({
        ageDays: 40,
        namesake: { kind: "ai", name: "Claude" },
        mcap: { low: 35_000_000, high: 70_000_000, current: 60_000_000, multiple: 2, peakAt: null },
      }),
    ]),
  );

  assert.match(html, /2x/);
});
