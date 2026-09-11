/**
 * Automated catalyst + mood generation.
 *
 * The model is allowed to infer market narrative freely (that's the editorial
 * voice), but claims about identifiable people are constrained — see
 * DECISIONS.md. Two layers enforce this:
 *
 *   1. The system prompt states the boundary.
 *   2. `validateOutput` mechanically drops any line referencing an @handle or
 *      $ticker that isn't present in the evidence passed in. Prompts can be
 *      talked around; a post-hoc filter cannot.
 *
 * Everything generated is written with provenance (`model`, `generatedAt`,
 * `evidenceHash`) so a bad line is traceable and reproducible after the fact.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Runner, Snapshot } from "./types.ts";
import { usd } from "./format.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const PROMPTS_DIR = join(ROOT, "prompts");

/** Opus 4.8. Overridable, but note this output publishes unreviewed. */
const MODEL = process.env.DONTFOMO_MODEL ?? "claude-opus-4-8";

const TimelineEntry = z.object({
  time: z.string().describe("UTC HH:MM. Must correspond to an event in the evidence."),
  text: z.string().describe("One line. What happened and why it mattered."),
});

const CoinNarrative = z.object({
  symbol: z.string(),
  label: z.string().describe("Short editorial header, e.g. 'Runner Of The Day'."),
  timeline: z.array(TimelineEntry),
});

const DayNarrative = z.object({
  mood: z.string().describe("One line on how the day felt. Trader voice, lowercase ok."),
  coins: z.array(CoinNarrative),
});

export type GeneratedNarrative = z.infer<typeof DayNarrative>;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Reads an optional prompt file, returning "" when absent. */
async function readPrompt(name: string): Promise<string> {
  try {
    return await readFile(join(PROMPTS_DIR, name), "utf8");
  } catch {
    return "";
  }
}

/**
 * The evidence block. This is the ONLY ground truth the model gets — if a fact
 * isn't in here, any statement of it is by definition unsupported.
 */
