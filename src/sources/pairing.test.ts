/**
 * Pairing tests.
 *
 * Fixtures are real GeckoTerminal figures for KNOTS on 2026-09-11 — public
 * on-chain market data, so unlike the fomo fixtures there is no storage
 * concern. That day's recap described KNOTS as "paired with $stonk"; this is
 * the mechanism that derives the same fact without a model.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePairing, otherSide, type PoolVenue } from "./geckoterminal.ts";

/** KNOTS, as returned by /tokens/{addr}/pools. */
const KNOTS: PoolVenue[] = [
  { name: "STONK / KNOTS", volume24hUsd: 6_902_000 },
  { name: "KNOTS / SOL", volume24hUsd: 3_083_000 },
  { name: "STONK / KNOTS", volume24hUsd: 2_566_000 },
  { name: "KNOTS / LOOP", volume24hUsd: 2_077_000 },
  { name: "KNOTS / SOL", volume24hUsd: 1_133_000 },
  { name: "STONK / KNOTS", volume24hUsd: 321_000 },
  { name: "KNOTS / SOL", volume24hUsd: 101_000 },
  { name: "KNOTS / BABYKNOTS", volume24hUsd: 82_000 },
  { name: "STONK / KNOTS", volume24hUsd: 28_000 },
  { name: "KNOTS / USDC", volume24hUsd: 18_000 },
];

test("finds the token on either side of the pool name", () => {
  // KNOTS' biggest pool is named "STONK / KNOTS" — it is the quote, not the
  // base. A base-only match misses the most important pool the token has.
  assert.equal(otherSide("STONK / KNOTS", "KNOTS"), "STONK");
  assert.equal(otherSide("KNOTS / SOL", "KNOTS"), "SOL");
  assert.equal(otherSide("FOO / BAR", "KNOTS"), null);
});

test("derives the pairing that the recap would name", () => {
  const p = derivePairing(KNOTS, "KNOTS");

  assert.ok(p);
  assert.equal(p!.symbol, "STONK");
  assert.equal(p!.volumeUsd, 9_817_000, "must sum across every pool for the pair");
});

test("recognises when the pairing out-trades the pricing venues", () => {
  const p = derivePairing(KNOTS, "KNOTS")!;

  // $9.8m through STONK against $4.3m of SOL and USDC combined.
  assert.equal(p.dominant, true);
  assert.ok(p.share > 0.55 && p.share < 0.65, `share was ${p.share}`);
});

test("ignores pricing venues when picking the pairing", () => {
  const solOnly: PoolVenue[] = [
    { name: "RocketFrog / SOL", volume24hUsd: 14_951_000 },
    { name: "RocketFrog / USDC", volume24hUsd: 2_000 },
  ];

  assert.equal(derivePairing(solOnly, "RocketFrog"), null, "an ordinary launch has no pairing");
});

test("picks the largest narrative pairing, not merely the first", () => {
  const p = derivePairing(
    [
      { name: "TOK / SMALL", volume24hUsd: 50_000 },
      { name: "BIG / TOK", volume24hUsd: 900_000 },
      { name: "TOK / SOL", volume24hUsd: 100_000 },
    ],
    "TOK",
  )!;

  assert.equal(p.symbol, "BIG");
});

test("keeps the casing traders write", () => {
  const p = derivePairing([{ name: "STONK / KNOTS", volume24hUsd: 500_000 }], "KNOTS")!;
  assert.equal(p.symbol, "STONK", "not 'stonk'");
});

test("drops a dust pairing rather than dressing it up as a catalyst", () => {
  // Real figures: Nasduck/QQQx did $2k against $7.5m in Nasduck/SOL. The
  // Nasdaq reference is probably genuine, but attaching it to the day's move
  // would credit 0.03% of the volume for all of it.
  const p = derivePairing(
    [
      { name: "Nasduck / SOL", volume24hUsd: 7_529_000 },
      { name: "Nasduck / QQQx", volume24hUsd: 2_000 },
    ],
    "Nasduck",
  );

  assert.equal(p, null);
});

test("points the relationship at the smaller token", () => {
  // The same pools seen from both sides. KNOTS was launched against STONK;
  // saying "$STONK paired with $KNOTS" inverts the claim.
  const pools: PoolVenue[] = [
    { name: "STONK / KNOTS", volume24hUsd: 9_817_000 },
    { name: "KNOTS / SOL", volume24hUsd: 4_317_000 },
    { name: "KNOTS / LOOP", volume24hUsd: 2_077_000 },
  ];

  const fromKnots = derivePairing(pools, "KNOTS");
  assert.equal(fromKnots?.symbol, "STONK", "KNOTS depends on the pairing");

  // STONK trades far more elsewhere, so the same pool is a rounding error to it.
  const stonkPools: PoolVenue[] = [
    ...pools.map((p) => ({ ...p })),
    { name: "STONK / SOL", volume24hUsd: 120_000_000 },
  ];
  assert.equal(derivePairing(stonkPools, "STONK"), null, "the larger token is not 'paired with' the smaller");
});

test("keeps a material pairing that still trails the SOL venue", () => {
  const p = derivePairing(
    [
      { name: "TOK / SOL", volume24hUsd: 1_000_000 },
      { name: "BIG / TOK", volume24hUsd: 400_000 },
    ],
    "TOK",
  )!;

  assert.equal(p.symbol, "BIG");
  assert.equal(p.dominant, false, "material, but not the main venue");
});

test("returns null when there are no pools", () => {
  assert.equal(derivePairing([], "TOK"), null);
});
