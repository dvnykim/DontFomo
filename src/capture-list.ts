/**
 * Which fomo pages to capture, in the order that helps most.
 *
 *   npm run capture-list
 *
 * The pipeline already knows every runner's mint address, and fomo token pages
 * are addressable — fomo.family/tokens/solana/<mint> — so there is no searching
 * and no guessing which "$EMBER" is meant. Six separate tokens used that ticker
 * in one day; an address is unambiguous where a symbol is not.
 *
 * Ordered by need rather than by size. A coin that already has a pairing or a
 * namesake has something to lead with; a coin with nothing is where a thesis
 * changes the page from "it ran" to "here is why". Capturing four of those beats
 * capturing the ten biggest.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { usd } from "./format.ts";
import type { Snapshot, Runner } from "./types.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const DATA_DIR = join(ROOT, "data");

const fomoUrl = (r: Runner): string =>
  `https://fomo.family/tokens/solana/${r.baseTokenId.replace(/^solana_/, "")}`;

/** What we can already say about a coin without any thesis. */
function existingCatalyst(r: Runner): string | null {
  if (r.pairing) return `paired with $${r.pairing.symbol}`;
  if (r.namesake) return `named after ${r.namesake.name}`;
  if (r.description) return "has a project description";
  return null;
}

async function main() {
  const date =
    process.argv[2] ??
    (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json")).sort().at(-1)?.slice(0, -5);

  if (!date) {
    console.error("No snapshots in data/. Run `npm run recap` first.");
    process.exit(1);
  }

  const snapshot = JSON.parse(
    await readFile(join(DATA_DIR, `${date}.json`), "utf8"),
  ) as Snapshot;

  const byNeed = [...snapshot.runners].sort((a, b) => {
    const need = (r: Runner) => (existingCatalyst(r) ? 1 : 0);
    return need(a) - need(b) || (b.mcap?.high ?? b.fdvUsd) - (a.mcap?.high ?? a.fdvUsd);
  });

  const blind = byNeed.filter((r) => !existingCatalyst(r));

  console.log(`\n${date} — ${snapshot.runners.length} runners\n`);
  console.log(
    `${blind.length} have no catalyst at all. Capturing those first is where a\n` +
      `thesis changes the page most.\n`,
  );

  for (const [i, r] of byNeed.entries()) {
    const cap = r.mcap ? usd(r.mcap.high) : usd(r.fdvUsd);
    const known = existingCatalyst(r);
    const mark = known ? "  " : "->";
    console.log(`${mark} ${String(i + 1).padStart(2)}. $${r.symbol.padEnd(13)} ${cap.padStart(8)}  ${known ?? "NO CATALYST"}`);
    console.log(`      ${fomoUrl(r)}`);
  }

  console.log(
    `\nFor each: open the page, click the Thesis tab, click the bookmarklet,\n` +
      `then \`npm run grab\`. Captures are keyed by address, so the symbol\n` +
      `collisions do not matter.`,
  );
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
