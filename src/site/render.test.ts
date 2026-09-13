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
    pairing: null, namesake: null, description: null, tickerCopies: 0,
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

test("every section states why its coins are together", () => {
  // The basis line is the point: a reader can check the grouping instead of
  // taking an editorial header on trust. Two group kinds shipped without one.
  const named = (sym: string, name: string) =>
    runner({ symbol: sym, baseTokenId: sym, namesake: { kind: "stock", name }, dex: "pumpswap" });

  const html = renderPage(
    snapshot([named("TSLA", "Tesla"), named("AAPL", "Apple"), named("AMZN", "Amazon")]),
  );

  const titles = [...html.matchAll(/group-title">([^<]+)</g)].length;
  const bases = [...html.matchAll(/group-basis">/g)].length;

  assert.ok(titles > 0);
  assert.equal(bases, titles, "a title without a basis is an assertion the reader cannot check");
  assert.match(html, /named after real things/);
  assert.match(html, /Tesla/);
});

test("does not double the $ on a ticker that already has one", () => {
  // Some tokens are literally named "$1", which rendered as "$$1".
  const html = renderPage(
    snapshot([runner({ symbol: "$1", baseTokenId: "d1", namesake: { kind: "ai", name: "Claude" } })]),
  );

  assert.ok(!html.includes("$$1"), "reads as a bug rather than a name");
  assert.match(html, /\$1/);
});

// ------------------------------------------------------------ trader density

function wallet(over: Partial<import("../types.ts").Trader> = {}) {
  return {
    wallet: "So11111111111111111111111111111111111111" + Math.random().toString(36).slice(2, 4),
    pnlUsd: 100, realizedPnlUsd: 100, volumeUsd: 1000, trades: 10,
    tags: [], isBot: false, firstBuyAt: null, lastSellAt: null,
    handle: null, thesis: null, thesisPostedAt: null, followers: null,
    ...over,
  };
}

test("always shows a wallet that cleared the bar, whatever the cap", () => {
  // The cap governs the tail, never the signal. A winner buried behind a
  // disclosure triangle defeats the point of the page.
  const traders = [
    ...Array.from({ length: 7 }, () => wallet({ isBot: true, pnlUsd: 50_000 })),
    wallet({ pnlUsd: 12_000, realizedPnlUsd: 12_000 }),
  ];
  const html = renderPage(snapshot([runner({ traders, bigWinners: 1, botTraders: 7 })]));

  // Anchor on the trader block, not on "<details" — renderCatalysts uses one too.
  const block = html.slice(html.indexOf('<ul class="trader-list">'));
  const beforeCollapse = block.slice(0, block.indexOf("more-traders"));
  assert.match(beforeCollapse, /\+\$12k/, "the winner is above the fold");
});

test("collapses the tail and says what it is", () => {
  const traders = Array.from({ length: 8 }, () => wallet({ isBot: true, tags: ["bundler"] }));
  // Needs a reason to render as a card at all; a coin with nothing to say is
  // deliberately one line and shows no traders.
  const html = renderPage(
    snapshot([runner({ traders, bigWinners: 0, botTraders: 8, namesake: { kind: "ai", name: "Claude" } })]),
  );

  assert.match(html, /<details class="more-traders">/);
  assert.match(html, /more sampled wallets, all automated/, "a hidden row still has to say what it is");
});

test("does not collapse anything when there is little to hide", () => {
  const traders = [wallet(), wallet({ isBot: true })];
  const html = renderPage(
    snapshot([runner({ traders, bigWinners: 0, botTraders: 1, namesake: { kind: "ai", name: "Claude" } })]),
  );

  // Anchor on the element, not the class name — the stylesheet mentions it too.
  assert.ok(!html.includes('<details class="more-traders">'), "two wallets need no disclosure");
});

test("a coin where someone made money earns a card, not a row", () => {
  // The most interesting fact this product can report was being demoted to a
  // one-line row when the coin had no catalyst, pairing or namesake.
  const html = renderPage(
    snapshot([
      runner({
        symbol: "QUIET",
        traders: [wallet({ pnlUsd: 40_000, realizedPnlUsd: 40_000 })],
        bigWinners: 1,
        botTraders: 0,
      }),
    ]),
  );

  assert.match(html, /<article class="card/);
  assert.ok(!/class="crow"/.test(html));
});

test("every timeline link has a target, even for odd tickers", () => {
  // Symbols include "+", "$1" and emoji, so the anchor has to be derived
  // rather than assumed. A broken link is worse than no link.
  const odd = ["+", "$1", "🧲", "Ember", "EMBER"];
  const html = renderPage(
    snapshot(odd.map((sym, i) => runner({ symbol: sym, baseTokenId: `t${i}`, namesake: { kind: "ai", name: "X" } }))),
  );

  const hrefs = [...html.matchAll(/class="tl-name" href="#([^"]+)"/g)].map((m) => m[1]!);
  const ids = [...html.matchAll(/id="(coin-[^"]*)"/g)].map((m) => m[1]!);

  assert.ok(hrefs.length > 0, "the timeline should link");
  for (const h of hrefs) assert.ok(ids.includes(h), `no target for #${h}`);
});

test("shows what a project says it is, and earns a card for it", () => {
  // The largest remaining catalyst gap: the reference recaps explain a coin by
  // what it DOES, which price cannot contain.
  const html = renderPage(
    snapshot([
      runner({
        symbol: "EMBER",
        description: "Launch a Solana token on Meteora, paired with SOL, USDC or tokenized stocks.",
      }),
    ]),
  );

  assert.match(html, /class="describes"/);
  assert.match(html, /Launch a Solana token on Meteora/);
  assert.match(html, /<article class="card/, "a description is enough to earn a card");
});
