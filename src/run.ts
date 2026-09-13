/**
 * Daily pipeline entrypoint.
 *
 *   node --experimental-strip-types src/run.ts
 *
 * Writes data/<UTC-date>.json. Snapshots are append-only: a given day is written
 * once and never revised, because the whole point of the archive is an honest
 * point-in-time record of what looked hot that day.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fetchCandidatePools, dedupeByBaseToken } from "./sources/geckoterminal.ts";
import { selectRunners, rescoreByMarketCap, rankByBigWinners } from "./discover.ts";
import {
  enrichWithMarketCap,
  enrichWithTraders,
  enrichWithPairings,
  enrichWithDescriptions,
} from "./enrich.ts";
import { usd } from "./format.ts";
import { stripEphemeral } from "./persist.ts";
import { DEFAULT_FILTERS, SCHEMA_VERSION, type Snapshot } from "./types.ts";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const NETWORK = "solana";

function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Which day a snapshot describes.
 *
 * The window is the 24 hours BEFORE the run, so the run date is not the date of
 * the day being reported. Labelling by run date put every snapshot one day
 * ahead of its own contents — verified against a published recap: our file
 * dated 2026-09-11 shared six coins with that author's September 10 edition and
 * exactly one with September 12.
 *
 * It is not a UTC-midnight question either. Memecoin activity is US-centric, so
 * the day runs roughly 13:00 UTC to 08:00 UTC the following morning. A window
 * [D 08:00, D+1 08:00] contains day D's session, so the label is the date the
 * window STARTS — which is what the 09:00 UTC cron produces.
 *
 * Caught at three days old. At three hundred it would have been unfixable,
 * because nobody renames an archive they have been publishing from.
 */
export const describedDate = (windowFrom: string): string => windowFrom.slice(0, 10);


async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes("--force");

  // The window has to exist before the date does — the label is derived from it.
  const now = new Date();
  const window = {
    from: new Date(now.getTime() - 24 * 3_600_000).toISOString(),
    to: now.toISOString(),
  };
  const date = describedDate(window.from);
  const outPath = join(DATA_DIR, `${date}.json`);

  if ((await exists(outPath)) && !force) {
    console.log(`Snapshot for ${date} already exists. Pass --force to overwrite.`);
    return;
  }

  console.log(`DontFomo — building snapshot for ${date} (${NETWORK})`);
  console.log("Fetching candidate pools (~70s, keyless rate limit)...");

  const raw = await fetchCandidatePools(NETWORK);
  const deduped = dedupeByBaseToken(raw, DEFAULT_FILTERS.allowedQuoteSymbols);
  const { runners, stats } = selectRunners(deduped, DEFAULT_FILTERS);

  let tradersFetched: number | null = null;

  if (runners.length > 0) {
    console.log(`\nFetching market-cap ranges for ${runners.length} runners...`);
    await enrichWithMarketCap(runners, NETWORK);
    rescoreByMarketCap(runners, DEFAULT_FILTERS);

    // What each token is paired against. Mechanically derivable, and the most
    // common catalyst format in the recaps this is modelled on.
    console.log("\nresolving pairings...");
    await enrichWithPairings(runners, NETWORK);

    // Only for coins with no pairing and no namesake — fills the catalyst gap
    // rather than paying for a lookup we would not use.
    console.log("\nlooking up project descriptions...");
    await enrichWithDescriptions(runners, NETWORK);

    console.log(`\nFetching trader data...`);
    tradersFetched = await enrichWithTraders(runners, DEFAULT_FILTERS, window);
    rankByBigWinners(runners);
  }

  const snapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    date,
    generatedAt: now.toISOString(),
    network: NETWORK,
    window,
    config: DEFAULT_FILTERS,
    stats: {
      poolsScanned: raw.length,
      afterDedupe: deduped.length,
      afterFilters: stats.afterFilters,
      runnersKept: runners.length,
      tradersFetched,
    },
    runners,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(outPath, JSON.stringify(stripEphemeral(snapshot), null, 2) + "\n", "utf8");

  console.log(
    `\nscanned ${snapshot.stats.poolsScanned} -> deduped ${snapshot.stats.afterDedupe} ` +
      `-> passed filters ${snapshot.stats.afterFilters} -> kept ${snapshot.stats.runnersKept}`,
  );

  // Which threshold actually did the cutting. Coverage is the difference
  // between a recap and a top-10, and tuning it blind is guesswork.
  const rejected = Object.entries(stats.rejections).sort((a, b) => b[1] - a[1]);
  if (rejected.length > 0) {
    console.log("  rejected by: " + rejected.map(([why, n]) => `${why} ${n}`).join(", "));
  }

  if (runners.length === 0) {
    console.log("\nNo runners cleared the filters today. Thresholds may need loosening.");
  } else {
    console.log("");
    for (const [i, r] of runners.entries()) {
      const flags = r.flags.length ? `  [${r.flags.join(", ")}]` : "";
      // Mirrors the recap format traders read: "$boner -> $8m to $80m (10x)"
      const move = r.mcap
        ? `${usd(r.mcap.low)} to ${usd(r.mcap.high)} (${r.mcap.multiple}x)`.padEnd(28)
        : "mcap unavailable".padEnd(28);
      console.log(
        `${String(i + 1).padStart(2)}. $${r.symbol.padEnd(12)} ${move} ` +
          `now ${usd(r.mcap?.current ?? r.fdvUsd).padEnd(8)} ` +
          `liq ${usd(r.liquidityUsd).padEnd(8)} score ${r.score.toFixed(1)}${flags}`,
      );
    }
  }

  console.log(`\nwrote ${outPath}`);
}

// Only run the pipeline when invoked directly. Importing this module — a test
// importing describedDate, say — must not execute a 15-minute network job.
// render.ts hit this once already via a shared formatter, which is why `usd`
// lives in format.ts; the same trap is worth closing at every entrypoint.
if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error("\npipeline failed:", err.message);
    process.exit(1);
  });
}
