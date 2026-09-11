/**
 * Namesake tests. The rule that matters is the one about NOT matching:
 * inventing a narrative from a resemblance is the failure this codebase exists
 * to avoid.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectNamesake, namesakeGroupTitle } from "./namesake.ts";

test("recognises stock tickers, AI products and brands", () => {
  assert.deepEqual(detectNamesake("TSLA"), { kind: "stock", name: "Tesla" });
  assert.deepEqual(detectNamesake("Claude"), { kind: "ai", name: "Claude" });
  assert.deepEqual(detectNamesake("SPCX"), { kind: "brand", name: "SpaceX" });
});

test("is case and $-prefix insensitive", () => {
  assert.equal(detectNamesake("$tsla")?.name, "Tesla");
  assert.equal(detectNamesake("DeepSeekAI")?.name, "DeepSeek");
});

test("matches exactly and never approximately", () => {
  // "Claiming a coin is the Tesla play because its ticker resembles TSLA"
  // invents a catalyst, which is worse than having none.
  assert.equal(detectNamesake("TSLAX"), null);
  assert.equal(detectNamesake("APPL"), null);
  assert.equal(detectNamesake("NVIDIAI"), null);
});

test("returns null for ordinary tickers", () => {
  for (const s of ["EMBER", "STONK", "KNOTS", "RocketFrog", "fone", "+", "MCAT", "IOPN"]) {
    assert.equal(detectNamesake(s), null, `${s} should not match`);
  }
});

test("handles empty input", () => {
  assert.equal(detectNamesake(""), null);
  assert.equal(detectNamesake("$"), null);
});

test("titles pluralise on group size", () => {
  assert.match(namesakeGroupTitle("stock", 4), /Cosplay/);
  assert.match(namesakeGroupTitle("stock", 1), /Wearing/);
});
