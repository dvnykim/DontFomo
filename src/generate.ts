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
import type { FilterConfig, Runner, Snapshot } from "./types.ts";
import { usd } from "./format.ts";
import { hasReportedLiquidity } from "./types.ts";
import { groupRunners } from "./group.ts";
import { isPriceRestatement } from "./catalyst.ts";
import { rankTheses } from "./thesis.ts";
import type { FomoThesis } from "./types.ts";

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

const GroupTitle = z.object({
  key: z.string().describe("The group key exactly as given in the evidence, e.g. 'pair:stonk'."),
  title: z
    .string()
    .describe(
      "Editorial section header, 2-5 words, e.g. 'Rotate Back To Stonk'. Name the THEME, " +
        "not the mechanism — never 'Paired With $X' when you can say what the rotation was.",
    ),
  note: z
    .string()
    .optional()
    .describe("Optional single line of context for the section. Omit if there is nothing to add."),
});

const DayNarrative = z.object({
  mood: z.string().describe("One line on how the day felt. Trader voice, lowercase ok."),
  groups: z.array(GroupTitle).describe("A title for each group key in the evidence."),
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
/**
 * Theses keyed by token symbol.
 *
 * Passed alongside the snapshot rather than attached to it, and deliberately so:
 * Runner is archived to data/, and platform content must never reach the archive.
 * Keeping theses off the Snapshot type means they cannot be serialised there by
 * accident — the same reasoning as the fomo layer in types.ts.
 */
export type ThesesBySymbol = Map<string, FomoThesis[]>;

function buildEvidence(snapshot: Snapshot, theses: ThesesBySymbol = new Map()): string {
  const lines: string[] = [`DATE: ${snapshot.date} (UTC)`, ""];

  // Sections are decided mechanically before the model sees anything, so it
  // names groups rather than inventing them. A model asked to both cluster and
  // label will cheerfully cluster to fit a label it likes.
  const groups = groupRunners(snapshot.runners);
  if (groups.length > 0) {
    lines.push("SECTIONS (title each one by its key):");
    for (const g of groups) {
      const members = g.runners.map((r) => "$" + r.symbol).join(", ");
      const why =
        g.kind === "pairing" && g.pairedWith
          ? `all trading against $${g.pairedWith}`
          : g.kind === "fresh"
            ? "launched today, no shared pairing"
            : "already trading, no shared pairing";
      lines.push(`  ${g.key}  [${why}]  ${members}`);
    }
    lines.push("");
  }

  for (const r of snapshot.runners) {
    const m = r.mcap;
    lines.push(`## $${r.symbol}`);
    lines.push(
      // A launch is reported as "hit $X" with no multiple: its intraday low is
      // the first print, so a ratio off it measures the mint. Established coins
      // get the full range. This is also exactly how the reference recaps write
      // the two cases, so it shapes the output as well as constraining it.
      `market cap: ${
        !m
          ? "unknown"
          : m.multiple === null
            ? `hit ${usd(m.high)}, now ${usd(m.current)} (launched today — NO multiple exists for this coin, do not compute one)`
            : `${usd(m.low)} -> ${usd(m.high)} (${m.multiple}x), now ${usd(m.current)}`
      }`,
    );
    lines.push(`launched: ${r.createdAt ?? "unknown"}   peaked: ${m?.peakAt ?? "unknown"}`);
    lines.push(
      // "liquidity $0" invites the model to report a missing field as a fact,
      // and it did: "on $67m volume against a $0 liquidity book". Depth is not
      // reported for most pools on this network; saying so is the honest input.
      `liquidity ${
        hasReportedLiquidity(r.liquidityUsd)
          ? usd(r.liquidityUsd)
          : "NOT REPORTED (unknown, not zero — never describe it as $0 or as thin)"
      } | 24h volume ${usd(r.volume24hUsd)} | ` +
        `${r.txns24h.buyers} unique buyers vs ${r.txns24h.sellers} sellers`,
    );
    if (r.flags.length) lines.push(`quality flags: ${r.flags.join(", ")}`);

    if (r.namesake) {
      lines.push(
        `  NAMED AFTER ${r.namesake.name} (${r.namesake.kind}). The naming is often the ` +
          `whole reason it exists — worth a line when there is nothing better.`,
      );
    }
    if (r.description) {
      lines.push(
        `  THE PROJECT DESCRIBES ITSELF AS: "${r.description}"` +
          ` — this is its own marketing copy, so attribute it ("bills itself as", ` +
          `"a launchpad, per its own listing") rather than asserting it.`,
      );
    }
    if (r.tickerCopies > 0) {
      lines.push(
        `  ${r.tickerCopies + 1} separate tokens used this exact ticker today; this is the deepest.`,
      );
    }

    // Theses: the only source that says WHY in the trader's own words. Ranked
    // before the model sees them so noise never reaches it, and marked SUMMARISE
    // because reproducing them verbatim would rebuild an archive we agreed not
    // to keep.
    const forCoin = theses.get(r.symbol.toLowerCase()) ?? [];
    if (forCoin.length > 0) {
      const top = rankTheses(forCoin, { peakAt: r.mcap?.peakAt ?? null, limit: 4, minScore: 1 });
      if (top.length > 0) {
        lines.push(`  THESES — traders explaining why. SUMMARISE, never quote:`);
        for (const t of top) {
          const who = t.author ? `@${t.author}` : "unattributed";
          const stake = t.pnlUsd !== null ? `, $${Math.round(t.pnlUsd).toLocaleString()} position` : "";
          lines.push(`    - ${who}${stake}: ${t.text}`);
        }
      }
    }

    // The pairing is usually the catalyst on a launchpad coin, and unlike price
    // it explains something. Put it in front of the model explicitly.
    if (r.pairing) {
      lines.push(
        `  PAIRED WITH $${r.pairing.symbol} — $${(r.pairing.volumeUsd / 1e6).toFixed(1)}m, ` +
          `${Math.round(r.pairing.share * 100)}% of its volume` +
          (r.pairing.dominant ? ", more than its SOL and stablecoin pools combined" : "") +
          `. This is usually WHY it moved — lead with it.`,
      );
    }

    if (r.traders === null) {
      lines.push("traders: not available");
    } else if (r.traders.length === 0) {
      lines.push("traders: none found");
    } else {
      // Framed as a sample on purpose. These wallets are the highest-VOLUME
      // ones, capped around 8, out of thousands of buyers. Presenting the count
      // as a population fact produced the false line "only two real winners
      // cleared here" on a token where one trader alone made $1.17m.
      lines.push(
        `traders — SAMPLE of the ${r.traders.length} highest-volume wallets only, ` +
          `NOT all holders (${r.txns24h.buyers} wallets bought today). ` +
          `${r.bigWinners ?? 0}/${r.traders.length} sampled cleared the bar, ${r.botTraders ?? 0} were bots:`,
      );
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

STRUCTURE
The page is already grouped. You are given section keys and their coins; name each
section by its key. You do not decide who belongs with whom.
A section title names the THEME in 2-5 words ("Rotate Back To Stonk"), not the
mechanism — the mechanism is printed underneath it already.

WHAT YOU MAY INFER FREELY:
- Market narrative, metas, sentiment, why a sector moved
- Characterisation of price action ("hated rally", "higher for longer", "round-tripped")
- Connections between coins that ran together

HARD LIMITS — these are enforced by filters, not preferences. A line that breaks one
is deleted, so writing it wastes the slot:

1. A catalyst explains WHY. Never restate price. "$142m to $236m (1.7x) on $46m volume"
   is a caption for a chart the reader is already looking at. Lead with the pairing, the
   thesis mechanism, or the namesake. Short launch/peak markers are fine.
2. SUMMARISE theses, never quote them. Reproducing 8+ consecutive words from a thesis
   is blocked — we may read this content, not archive it. Paraphrase the mechanism.
3. Never say how many people made money. Trader data is a SAMPLE of ~8 wallets out of
   thousands of buyers. Write "2 of 8 sampled cleared $10k", never "2 real winners" and
   never "nobody made money".
4. Never claim anything about another day. You are given one snapshot; "same as
   yesterday" is unsupported by construction.
5. Never write an @handle at all. Describe a trader by what they did — "the top
   realised wallet banked $186k in 83 trades" — not by who they are. The archive is
   public and we may read platform content, not store it.
6. Never assert motive, intent, or wrongdoing. Not "he dumped on followers", not "this
   was a rug". Report what the data shows and let the reader conclude.
7. Every figure must appear in the evidence for that coin, including figures quoted
   inside a thesis. Do not compute new ones.

If there is no supported catalyst for a coin, return an empty timeline for it. It will
render as a single line saying what it hit. That is correct and expected — do not pad.
A thin day is a thin page, and padding one is the fastest way to lose a reader.`;

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
/**
 * Every thesis the model could have seen, as word runs.
 *
 * MUST cover both sources. Theses reach generation two ways — attached to a
 * trader on the snapshot, and passed separately in ThesesBySymbol — and reading
 * only the first would leave the second able to be reproduced verbatim into
 * notes/, which is committed. That is precisely the laundering path this check
 * exists to close: paraphrase is fine, copying rebuilds an archive we agreed
 * not to keep.
 */
function thesisShingles(snapshot: Snapshot, extra: ThesesBySymbol = new Map()): Set<string> {
  const shingles = new Set<string>();

  const add = (text: string | null) => {
    if (!text) return;
    const w = words(text);
    for (let i = 0; i + VERBATIM_RUN <= w.length; i++) {
      shingles.add(w.slice(i, i + VERBATIM_RUN).join(" "));
    }
  };

  for (const r of snapshot.runners) {
    for (const t of r.traders ?? []) add(t.thesis);
  }
  for (const list of extra.values()) {
    for (const t of list) add(t.text);
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
function allowedNumbers(r: Runner, theses: FomoThesis[] = [], cfg?: FilterConfig): Set<string> {
  const ok = new Set<string>();

  // Thresholds we print in the evidence ourselves. "3 of 8 sampled cleared $10k"
  // was being deleted because $10k is a config value rather than a measurement —
  // the validator rejecting a number the pipeline had handed the model.
  if (cfg) {
    ok.add(usd(cfg.bigWinnerPnlUsd).toLowerCase());
    ok.add(String(cfg.maxTradersPerRunner));
  }

  // Figures quoted inside a thesis are evidence too. The guard's rule is "no
  // number that is not in the evidence", and thesis text IS evidence — without
  // this, summarising "revenue multiple back under 1.0x" is deleted because 1.0
  // is not a price fact about the pool, which would gut exactly the catalysts
  // the theses exist to provide.
  for (const t of theses) {
    for (const m of t.text.matchAll(/\$?\d[\d,.]*\s*[kmb%x]?/gi)) {
      ok.add(m[0].trim().toLowerCase().replace(/\s+/g, ""));
    }
  }

  const money = [
    r.mcap?.low,
    r.mcap?.high,
    r.mcap?.current,
    r.liquidityUsd,
    r.volume24hUsd,
    r.fdvUsd,
    ...(r.traders ?? []).flatMap((t) => [t.pnlUsd, t.realizedPnlUsd, t.volumeUsd]),
  ].filter((n): n is number => typeof n === "number");

  if (r.pairing) money.push(r.pairing.volumeUsd);
  for (const m of money) ok.add(usd(m).toLowerCase());
  // Guarded: an unguarded template would add the literal string "nullx" for a
  // launch, which is harmless but also means no multiple is ever licensed — and
  // silently so.
  if (r.mcap?.multiple != null) {
    ok.add(`${r.mcap.multiple}x`);
    // Rounding is not fabrication. The model wrote "296x" for a 296.5x move and
    // had the line deleted, which teaches it nothing except to avoid the figure.
    // Both directions: Math.round(296.5) is 297, so rounding alone still
    // rejected the truncation the model actually wrote.
    ok.add(`${Math.round(r.mcap.multiple)}x`);
    ok.add(`${Math.floor(r.mcap.multiple)}x`);
    ok.add(`${r.mcap.multiple.toFixed(1)}x`);
  }

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
  let rest = text.toLowerCase();

  // Each pass CONSUMES what it validated. Without that, the bare-integer scan
  // re-reads the digits of figures already approved: "296.5x" was allowed as a
  // multiple and then rejected again as the integer 296, deleting a correct
  // line. Clock times are consumed for the same reason ("15:00" -> "15").
  rest = rest.replace(/\b\d{1,2}:\d{2}\b/g, " ");

  // The \b is load-bearing: without it "$640 booked" matches as "$640 b" and
  // is reported as the fabricated figure "$640b".
  for (const [, amount] of [...rest.matchAll(/(\$\d[\d.,]*\s?[kmb]?)\b/g)]) {
    const norm = amount!.replace(/[\s,]/g, "");
    if (!allowed.has(norm)) return norm;
  }
  rest = rest.replace(/\$\d[\d.,]*\s?[kmb]?\b/g, " ");

  for (const [, mult] of [...rest.matchAll(/\b(\d+(?:\.\d+)?x)\b/g)]) {
    if (!allowed.has(mult!)) return mult!;
  }
  rest = rest.replace(/\b\d+(?:\.\d+)?x\b/g, " ");

  for (const [, int] of [...rest.matchAll(/\b(\d{3,})\b/g)]) {
    if (!allowed.has(int!)) return int!;
  }
  return null;
}

/** Handles and tickers that legitimately appear in the evidence. */
function allowedEntities(
  snapshot: Snapshot,
  theses: ThesesBySymbol = new Map(),
): { handles: Set<string>; tickers: Set<string> } {
  const handles = new Set<string>();
  const tickers = new Set<string>();

  for (const r of snapshot.runners) {
    tickers.add(r.symbol.toLowerCase());
    // A pairing symbol is a ticker we derived ourselves and handed to the model
    // as evidence. Leaving it out meant the validator deleted "paired with $MET"
    // as an invented entity — rejecting a true fact the pipeline had supplied.
    if (r.pairing) tickers.add(r.pairing.symbol.toLowerCase());
    // Deliberately NOT adding t.handle: see the note below. Platform handles
    // must not reach notes/, which is committed.
    void r.traders;
  }
  // Tickers from theses are fine — they are on-chain tokens.
  //
  // Authors are NOT. notes/ is committed to a public repo, so a generated line
  // naming @someone would archive a platform handle, and permission covers
  // reading that content rather than storing it. Attribution is a real loss:
  // crediting the trader who called it is part of what makes a recap worth
  // reading. But "the largest holder in the set is up $1.17m" carries nearly
  // the same weight and stores nothing, and the agreement is not ambiguous.
  //
  // The rendered page is gitignored and may show handles; the archive may not.
  for (const list of theses.values()) {
    for (const t of list) tickers.add(t.symbol.toLowerCase());
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
/**
 * Claims about other days.
 *
 * `buildEvidence` is handed exactly one snapshot, so the model has no access to
 * yesterday. Any assertion of continuity is therefore unsupported by
 * construction — not a style preference but a thing it cannot know. A real
 * generation labelled a coin "Same As Yesterday", which was plausible, uncheckable
 * and exactly the kind of confident-sounding filler that erodes trust.
 *
 * Deliberately conservative: "again" and "still" are excluded because both have
 * legitimate intraday readings ("bounced again", "still bid").
 */
const CROSS_DAY =
  /\b(yesterday|same as (?:yesterday|before)|(?:second|third|fourth) day|last (?:week|time|night)|days in a row|round two)\b/i;

export function crossDayClaim(text: string): string | null {
  return text.match(CROSS_DAY)?.[0] ?? null;
}

/**
 * Claims about how many people made money.
 *
 * Trader data is a SAMPLE: the ~8 highest-volume wallets, out of thousands of
 * buyers. Any count stated as a population fact is unsupported, and on STONK the
 * model wrote "only two real winners cleared here" for a token where a single
 * fomo trader banked $1.17m. That is not a style slip, it is a false statement
 * about the world, and it is the fastest way to lose a reader who was there.
 *
 * Rather than blocklisting phrasings, this requires a positive disclosure: any
 * counting claim about winners or traders must say "sampled" or "of N". That is
 * robust to rewording in a way a blocklist never is.
 */
// The span may not cross a clause boundary. Allowing it to meant
// "8 of 8 top wallets bots, 0 real winners" matched as ONE claim, and the "of 8"
// from the first clause laundered the undisclosed count in the second.
const WINNER_CLAIM =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|no|zero|none|only|all|not\s+one|nobody|no\s+one)\b[^.;,\u2014\u2013]{0,40}?\b(?:real\s+)?(?:winners?|traders?|humans?|people)\b/i;
const VAGUE_ABSOLUTE = /\b(?:nothing real|no one made|nobody made|only real green|not a single)\b/i;
const DISCLOSED = /\bsampl|\bof \d+\b|\b\d+\s*\/\s*\d+\b/i;

export function populationClaim(text: string): string | null {
  if (VAGUE_ABSOLUTE.test(text)) return text.match(VAGUE_ABSOLUTE)![0];
  const m = text.match(WINNER_CLAIM);
  if (!m || m.index === undefined) return null;

  // Disclosure must sit NEXT TO the claim, not anywhere in the line. Checking
  // the whole string let "8 of 8 top wallets bots, 0 real winners" through:
  // the unrelated "of 8" laundered the false half of the sentence.
  // Only the claim itself and what immediately follows it count as disclosure.
  const near = text.slice(m.index, m.index + m[0].length + 20);
  return DISCLOSED.test(near) ? null : m[0];
}

export function validateOutput(
  narrative: GeneratedNarrative,
  snapshot: Snapshot,
  theses: ThesesBySymbol = new Map(),
): ValidationReport {
  const { handles, tickers } = allowedEntities(snapshot, theses);
  const shingles = thesisShingles(snapshot, theses);
  const report: ValidationReport = { kept: 0, dropped: [] };

  const bySymbol = new Map(snapshot.runners.map((r) => [r.symbol.toLowerCase(), r]));

  for (const coin of narrative.coins) {
    const runner = bySymbol.get(coin.symbol.toLowerCase());
    const numbers = runner
      ? allowedNumbers(runner, theses.get(coin.symbol.toLowerCase()) ?? [], snapshot.config)
      : null;

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

      // A catalyst explains why. A line built from price is a caption for a
      // chart the reader is already looking at — and an audit of the 15 lines
      // published on 2026-09-11 found 10 of them were exactly that.
      if (isPriceRestatement(entry.text)) {
        report.dropped.push({
          symbol: coin.symbol,
          text: entry.text,
          reason: "price restatement — names no mechanism",
        });
        return false;
      }

      const population = populationClaim(entry.text);
      if (population) {
        report.dropped.push({
          symbol: coin.symbol,
          text: entry.text,
          reason: `population claim from an 8-wallet sample ("${population}")`,
        });
        return false;
      }

      const crossDay = crossDayClaim(entry.text);
      if (crossDay) {
        report.dropped.push({
          symbol: coin.symbol,
          text: entry.text,
          reason: `claims about another day ("${crossDay}") — evidence is one snapshot`,
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

    // Labels were an unguarded channel: everything above checked timeline text
    // only, so a fabricated ticker, figure or cross-day claim in the header
    // reached the page unchecked. Blank it rather than dropping the coin — the
    // timeline is still good, it just loses its headline.
    if (coin.label) {
      const labelProblem =
        (numbers ? unsupportedNumber(coin.label, numbers) : null) ??
        crossDayClaim(coin.label) ??
        [...coin.label.matchAll(/@([A-Za-z0-9_]{2,30})/g)]
          .map((m) => m[1]!.toLowerCase())
          .find((h) => !handles.has(h)) ??
        [...coin.label.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,14})/g)]
          .map((m) => m[1]!.toLowerCase())
          .find((t) => !tickers.has(t));

      if (labelProblem) {
        report.dropped.push({
          symbol: coin.symbol,
          text: coin.label,
          reason: `unsupported label ("${labelProblem}")`,
        });
        coin.label = "";
      }
    }
  }
  // Section titles run the same gauntlet as coin labels. A header is the most
  // prominent text on the page, so an invented ticker or figure there does more
  // damage than the same claim buried in a timeline line.
  for (const g of narrative.groups ?? []) {
    const problem =
      crossDayClaim(g.title) ??
      populationClaim(g.title) ??
      [...g.title.matchAll(/@([A-Za-z0-9_]{2,30})/g)]
        .map((m) => m[1]!.toLowerCase())
        .find((h) => !handles.has(h)) ??
      [...g.title.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,14})/g)]
        .map((m) => m[1]!.toLowerCase())
        .find((t) => !tickers.has(t));

    if (problem) {
      report.dropped.push({
        symbol: g.key,
        text: g.title,
        reason: `unsupported section title ("${problem}")`,
      });
      g.title = "";
    }
  }

  return report;
}

export interface GenerationResult {
  narrative: GeneratedNarrative;
  validation: ValidationReport;
  provenance: { model: string; generatedAt: string; evidenceSha256: string };
}

export async function generateNarrative(
  snapshot: Snapshot,
  theses: ThesesBySymbol = new Map(),
): Promise<GenerationResult | null> {
  if (!hasApiKey()) {
    console.log("  no ANTHROPIC_API_KEY — skipping narrative generation");
    return null;
  }
  if (snapshot.runners.length === 0) return null;

  const client = new Anthropic();
  const evidence = buildEvidence(snapshot, theses);
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

  const validation = validateOutput(narrative, snapshot, theses);

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
