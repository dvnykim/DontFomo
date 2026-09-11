/**
 * Clipboard capture for manual exports.
 *
 *   1. Open a fomo profile, Cmd+A, Cmd+C
 *   2. npm run grab
 *
 * Reads the clipboard, works out whose profile it is, saves it to
 * input/<handle>.txt and immediately reports what parsed. The feedback loop is
 * the point: a bad paste should be obvious in two seconds, not discovered later
 * when the recap comes out empty.
 *
 * input/ is gitignored. Platform content is read, used and dropped.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { parseProfile } from "./sources/fomo-manual.ts";

const run = promisify(execFile);
const INPUT_DIR = path.join(import.meta.dirname, "..", "input");

async function readClipboard(): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("grab uses pbpaste (macOS). Save the paste to input/<handle>.txt by hand instead.");
  }
  const { stdout } = await run("pbpaste", [], { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

/** The page always renders the profile's own @handle near the top. */
function detectHandle(raw: string): string | null {
  for (const line of raw.split("\n").slice(0, 80)) {
    const m = line.trim().match(/^@([A-Za-z0-9_]+)$/);
    if (m) return m[1]!;
  }
  return null;
}

async function main() {
  const explicit = process.argv[2]?.replace(/^@/, "");
  const raw = await readClipboard();

  if (!raw.trim()) {
    console.error("Clipboard is empty. Open a profile, Cmd+A, Cmd+C, then run this again.");
    process.exit(1);
  }

  const handle = explicit ?? detectHandle(raw);
  if (!handle) {
    console.error(
      "Could not find an @handle in the clipboard.\n" +
        "Either the copy missed the top of the page, or this isn't a profile.\n" +
        "You can force it: npm run grab -- <handle>",
    );
    process.exit(1);
  }

  // Parse before writing so a useless paste never lands on disk.
  const parsed = parseProfile(raw, new Date().toISOString());

  await mkdir(INPUT_DIR, { recursive: true });
  const out = path.join(INPUT_DIR, `${handle}.txt`);
  await writeFile(out, raw, "utf8");

  console.log(`Saved input/${handle}.txt  (${(raw.length / 1024).toFixed(0)} kB)`);
  console.log(
    `  ${parsed.trades.length} trades   ${parsed.theses.length} theses   ` +
      `${parsed.positions.length} positions   ` +
      `${parsed.followers?.toLocaleString() ?? "?"} followers`,
  );

  for (const w of parsed.parseWarnings) console.log(`  ! ${w}`);

  if (parsed.trades.length === 0) {
    console.log(
      `\n  No trades parsed. The "All swaps" table is usually below the fold —\n` +
        `  scroll to the bottom of the profile before Cmd+A so it renders.`,
    );
  } else {
    console.log(`\n  Run \`npm run traders\` once you've grabbed everyone.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
