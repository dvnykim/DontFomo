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
  for (const day of days) {
    for (const t of day.theses) {
      const key = t.symbol.trim().toLowerCase();
      theses.set(key, [...(theses.get(key) ?? []), t]);
    }
  }
  if (days.length > 0) {
    const matched = snapshot.runners.filter((r) => theses.has(r.symbol.toLowerCase())).length;
    console.log(
      `  ${days.length} capture(s), ${theses.size} token(s) with theses, ` +
        `${matched} matching today's runners`,
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

main().catch((err) => {
  console.error("\nnarration failed:", err.message);
  process.exit(1);
});
