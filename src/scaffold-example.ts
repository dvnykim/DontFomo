/**
 * Turns a real day into a fillable example.
 *
 *   node --experimental-strip-types src/scaffold-example.ts 2026-09-11
 *
 * `prompts/examples.md` is the highest-leverage file in the repo — the model
 * imitates examples far more reliably than it follows rules — and it is also
 * the one nobody writes, because starting from a blank page means first
 * reconstructing what actually happened.
 *
 * This prints the structure with every FACT filled in from the snapshot and
 * every JUDGEMENT left blank. The facts are the tedious half and are already
 * known; the voice is the half that has to be human, and is the only reason
 * the file is worth having.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { groupRunners } from "./group.ts";
import { usd } from "./format.ts";
import type { Snapshot } from "./types.ts";

const ROOT = new URL("../", import.meta.url).pathname;

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error("usage: npm run scaffold-example -- <YYYY-MM-DD>");
    process.exit(1);
  }

  const snapshot = JSON.parse(
    await readFile(join(ROOT, "data", `${date}.json`), "utf8"),
  ) as Snapshot;

  const groups = groupRunners(snapshot.runners);
  const out: string[] = [];

  out.push(`# ${date}`, "");
  out.push("> **mood:** `<one line. what the whole day felt like.>`", "");

  for (const g of groups) {
    const why =
      g.kind === "pairing" && g.pairedWith
        ? `all trading against $${g.pairedWith}`
        : g.kind === "namesake"
          ? `named after: ${[...new Set(g.runners.map((r) => r.namesake?.name).filter(Boolean))].join(", ")}`
          : g.kind === "venue"
            ? "same launchpad"
            : g.kind === "fresh"
              ? "launched today"
              : "already trading";

    out.push(`## <title for this section>`);
    out.push(`key: \`${g.key}\`   <!-- ${why} -->`);
    out.push("");
    out.push("```");
    for (const r of g.runners) {
      const m = r.mcap;
      const cap = !m
        ? usd(r.fdvUsd)
        : m.multiple === null
          ? usd(m.high)
          : `${usd(m.high)} (${m.multiple}x)`;
      const hint =
        r.pairing
          ? `paired with $${r.pairing.symbol}`
          : r.namesake
            ? `named after ${r.namesake.name}`
            : r.tickerCopies > 0
              ? `${r.tickerCopies + 1} tokens shared this ticker`
              : "";
      out.push(`$${r.symbol} -> hit ${cap}, <${hint || "why — or delete this clause"}>`);
    }
    out.push("```", "");
  }

  out.push("<!--");
  out.push("  Every figure above is from the snapshot, so it is safe to keep.");
  out.push("  Delete any coin you would not have written about. A shorter example");
  out.push("  teaches restraint, which is the hardest thing to get from the model.");
  out.push("-->");

  console.log(out.join("\n"));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
