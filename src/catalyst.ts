/**
 * Catalyst generation from theses.
 *
 * A catalyst answers *why*. Price data cannot contain the answer, so a line
 * built from price is not a catalyst — it is a caption for a chart the reader
 * is already looking at.
 *
 * The style guide says this, but prompts are advisory. `isPriceRestatement` is
 * the load-bearing version: a line carrying price figures and naming no
 * mechanism is dropped no matter how well it is written.
 */

import type { TraderLedToken, FomoThesis } from "./types.ts";
import { rankTheses } from "./thesis.ts";

/**
 * Things a line can rest on other than price.
 *
 * Two families, and the boundary between them is the whole judgement:
 *
 *   MECHANISM — why it moved. Revenue, burns, listings, pairings.
 *   WALLET FACT — what a specific wallet did. Banked, realised, underwater,
 *                 bundler. This needs per-wallet P&L, which no chart shows.
 *                 Includes "sampled" and "cleared" because "3 of 8 sampled
 *                 cleared $10k" is the exact phrasing the sample rule requires;
 *                 filtering it would leave the model no safe way to report
 *                 trader results at all.
 *
 * Deliberately EXCLUDED: buyers, sellers, volume, liquidity. Those are real
 * numbers and they are also on every terminal, so a line built from them is
 * still something the reader could see at a glance — which was the original
 * complaint. Aggregate participation is context for a claim, not a claim.
 */
const MECHANISM =
  /\b(revenue|fees?|burn(?:ed|s|ing|t)?|buy ?back|supply|listing|listed|integrat\w*|partner\w*|airdrop|unlock|launchpad|treasury|emission|leaderboard|ship(?:ping|s|ped)?|acquired|communit\w+|protocol|deploy|migrat\w*|narrative|competitor|dev|team|roadmap|exchange|pair(?:ed|ing|s)?|pools?|routed?|routing|venue|against)\b/i;

/** What a named wallet actually did — not derivable from a chart. */
const WALLET_FACT =
  /\b(banked|bagged|realised|realized|underwater|bundlers?|bots?|sniped|accumulat\w*|whales?|holders?|wallets?|bought|sold|exited?|sampled|cleared|profit\w*|p&l|pnl|tickers?|copies|copycat)\b|@[A-Za-z0-9_]{2,}/i;

/** Price-shaped facts: caps, multiples, percentages. */
const PRICE_FACT = /(\$\s?[\d,.]+\s*[kmb]\b|\b\d[\d,.]*\s*x\b|\b\d[\d,.]*\s*%)/i;

/**
 * Structural timeline markers. "launched at $471k" is price-only by
 * construction and is still worth a line — it anchors the day, it does not
 * pretend to explain it. Only short lines qualify: once a marker grows a
 * clause about volume and wallets it is making an argument, and arguments need
 * a mechanism.
 */
const MARKER = /^(launched|launch|peaked|topped|opened|listed|deployed)\b/i;
const MARKER_MAX_WORDS = 12;

/**
 * True when a line is price data wearing a catalyst's clothes.
 *
 * Deliberately narrow, in both directions:
 *   - it fires only when the line carries price facts AND names no mechanism,
 *     so "revenue hit $1.5m a day and it ran 1.7x" survives;
 *   - short launch/peak markers are exempt, so the timeline keeps its anchors.
 *
 * Audited against the 15 lines published on 2026-09-11: 11 were chart captions
 * with nothing else in them.
 */
export function isPriceRestatement(text: string): boolean {
  if (!PRICE_FACT.test(text)) return false;
  if (MECHANISM.test(text) || WALLET_FACT.test(text)) return false;

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (MARKER.test(text.trim()) && words <= MARKER_MAX_WORDS) return false;

  return true;
}

/**
 * Evidence block for one token: what traders did, then what the best of them
 * said and why those posts were chosen.
 *
 * Scores are included so the model can weigh a $1.17m holder's one-liner
 * against a detailed argument from someone with $5k on the line.
 */
export function buildThesisEvidence(token: TraderLedToken, limit = 5): string {
  const lines: string[] = [];
  const chain = token.onchain;

  lines.push(`$${token.symbol}`);
  lines.push(
    `  bought by ${token.buyers.length} trader(s): ${token.buyers.map((b) => "@" + b).join(", ")}`,
  );
  lines.push(
    `  ${token.buyCount} buys / ${token.sellCount} sells · ` +
      `$${Math.round(token.totalBuyUsd).toLocaleString()} in, ` +
      `$${Math.round(token.totalSellUsd).toLocaleString()} out · ` +
      `combined reach ${token.followerReach.toLocaleString()} followers`,
  );

  if (token.firstBuyMcapUsd !== null) {
    lines.push(`  first buy seen at $${Math.round(token.firstBuyMcapUsd).toLocaleString()} mcap`);
  }
  if (chain) {
    lines.push(
      `  on-chain: ${chain.name}, now $${Math.round(chain.fdvUsd).toLocaleString()} fdv` +
        (chain.mcap?.multiple != null ? `, intraday ${chain.mcap.multiple.toFixed(1)}x` : "") +
        (chain.mcapRatio !== null && chain.mcapRatio > 3
          ? `  [LOW CONFIDENCE MATCH — ${chain.mcapRatio.toFixed(1)}x off the reported cap]`
          : ""),
    );
  } else {
    lines.push(`  on-chain: UNVERIFIED — do not state any price or market cap for this token`);
  }

  const ranked = rankTheses(token.theses, {
    peakAt: chain?.mcap?.peakAt ?? null,
    limit,
    minScore: 1,
  });

  if (ranked.length === 0) {
    lines.push(`  theses: none worth quoting. If nothing else is known, write no line.`);
    return lines.join("\n");
  }

  lines.push(`  top theses (ranked by substance, stake and reaction — SUMMARISE, never quote):`);
  for (const t of ranked) {
    const who = t.author ? `@${t.author}` : "unattributed";
    const stake = t.pnlUsd !== null ? `, $${Math.round(t.pnlUsd).toLocaleString()} position` : "";
    const likes = t.likes !== null ? `, ${t.likes} likes` : "";
    lines.push(`    - ${who} [score ${t.scored.score}${stake}${likes}]: ${t.text}`);
  }

  return lines.join("\n");
}

export interface CatalystCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Post-hoc check for one generated catalyst line.
 * Mirrors validateOutput's contract: reject rather than repair.
 */
export function checkCatalyst(text: string, theses: FomoThesis[]): CatalystCheck {
  if (isPriceRestatement(text)) {
    return { ok: false, reason: "price restatement — names no mechanism" };
  }
  // Verbatim reproduction is a licensing problem, not a style one.
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = words(text);
  for (const t of theses) {
    const src = words(t.text);
    if (src.length < 8) continue;
    for (let i = 0; i + 8 <= src.length; i++) {
      const shingle = src.slice(i, i + 8).join(" ");
      if (out.join(" ").includes(shingle)) {
        return { ok: false, reason: "reproduces thesis text verbatim" };
      }
    }
  }
  return { ok: true };
}
