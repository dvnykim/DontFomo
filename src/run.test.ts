/**
 * Which day a snapshot is about.
 *
 * This was wrong for the first three days and only surfaced by comparing our
 * output against a published recap for the same dates.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { describedDate } from "./run.ts";

test("labels a snapshot by the day its window covers, not the day it ran", () => {
  // The 09:00 UTC cron on Sep 12 collects Sep 11 08:00 -> Sep 12 08:00 UTC,
  // which is the September 11 US session. Labelling it by run date put every
  // file one day ahead of its own contents.
  assert.equal(describedDate("2026-09-11T07:56:50.212Z"), "2026-09-11");
  assert.equal(describedDate("2026-09-12T09:00:00.000Z"), "2026-09-12");
});

test("is stable across the UTC midnight boundary", () => {
  // A window starting at 23:00 still describes the day it started in: the US
  // session it covers runs on into the following UTC morning.
  assert.equal(describedDate("2026-09-11T23:30:00.000Z"), "2026-09-11");
  assert.equal(describedDate("2026-09-11T00:30:00.000Z"), "2026-09-11");
});
