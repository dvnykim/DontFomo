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
import { enrichWithMarketCap, enrichWithTraders, enrichWithPairings } from "./enrich.ts";
import { usd } from "./format.ts";
import { stripEphemeral } from "./persist.ts";
import { DEFAULT_FILTERS, SCHEMA_VERSION, type Snapshot } from "./types.ts";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const NETWORK = "solana";

function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}


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
  const date = utcDate();
  const outPath = join(DATA_DIR, `${date}.json`);

  if ((await exists(outPath)) && !force) {
    console.log(`Snapshot for ${date} already exists. Pass --force to overwrite.`);
    return;
  }

  console.log(`DontFomo — building snapshot for ${date} (${NETWORK})`);
  console.log("Fetching candidate pools (~70s, keyless rate limit)...");

  const raw = await fetchCandidatePools(NETWORK);
  const deduped = dedupeByBaseToken(raw);
  const { runners, stats } = selectRunners(deduped, DEFAULT_FILTERS);

  // Fixed bounds so the day timeline has a stable axis, and so trader timestamps
  // can be validated against the window they're meant to describe.
  const now = new Date();
  const window = {
    from: new Date(now.getTime() - 24 * 3_600_000).toISOString(),
    to: now.toISOString(),
  };

  let tradersFetched: number | null = null;

  if (runners.length > 0) {
    console.log(`\nFetching market-cap ranges for ${runners.length} runners...`);
    await enrichWithMarketCap(runners, NETWORK);
    rescoreByMarketCap(runners, DEFAULT_FILTERS);

    // What each token is paired against. Mechanically derivable, and the most
    // common catalyst format in the recaps this is modelled on.
    console.log("\nresolving pairings...");
    await enrichWithPairings(runners, NETWORK);

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

main().catch((err) => {
  console.error("\npipeline failed:", err.message);
  process.exit(1);
});
