/**
 * Generates the day's narrative and writes it as notes/<date>.json — the same
 * file a human would hand-write, so the site renderer needs no changes.
 *
 *   npm run narrate            # latest snapshot
 *   npm run narrate -- --force # overwrite existing notes
 *
 * Refuses to clobber existing notes without --force, so a hand-written day is
 * never silently replaced by a generated one.
 */

import { mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { generateNarrative, hasApiKey, type ThesesBySymbol } from "./generate.ts";
import { loadTraderDays } from "./import-traders.ts";
import type { Snapshot } from "./types.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const DATA_DIR = join(ROOT, "data");
const NOTES_DIR = join(ROOT, "notes");

async function latestSnapshotDate(): Promise<string | null> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.at(-1)?.replace(/\.json$/, "") ?? null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const date = dateArg ?? (await latestSnapshotDate());

  if (!date) {
    console.error("No snapshots in data/. Run `npm run recap` first.");
    process.exit(1);
  }
  if (!hasApiKey()) {
    console.error("ANTHROPIC_API_KEY not set — add it to .env");
    process.exit(1);
  }

  const outPath = join(NOTES_DIR, `${date}.json`);
  if ((await exists(outPath)) && !force) {
    console.log(`notes/${date}.json already exists. Pass --force to overwrite.`);
    return;
  }

  const snapshot = JSON.parse(await readFile(join(DATA_DIR, `${date}.json`), "utf8")) as Snapshot;
  console.log(`Generating narrative for ${date} (${snapshot.runners.length} runners)...`);

  // Captured theses, if any. These are platform content: they reach the model
  // and the rendered page, and never the committed snapshot.
  const theses: ThesesBySymbol = new Map();
  const days = await loadTraderDays();

  // Match on ADDRESS where the capture has one. Six separate tokens used the
  // ticker "EMBER" in a single day, so a symbol match attaches one coin's
  // commentary to another's card — the most damaging kind of wrong, because it
  // reads perfectly.
  const byAddress = new Map<string, (typeof days)[number]>();
  for (const d of days) if (d.tokenAddress) byAddress.set(d.tokenAddress, d);

  let matchedByAddress = 0;
  for (const r of snapshot.runners) {
    const addr = r.baseTokenId.replace(/^solana_/, "");
    const day = byAddress.get(addr);
    if (!day) continue;
    matchedByAddress++;
    const key = r.symbol.trim().toLowerCase();
    theses.set(key, [...(theses.get(key) ?? []), ...day.theses]);
  }

  // Captures with no address (a trader profile rather than a token page) still
  // fall back to the symbol, which is all they carry.
  for (const d of days) {
    if (d.tokenAddress) continue;
    for (const t of d.theses) {
      const key = t.symbol.trim().toLowerCase();
      theses.set(key, [...(theses.get(key) ?? []), t]);
    }
  }

  if (days.length > 0) {
    console.log(
      `  ${days.length} capture(s) — ${matchedByAddress} matched to a runner by address, ` +
        `${theses.size} token(s) with theses`,
    );
  }

  const result = await generateNarrative(snapshot, theses);
  if (!result) {
    console.error("Generation produced nothing.");
    process.exit(1);
  }

  const { narrative, validation, provenance } = result;

  // Convert to the notes shape the renderer already consumes.
  // Section titles, keyed the same way the renderer groups. The clustering is
  // mechanical and recomputed at render time; only these names come from the model.
  const groups: Record<string, { title?: string; note?: string }> = {};
  for (const g of narrative.groups ?? []) {
    if (!g.title.trim()) continue;
    groups[g.key] = g.note?.trim() ? { title: g.title, note: g.note } : { title: g.title };
  }

  const coins: Record<string, { label?: string; timeline?: Array<{ time: string; text: string }> }> = {};
  for (const c of narrative.coins) {
    coins[c.symbol] = { label: c.label, timeline: c.timeline };
  }

  await mkdir(NOTES_DIR, { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      { _generated: provenance, mood: narrative.mood, groups, coins },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`\nmood: ${narrative.mood}`);
  for (const c of narrative.coins) {
    console.log(`  $${c.symbol}: ${c.timeline.length} entries${c.label ? `  [${c.label}]` : ""}`);
  }

  if (validation.dropped.length > 0) {
    console.log(`\n${validation.dropped.length} line(s) dropped by the guardrail:`);
    for (const d of validation.dropped) {
      console.log(`  $${d.symbol}: ${d.reason}`);
      console.log(`    "${d.text}"`);
    }
  } else {
    console.log(`\nguardrail: all ${validation.kept} lines supported by evidence`);
  }

  console.log(`\nwrote ${outPath}`);
}

// Guarded so importing this module does not run it. See run.ts.
if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error("\nnarration failed:", err.message);
    process.exit(1);
  });
}