function buildEvidence(snapshot: Snapshot): string {
  const lines: string[] = [`DATE: ${snapshot.date} (UTC)`, ""];

  for (const r of snapshot.runners) {
    const m = r.mcap;
    lines.push(`## $${r.symbol}`);
    lines.push(
      `market cap: ${m ? `${usd(m.low)} -> ${usd(m.high)} (${m.multiple}x), now ${usd(m.current)}` : "unknown"}`,
    );
    lines.push(`launched: ${r.createdAt ?? "unknown"}   peaked: ${m?.peakAt ?? "unknown"}`);
    lines.push(
      `liquidity ${usd(r.liquidityUsd)} | 24h volume ${usd(r.volume24hUsd)} | ` +
        `${r.txns24h.buyers} unique buyers vs ${r.txns24h.sellers} sellers`,
    );
    if (r.flags.length) lines.push(`quality flags: ${r.flags.join(", ")}`);

    if (r.traders === null) {
      lines.push("traders: not available");
    } else if (r.traders.length === 0) {
      lines.push("traders: none found");
    } else {
      lines.push(`traders (${r.bigWinners ?? 0} real winners, ${r.botTraders ?? 0} bots):`);
      for (const t of r.traders) {
        const who = t.handle ? `@${t.handle}` : t.wallet.slice(0, 8);
        const tag = t.isBot ? " [BOT]" : "";
        const followers = t.followers === null ? "" : ` ${t.followers} followers`;
        lines.push(
          `  - ${who}${tag}${followers}: P&L ${usd(t.pnlUsd)} ` +
            `(${usd(t.realizedPnlUsd)} realised), ${t.trades} trades`,
        );
        if (t.thesis) lines.push(`    thesis (verbatim, ${t.thesisPostedAt ?? "time unknown"}): "${t.thesis}"`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

const SYSTEM_RULES = `You write a daily memecoin recap. Voice: terse, trader-native, lowercase is fine.

WHAT YOU MAY INFER FREELY:
- Market narrative, metas, sentiment, why a sector moved
- Characterisation of price action ("hated rally", "higher for longer", "round-tripped")
- Connections between coins that ran together

WHAT YOU MAY NOT DO — these are hard limits, not style preferences:
- Never state that a named person or @handle did something unless it is in the evidence
- Never assert anyone's motive, intent, or wrongdoing. Not "he dumped on followers",
  not "this was a rug", not "the dev exited". You may report what the data shows
  (e.g. "8 of 8 top wallets were bundler bots") and let the reader conclude.
- Never invent a thesis, quote, or follower count. Verbatim theses only.
- Never name a person who does not appear in the evidence.

If there is no supported catalyst for a coin, return an empty timeline for it.
An empty timeline is correct and expected. Do not pad.

Every timeline entry must trace to something in the evidence: a launch time, a peak
time, a trade, or a verbatim thesis. Use the UTC times given.`;

/** Words used for verbatim-overlap detection. */
const VERBATIM_RUN = 8;

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Every VERBATIM_RUN-word sequence appearing in any thesis.
 *
 * notes/ is committed to a public repo. Permission covers reading fomo's content, not
 * archiving it — so a generated line that copies a thesis verbatim would re-create the
 * archive we agreed not to build, just laundered through the model. Paraphrase and
 * reference are fine; copying is not.
 */
function thesisShingles(snapshot: Snapshot): Set<string> {
  const shingles = new Set<string>();
  for (const r of snapshot.runners) {
    for (const t of r.traders ?? []) {
      if (!t.thesis) continue;
      const w = words(t.thesis);
      for (let i = 0; i + VERBATIM_RUN <= w.length; i++) {
        shingles.add(w.slice(i, i + VERBATIM_RUN).join(" "));
      }
    }
  }
  return shingles;
}

function copiesThesis(text: string, shingles: Set<string>): boolean {
  if (shingles.size === 0) return false;
  const w = words(text);
  for (let i = 0; i + VERBATIM_RUN <= w.length; i++) {
    if (shingles.has(w.slice(i, i + VERBATIM_RUN).join(" "))) return true;
  }
  return false;
}

/**
 * Every figure derivable from a runner, in the exact form the model would write it.
 *
 * Numeric hallucination is the highest-risk failure mode for a data product and the
 * handle/ticker filter doesn't catch it — a plausible-but-wrong market cap reads as
 * authoritative and is invisible without checking the source.
 */
function allowedNumbers(r: Runner): Set<string> {
  const ok = new Set<string>();

  const money = [
    r.mcap?.low,
    r.mcap?.high,
    r.mcap?.current,
    r.liquidityUsd,
    r.volume24hUsd,
    r.fdvUsd,
    ...(r.traders ?? []).flatMap((t) => [t.pnlUsd, t.realizedPnlUsd, t.volumeUsd]),
  ].filter((n): n is number => typeof n === "number");

  for (const m of money) ok.add(usd(m).toLowerCase());
  if (r.mcap) ok.add(`${r.mcap.multiple}x`);

  const counts = [
    r.txns24h.buyers,
    r.txns24h.sellers,
    r.txns24h.buys,
    r.txns24h.sells,
    r.botTraders ?? 0,
    r.bigWinners ?? 0,
    ...(r.traders ?? []).map((t) => t.trades),
  ];
  for (const c of counts) ok.add(String(Math.round(c)));

  return ok;
}

/**
 * Returns the first unsupported figure in `text`, or null.
 *
 * Only checks $amounts, Nx multiples, and integers of 3+ digits — small integers
 * ("8/8 bots", "2 entries") and clock times have too many legitimate forms to
 * validate without dropping correct lines.
 */
function unsupportedNumber(text: string, allowed: Set<string>): string | null {
  const lower = text.toLowerCase();

  for (const [, amount] of lower.matchAll(/(\$\d[\d.,]*\s?[kmb]?)/g)) {
    const norm = amount!.replace(/[\s,]/g, "");
    if (!allowed.has(norm)) return norm;
  }
  for (const [, mult] of lower.matchAll(/\b(\d+(?:\.\d+)?x)\b/g)) {
    if (!allowed.has(mult!)) return mult!;
  }
  // Strip clock times before scanning bare integers, or "15:00" yields "15"/"00".
  for (const [, int] of lower.replace(/\b\d{1,2}:\d{2}\b/g, " ").matchAll(/\b(\d{3,})\b/g)) {
    if (!allowed.has(int!)) return int!;
  }
  return null;
}

/** Handles and tickers that legitimately appear in the evidence. */
function allowedEntities(snapshot: Snapshot): { handles: Set<string>; tickers: Set<string> } {
  const handles = new Set<string>();
  const tickers = new Set<string>();

  for (const r of snapshot.runners) {
    tickers.add(r.symbol.toLowerCase());
    for (const t of r.traders ?? []) {
      if (t.handle) handles.add(t.handle.toLowerCase());
    }
  }
  return { handles, tickers };
}

export interface ValidationReport {
  kept: number;
  dropped: Array<{ symbol: string; text: string; reason: string }>;
}

/**
 * Mechanically strips any generated line that names an entity absent from the
 * evidence. This is the load-bearing guardrail — the prompt is advisory, this is not.
 */
export function validateOutput(
  narrative: GeneratedNarrative,
  snapshot: Snapshot,
): ValidationReport {
  const { handles, tickers } = allowedEntities(snapshot);
  const shingles = thesisShingles(snapshot);
  const report: ValidationReport = { kept: 0, dropped: [] };

  const bySymbol = new Map(snapshot.runners.map((r) => [r.symbol.toLowerCase(), r]));

  for (const coin of narrative.coins) {
    const runner = bySymbol.get(coin.symbol.toLowerCase());
    const numbers = runner ? allowedNumbers(runner) : null;

    coin.timeline = coin.timeline.filter((entry) => {
      const badNumber = numbers ? unsupportedNumber(entry.text, numbers) : null;
      if (badNumber) {
        report.dropped.push({
          symbol: coin.symbol,
          text: entry.text,
          reason: `unsupported figure ${badNumber}`,
        });
        return false;
      }

      // Checked first: a copied thesis is a licensing problem, not just a style one.
      if (copiesThesis(entry.text, shingles)) {
        report.dropped.push({
          symbol: coin.symbol,
          text: entry.text,
          reason: "reproduces thesis text verbatim",
        });
        return false;
      }

      const badHandle = [...entry.text.matchAll(/@([A-Za-z0-9_]{2,30})/g)]
        .map((m) => m[1]!.toLowerCase())
        .find((h) => !handles.has(h));
      if (badHandle) {
        report.dropped.push({
          symbol: coin.symbol,
          text: entry.text,
          reason: `unsupported handle @${badHandle}`,
        });
        return false;
      }

      const badTicker = [...entry.text.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,14})/g)]
        .map((m) => m[1]!.toLowerCase())
        .find((t) => !tickers.has(t));
      if (badTicker) {
        report.dropped.push({
          symbol: coin.symbol,
          text: entry.text,
          reason: `unsupported ticker $${badTicker}`,
        });
        return false;
      }

      report.kept++;
      return true;
    });
  }
  return report;
}

export interface GenerationResult {
  narrative: GeneratedNarrative;
  validation: ValidationReport;
  provenance: { model: string; generatedAt: string; evidenceSha256: string };
}

export async function generateNarrative(snapshot: Snapshot): Promise<GenerationResult | null> {
  if (!hasApiKey()) {
    console.log("  no ANTHROPIC_API_KEY — skipping narrative generation");
    return null;
  }
  if (snapshot.runners.length === 0) return null;

  const client = new Anthropic();
  const evidence = buildEvidence(snapshot);
  const style = await readPrompt("style.md");
  const examples = await readPrompt("examples.md");

  // Stable prefix first so it caches; volatile evidence goes in the user turn.
  // Note: Opus needs a ~4096-token prefix before caching engages at all.
  const system = [SYSTEM_RULES, style, examples].filter(Boolean).join("\n\n---\n\n");

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { format: zodOutputFormat(DayNarrative), effort: "high" },
    messages: [
      {
        role: "user",
        content:
          `Write today's recap from this evidence. Cover every coin listed.\n\n${evidence}`,
      },
    ],
  });

  const narrative = response.parsed_output;
  if (!narrative) {
    console.warn("  generation returned no parsed output");
    return null;
  }

  const validation = validateOutput(narrative, snapshot);

  return {
    narrative,
    validation,
    provenance: {
      model: MODEL,
      generatedAt: new Date().toISOString(),
      evidenceSha256: createHash("sha256").update(evidence).digest("hex").slice(0, 16),
    },
  };
}
