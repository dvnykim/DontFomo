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

/**
 * Token pages title themselves "$659.1M MC | PONS | fomo". On those pages every
 * thesis is about that token and no per-row symbol is rendered, so the title is
 * the only place the symbol appears.
 */
function detectTokenSymbol(raw: string): string | null {
  for (const line of raw.split("\n").slice(0, 6)) {
    const m = line.match(/\|\s*([A-Za-z0-9_+.]{2,15})\s*\|\s*fomo\s*$/i);
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

  const tokenSymbol = detectTokenSymbol(raw);
  const name = explicit ?? detectHandle(raw) ?? tokenSymbol;
  if (!name) {
    console.error(
      "Could not identify this page.\n" +
        "Expected a trader profile (@handle) or a token page (symbol in the title).\n" +
        "You can force it: npm run grab -- <name>",
    );
    process.exit(1);
  }

  // On a token page every thesis is about that one token and no per-row symbol
  // is rendered, so without a default they all parse to nothing. Fall back to
  // the name given on the command line before giving up.
  const defaultSymbol = tokenSymbol ?? (explicit && !detectHandle(raw) ? explicit : null);

  // Parse before writing so a useless capture never lands on disk.
  const parsed = parseProfile(raw, new Date().toISOString(), defaultSymbol);

  // The failure this guards against: Cmd+A on fomo returns the page chrome --
  // nav, footer, your own balances -- and none of the virtualised feed. It
  // looks like a successful 5kB capture and contains no data at all. Writing it
  // would leave a file that parses to nothing and a recap that quietly has no
  // theses in it.
  const empty = parsed.trades.length === 0 && parsed.theses.length === 0;
  if (empty) {
    const looksLikeSelectAll = !raw.startsWith("FOMO-EXPORT");
    console.error(
      `Captured ${(raw.length / 1024).toFixed(1)} kB but found no trades and no theses — not saving.\n` +
        (looksLikeSelectAll
          ? "\nThis looks like a Cmd+A copy. That does not work on fomo: the feed is a\n" +
            "virtualised scroll container the selection API skips, so you get the nav\n" +
            "and footer and nothing else.\n\n" +
            "Use the bookmarklet instead — see tools/capture.js.\n"
          : "\nThe bookmarklet ran but the feed was empty. Open the Thesis tab on a token\n" +
            "page, or scroll a profile until swaps render, then capture again.\n"),
    );
    process.exit(1);
  }

  await mkdir(INPUT_DIR, { recursive: true });
  const out = path.join(INPUT_DIR, `${name}.txt`);
  await writeFile(out, raw, "utf8");

  console.log(`Saved input/${name}.txt  (${(raw.length / 1024).toFixed(0)} kB)`);
  console.log(
    `  ${parsed.trades.length} trades   ${parsed.theses.length} theses   ` +
      `${parsed.positions.length} positions   ` +
      `${parsed.followers?.toLocaleString() ?? "?"} followers`,
  );

  for (const w of parsed.parseWarnings) console.log(`  ! ${w}`);

  console.log(`\n  Run \`npm run traders\` once you've captured everything.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
