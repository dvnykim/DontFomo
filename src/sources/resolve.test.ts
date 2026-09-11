/**
 * Symbol-resolution tests.
 *
 * Fixtures use real figures observed from GeckoTerminal's public API. That is
 * on-chain market data, not platform content, so unlike the fomo fixtures it
 * carries no storage concern.
 *
 * The ONYC case is the reason this module exists: a $310m established token and
 * a $47k microcap share a ticker, and a trader bought the microcap.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { selectBestPool, type PoolCandidate } from "./geckoterminal.ts";

function pool(over: Partial<PoolCandidate> = {}): PoolCandidate {
  return {
    poolAddress: "pool1",
    name: "ONYC / SOL",
    baseSymbol: "ONYC",
    fdvUsd: 47_000,
    liquidityUsd: 10_000,
    volume24hUsd: 50_000,
    priceUsd: 0.00004,
    createdAt: null,
    ...over,
  };
}

test("rejects a ticker squatter far from the reported market cap", () => {
  const got = selectBestPool(
    [
      pool({ poolAddress: "big", name: "ONYC / USDC", fdvUsd: 310_016_000, liquidityUsd: 6_966_000 }),
      pool({ poolAddress: "real", fdvUsd: 47_000, liquidityUsd: 400 }),
    ],
    "ONYC",
    31_100,
  );

  assert.equal(got?.poolAddress, "real", "must not pick the $310m namesake on liquidity alone");
  assert.ok(got!.mcapRatio! < 2);
});

test("returns null when nothing is near the reported market cap", () => {
  const got = selectBestPool([pool({ fdvUsd: 310_016_000 })], "ONYC", 31_100);

  assert.equal(got, null, "a wrong token is worse than an unresolved one");
});

test("breaks ties on liquidity, since matched pools include dead shells", () => {
  const got = selectBestPool(
    [
      pool({ poolAddress: "shell", fdvUsd: 10_272_500, liquidityUsd: 0 }),
      pool({ poolAddress: "live", fdvUsd: 11_735_100, liquidityUsd: 54_000 }),
    ],
    "ONYC",
    10_600_000,
  );

  assert.equal(got?.poolAddress, "live", "both plausible; the tradeable one wins");
});

test("requires an exact ticker", () => {
  const got = selectBestPool(
    [pool({ name: "DELULU / SOL", baseSymbol: "DELULU", fdvUsd: 25_000 })],
    "delusional",
    25_100,
  );

  assert.equal(got, null, "fuzzy ticker matching invents tokens");
});

test("matches tickers case-insensitively", () => {
  const got = selectBestPool(
    [pool({ name: "Delusional / SOL", baseSymbol: "Delusional", fdvUsd: 15_900 })],
    "delusional",
    25_100,
  );

  assert.ok(got, "casing varies between fomo and the pool name");
});

test("falls back to the deepest pool when no market cap is known", () => {
  const got = selectBestPool(
    [
      pool({ poolAddress: "thin", liquidityUsd: 100 }),
      pool({ poolAddress: "deep", liquidityUsd: 90_000 }),
    ],
    "ONYC",
    null,
  );

  assert.equal(got?.poolAddress, "deep");
  assert.equal(got?.mcapRatio, null, "no hint means no confidence figure");
});

test("ignores candidates with no market cap when a hint exists", () => {
  const got = selectBestPool(
    [
      pool({ poolAddress: "unpriced", fdvUsd: 0, liquidityUsd: 999_999 }),
      pool({ poolAddress: "priced", fdvUsd: 47_000, liquidityUsd: 10 }),
    ],
    "ONYC",
    31_100,
  );

  assert.equal(got?.poolAddress, "priced", "an unpriced pool cannot be verified as the right one");
});

test("returns null for an unknown ticker", () => {
  assert.equal(selectBestPool([], "GHOST", 1000), null);
});
