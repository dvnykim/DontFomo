/**
 * Builds the static site from the most recent snapshot.
 *
 *   node --experimental-strip-types src/site/build.ts [YYYY-MM-DD]
 *
 * Human context is read from notes/<date>.json if present. That file is written
 * by hand — the catalyst behind a run is off-chain and can't be derived from
 * price data, so it is deliberately never generated.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPage, type DayNotes } from "./render.ts";
import type { Snapshot } from "../types.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const DATA_DIR = join(ROOT, "data");
const NOTES_DIR = join(ROOT, "notes");
const OUT_DIR = join(ROOT, "site");

async function allSnapshotDates(): Promise<string[]> {
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => f.replace(/\.json$/, ""));
}

async function readNotes(date: string): Promise<DayNotes> {
  try {
    return JSON.parse(await readFile(join(NOTES_DIR, `${date}.json`), "utf8")) as DayNotes;
  } catch {
    return {}; // No notes yet: the page renders prompts where the take belongs.
  }
}

async function main() {
  const dates = await allSnapshotDates();
  if (dates.length === 0) {
    console.error("No snapshots in data/. Run `npm run recap` first.");
    process.exit(1);
  }

  // One page per day, plus index.html for the newest. The archive is the thing
  // that compounds — a point-in-time record of what looked hot, which cannot be
  // reconstructed after the fact — so every day gets a durable URL.
  const only = process.argv[2];
  const targets = only ? dates.filter((d) => d === only) : dates;
  if (targets.length === 0) {
    console.error(`No snapshot for ${only}.`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const newest = dates.at(-1)!;

  for (const date of targets) {
    const snapshot = JSON.parse(
      await readFile(join(DATA_DIR, `${date}.json`), "utf8"),
    ) as Snapshot;
    const notes = await readNotes(date);
    const html = renderPage(snapshot, notes, dates);

    await writeFile(join(OUT_DIR, `${date}.html`), html, "utf8");
    if (date === newest) await writeFile(join(OUT_DIR, "index.html"), html, "utf8");

    const noted = Object.keys(notes.coins ?? {}).length;
    console.log(
      `  ${date}.html · ${snapshot.runners.length} runners · ` +
        `${noted} with written context${notes.mood ? " · mood set" : ""}` +
        (date === newest ? "  (also index.html)" : ""),
    );
  }

  console.log(`\nBuilt ${targets.length} page${targets.length === 1 ? "" : "s"} in ${OUT_DIR}`);
}

// Guarded so importing this module does not run it. See run.ts.
if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error("site build failed:", err.message);
    process.exit(1);
  });
}
