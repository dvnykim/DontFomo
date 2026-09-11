/**
 * Tests for the compliance boundary: nothing platform-sourced may reach the
 * committed archive. See DECISIONS.md.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { stripEphemeral } from "./persist.ts";
import { DEFAULT_FILTERS, SCHEMA_VERSION, type Snapshot, type Trader } from "./types.ts";

const populated: Trader = {
  wallet: "So1111111111111111111111111111111111111111",
  pnlUsd: 20_000,
  realizedPnlUsd: 4_000,
  volumeUsd: 300_000,
  trades: 33,
  tags: [],
  isBot: false,
  firstBuyAt: "2026-09-10T12:00:00.000Z",
  lastSellAt: "2026-09-10T15:00:00.000Z",
  handle: "someone",
  thesis: "runescape hats are the meta",
  thesisPostedAt: "2026-09-10T12:05:00.000Z",
  followers: 100_000,
};

function snap(traders: Trader[] | null): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    date: "2026-09-10",
    generatedAt: "2026-09-10T09:00:00.000Z",
    network: "solana",
    window: { from: "2026-09-09T09:00:00.000Z", to: "2026-09-10T09:00:00.000Z" },
    config: DEFAULT_FILTERS,
    stats: {
      poolsScanned: 1,
      afterDedupe: 1,
      afterFilters: 1,
      runnersKept: 1,
      tradersFetched: 1,
    },
    runners: [{ symbol: "CATE", traders } as any],
  };
}

test("strips every platform-sourced field", () => {
  const out = stripEphemeral(snap([populated]));
  const t = out.runners[0]!.traders![0]!;

  assert.equal(t.handle, null);
  assert.equal(t.thesis, null);
  assert.equal(t.thesisPostedAt, null);
  assert.equal(t.followers, null);
});

test("preserves on-chain fields, which are public", () => {
  const out = stripEphemeral(snap([populated]));
  const t = out.runners[0]!.traders![0]!;

  assert.equal(t.wallet, populated.wallet);
  assert.equal(t.pnlUsd, 20_000);
  assert.equal(t.realizedPnlUsd, 4_000);
  assert.equal(t.trades, 33);
  assert.equal(t.firstBuyAt, populated.firstBuyAt);
});

test("serialised output contains no platform-sourced content", () => {
  const json = JSON.stringify(stripEphemeral(snap([populated])));

  assert.ok(!json.includes("runescape"), "thesis text leaked into serialised snapshot");
  assert.ok(!json.includes("someone"), "handle leaked into serialised snapshot");
  // Match the field, not the bare number: config values like minFdvUsd (1000000)
  // contain "100000" as a substring and would false-positive.
  assert.ok(!/"followers":\s*\d/.test(json), "follower count leaked into serialised snapshot");
  assert.ok(/"followers":\s*null/.test(json), "followers field should be present but null");
});

test("does not mutate the in-memory snapshot the renderer uses", () => {
  const original = snap([populated]);
  stripEphemeral(original);

  assert.equal(
    original.runners[0]!.traders![0]!.thesis,
    "runescape hats are the meta",
    "stripping must be non-destructive — the renderer still needs the thesis",
  );
});

test("handles null traders without throwing", () => {
  const out = stripEphemeral(snap(null));
  assert.equal(out.runners[0]!.traders, null);
});
