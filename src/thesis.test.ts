/**
 * Thesis ranking tests. These encode the editorial judgment, so they assert on
 * ORDER, not just on arithmetic — which post wins is the opinion.
 *
 * Fixtures are invented, in the shape of real feed posts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreThesis, rankTheses } from "./thesis.ts";
import type { FomoThesis } from "./types.ts";

function th(over: Partial<FomoThesis> = {}): FomoThesis {
  return {
    symbol: "TOK",
    author: "someone",
    text: "a plain statement about the token",
    agoMinutes: 60,
    at: "2026-09-11T11:00:00.000Z",
    pnlUsd: null,
    changePct: null,
    likes: null,
    closed: false,
    ...over,
  };
}

test("a mechanism beats pure sentiment", () => {
  const mechanism = scoreThesis(th({ text: "revenue is printing and they burnt the buyback supply" }));
  const hype = scoreThesis(th({ text: "this thing is going to the moon lfg easy 100x" }));

  assert.ok(mechanism.score > hype.score, `${mechanism.score} should beat ${hype.score}`);
  assert.ok(hype.score < 0, "sentiment with no mechanism should be negative");
});

test("penalises posts too short to say anything", () => {
  const { score, reasons } = scoreThesis(th({ text: "breh" }));

  assert.ok(score < 0);
  assert.ok(reasons.some((r) => /too short/.test(r)));
});

test("a large position lifts a thin post, but does not top a substantive one", () => {
  // Deliberate: conviction is real signal, so a $1m holder saying little still
  // ranks. It just should not outrank someone explaining the actual mechanism.
  const whale = scoreThesis(th({ text: "nevermind.", pnlUsd: 1_170_044, likes: 24 }));
  const analyst = scoreThesis(
    th({
      text:
        "they posted revenue for the day, 1.5m and bought back 900k of supply and burnt it, " +
        "the launchpad is compounding and the community keeps growing",
      likes: 74,
    }),
  );

  assert.ok(whale.score > 0, "a big position is worth something");
  assert.ok(analyst.score > whale.score, "explaining the mechanism should win");
});

test("a thesis posted before the peak outranks the same words after", () => {
  const peakAt = "2026-09-11T12:00:00.000Z";
  const before = scoreThesis(th({ at: "2026-09-11T08:00:00.000Z" }), { peakAt });
  const after = scoreThesis(th({ at: "2026-09-11T16:00:00.000Z" }), { peakAt });

  assert.ok(before.score > after.score, "a call beats a victory lap");
});

test("concrete figures count as information", () => {
  const withFigures = scoreThesis(th({ text: "fees are printing over $1.5m a day and 10% of supply is burnt" }));
  const without = scoreThesis(th({ text: "fees are printing a lot and plenty of supply is burnt" }));

  assert.ok(withFigures.score > without.score);
});

test("caps any one author at two slots", () => {
  const prolific = Array.from({ length: 6 }, (_, i) =>
    th({ author: "loud", text: `revenue and burns keep growing, point number ${i}`, likes: 50 }),
  );
  const other = th({ author: "quiet", text: "buyback burnt supply again this week", likes: 1 });

  const ranked = rankTheses([...prolific, other], { limit: 5 });
  const byLoud = ranked.filter((r) => r.author === "loud").length;

  assert.equal(byLoud, 2, "one poster must not own the recap");
  assert.ok(ranked.some((r) => r.author === "quiet"));
});

test("every score explains itself", () => {
  const { reasons } = scoreThesis(th({ text: "revenue is up and supply burnt", likes: 10, pnlUsd: 5_000 }));

  assert.ok(reasons.length >= 3, "an editorial filter you cannot inspect is one you cannot tune");
  assert.ok(reasons.some((r) => /mechanism/.test(r)));
  assert.ok(reasons.some((r) => /likes/.test(r)));
  assert.ok(reasons.some((r) => /at stake/.test(r)));
});

test("respects the minimum score", () => {
  const kept = rankTheses([th({ text: "breh" }), th({ text: "revenue and burns are compounding" })], {
    minScore: 1,
  });

  assert.equal(kept.length, 1, "noise should not reach the page at all");
});
