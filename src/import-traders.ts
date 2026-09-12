/**
 * Manual trader import.
 *
 *   1. Open a fomo profile, select all, copy.
 *   2. Save as input/<handle>.txt
 *   3. npm run traders
 *
 * `input/` is gitignored. Platform content is read, used, and dropped — it must
 * never reach the committed archive. See the ephemeral-data policy in
 * DECISIONS.md.
 *
 * The export timestamp comes from each file's mtime. Every age on a fomo page
 * is relative ("17m"), so an anchor is mandatory — and the moment you saved the
 * paste is exactly that anchor, which beats making you type one.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseProfile } from "./sources/fomo-manual.ts";
import { buildTraderLedTokens, isDistribution } from "./traders.ts";
import { rankTheses } from "./thesis.ts";
import { enrichTraderLedTokens } from "./enrich-traders.ts";
import type { TraderDay } from "./types.ts";

const INPUT_DIR = path.join(import.meta.dirname, "..", "input");

function usd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export async function loadTraderDays(dir = INPUT_DIR): Promise<TraderDay[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".txt"));
  } catch {
    return [];
  }

  const days: TraderDay[] = [];
  for (const file of files.sort()) {
    const full = path.join(dir, file);
    const [raw, info] = await Promise.all([readFile(full, "utf8"), stat(full)]);
    if (!raw.trim()) continue;

    // The filename carries the symbol for a token-page capture, where no
    // per-row symbol is rendered. Without it the theses parse to nothing:
    // a real capture of 31 dropped to 3, silently, because only the handful
    // that happened to name a symbol survived.
    const fromName = file.replace(/\.txt$/, "");
    days.push(parseProfile(raw, info.mtime.toISOString(), fromName));
  }
  return days;
}

async function main() {
  const days = await loadTraderDays();

  if (days.length === 0) {
    console.log(
      `No exports found in input/\n\n` +
        `  1. open a fomo profile, select all, copy\n` +
        `  2. save it as input/<handle>.txt\n` +
        `  3. run this again\n`,
    );
    return;
  }

  console.log(`Parsed ${days.length} profile${days.length === 1 ? "" : "s"}\n`);

  let unusable = 0;
  for (const d of days) {
    const reach = d.followers === null ? "?" : d.followers.toLocaleString();
    console.log(
      `  @${d.handle.padEnd(16)} ${String(d.trades.length).padStart(3)} trades  ` +
        `${String(d.theses.length).padStart(2)} theses  ${reach.padStart(8)} followers`,
    );
    for (const w of d.parseWarnings) console.log(`      ! ${w}`);
    // A token-page capture legitimately has theses and no trades — the swaps
    // table is a different tab. Only a capture with NEITHER is unusable.
    if (d.trades.length === 0 && d.theses.length === 0) unusable++;
  }

  if (unusable === days.length) {
    console.log(
      `\nEvery export parsed nothing at all. That usually means the page layout\n` +
        `changed, or the capture missed the feed. Open the Thesis tab on a token\n` +
        `page, or scroll a profile until the swaps table renders, then capture again.`,
    );
    process.exitCode = 1;
    return;
  }

  const tokens = buildTraderLedTokens(days);

  // Resolution is rate-limited (~2 keyless calls per token at 7s each), so it
  // is opt-in. Without it the recap knows what was bought but not what happened.
  if (process.argv.includes("--onchain")) {
    console.log(`\nResolving ${tokens.length} tickers on-chain (~${Math.ceil(tokens.length * 14 / 60)} min)...\n`);
    const report = await enrichTraderLedTokens(tokens);
    console.log(
      `\n  ${report.resolved}/${tokens.length} resolved` +
        (report.unresolved.length ? `, unverified: ${report.unresolved.join(", ")}` : "") +
        (report.lowConfidence.length ? `\n  low confidence (>3x off reported cap): ${report.lowConfidence.join(", ")}` : ""),
    );
  }

  console.log(`\n${tokens.length} tokens, ranked by independent buyers:\n`);

  for (const [i, t] of tokens.entries()) {
    const entry = t.firstBuyMcapUsd === null ? "" : ` from ${usd(t.firstBuyMcapUsd)}`;
    const tag = isDistribution(t) ? "  [distributing]" : "";
    const chain =
      t.onchain === null
        ? ""
        : t.onchain.mcap
          ? `  -> ${usd(t.onchain.mcap.high)} peak` +
            (t.onchain.mcap.multiple != null ? ` (${t.onchain.mcap.multiple.toFixed(1)}x)` : "")
          : `  -> ${usd(t.onchain.fdvUsd)} now`;
    console.log(
      `${String(i + 1).padStart(2)}. $${t.symbol.padEnd(14)} ` +
        `${t.buyers.length} buyer${t.buyers.length === 1 ? " " : "s"}  ` +
        `${usd(t.totalBuyUsd).padStart(8)} in${entry}${chain}${tag}`,
    );
    if (t.buyers.length > 0) console.log(`     ${t.buyers.map((b) => "@" + b).join(", ")}`);

    // Ranked, not dumped. A token feed is mostly noise; printing all of it
    // hides the handful of posts that actually say why anyone bought.
    const top = rankTheses(t.theses, { limit: 5, minScore: 1 });
    for (const th of top) {
      const who = th.author ? `@${th.author}` : "?";
      console.log(`     [${String(th.scored.score).padStart(5)}] ${who}: ${th.text.slice(0, 88)}${th.text.length > 88 ? "…" : ""}`);
    }
    if (t.theses.length > top.length) {
      console.log(`     (${t.theses.length - top.length} more below the bar)`);
    }
    console.log("");
  }

  const withThesis = tokens.filter((t) => t.theses.length > 0).length;
  console.log(
    `${withThesis}/${tokens.length} tokens have a written thesis — those are the ones\n` +
      `that can carry a catalyst line. The rest are activity without explanation.`,
  );
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
