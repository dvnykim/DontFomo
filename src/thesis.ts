/**
 * Thesis ranking — deciding which of a token's posts is worth a catalyst line.
 *
 * A token's feed is overwhelmingly noise. On STONK's page, out of ~30 posts the
 * substantive ones were a handful: revenue figures, buyback and burn mechanics,
 * supply burnt, the launchpad war. The rest were "breh", "no sweat", "$STONK to
 * the moon", "valhalla awaits".
 *
 * Ranking by likes alone fails — the funniest post wins, not the most
 * informative. Ranking by author P&L alone fails — the biggest bag holder is
 * not necessarily saying anything. So this combines three independent signals:
 *
 *   1. SUBSTANCE  does the post name a mechanism (revenue, burns, listings)
 *                 rather than assert a direction?
 *   2. STAKE      is the author actually positioned, and by how much?
 *   3. REACTION   did the crowd respond?
 *
 * Every score carries `reasons`, because an editorial filter you cannot inspect
 * is one you cannot trust or tune.
 */

import type { FomoThesis } from "./types.ts";

/**
 * Mechanisms, not directions. "revenue is printing" is checkable and causal;
 * "this is going up" is not. These are the words that separate the two.
 */
const SUBSTANCE =
  /\b(revenue|fees?|burn(?:ed|s|ing|t)?|buy ?backs?|bought ?back|supply|volume|listing|listed|integrat\w*|partner\w*|airdrop|unlock|launchpad|holders?|liquidity|market ?cap|treasury|emission|leaderboard|ship(?:ping|s|ped)?|update|acquired|communit\w+|protocol|deploy|migrat\w*|narrative|rotation|competitor|ecosystem|flywheel|incentive|alignment|tvl|rwa|dev|roadmap)\b/gi;

/** Pure sentiment. Present in most posts; on its own it is not information. */
const HYPE =
  /\b(moon|lfg|wagmi|gm|ez|send it|ape[ds]?|valhalla|aura|pump it|to the moon|easy|rich|100x|1000x)\b|🚀|🌙/gi;

/**
 * A forward-looking price call: "going to 50m", "next target is 100m mcap",
 * "50 is destined. 100 is next".
 *
 * These read as analysis and contain none. A recap says why a coin moved, not
 * where someone hopes it goes — and hope is the most common thing in any token
 * feed, so without a penalty it crowds out the posts that explain something.
 * One live feed ranked "we're going to 50m by today" SECOND, above two posts
 * describing the fee mechanism, purely for being long and naming a launchpad.
 */
const PRICE_TARGET =
  /\b(?:going (?:to|for)|headed (?:to|for)|next target|see you (?:at|there)|wen|destined|path to|on the way to|target(?:ing)?)\b[^.!?]{0,24}?\d[\d,.]*\s*(?:m|b|k|x|mil|million|mcap)\b|\b\d[\d,.]*\s*(?:m|mcap)\b[^.!?]{0,16}?\b(?:next|soon|today|incoming|destined|imminent)\b/i;

/**
 * A concrete figure — what makes a claim checkable. Written loosely because
 * traders write money every possible way: "$1.5m", "900k$", "1.5 mil", "10%".
 */
const FIGURE =
  /(\$\s?[\d,.]+|[\d,.]+\s?\$|\b\d[\d,.]*\s*(?:%|x|k|m|b|mil|million|billion)\b|\b\d[\d,.]{2,}\b)/gi;

export interface ThesisScore {
  score: number;
  reasons: string[];
}

const countMatches = (re: RegExp, text: string): number => {
  const m = text.match(re);
  return m ? new Set(m.map((x) => x.toLowerCase())).size : 0;
};

/**
 * @param peakAt When the token topped. A thesis posted BEFORE the move is a
 *               call; one posted after is a victory lap. Same words, different
 *               value, and only the timestamp can tell them apart.
 */
export function scoreThesis(t: FomoThesis, opts: { peakAt?: string | null } = {}): ThesisScore {
  const reasons: string[] = [];
  let score = 0;

  const text = t.text.trim();
  const words = text.split(/\s+/).filter(Boolean).length;

  if (words < 4) {
    reasons.push("too short to say anything");
    score -= 6;
  }

  // Substance dominates by design. A thesis is read to learn WHY someone
  // bought; everything else is context on how much to trust that reason.
  const substance = countMatches(SUBSTANCE, text);
  if (substance > 0) {
    const pts = Math.min(substance, 5) * 5;
    score += pts;
    reasons.push(`names ${substance} mechanism${substance === 1 ? "" : "s"} (+${pts})`);
  }

  const figures = countMatches(FIGURE, text);
  if (figures > 0) {
    const pts = Math.min(figures, 3) * 3;
    score += pts;
    reasons.push(`${figures} concrete figure${figures === 1 ? "" : "s"} (+${pts})`);
  }

  if (PRICE_TARGET.test(text)) {
    score -= 8;
    reasons.push("price target, not a reason (-8)");
  }

  const hype = countMatches(HYPE, text);
  if (hype > 0 && substance === 0) {
    const pts = Math.min(hype, 3) * 3;
    score -= pts;
    reasons.push(`sentiment only, no mechanism (-${pts})`);
  }

  // Likes are weak evidence and capped hard. A large account bullposting
  // collects hundreds of them for a one-liner; that is reach, not information.
  // They break ties between substantive posts, nothing more.
  if (t.likes !== null && t.likes > 0) {
    const pts = Math.min(Math.round(Math.log2(t.likes + 1) * 0.5 * 10) / 10, 3);
    score += pts;
    reasons.push(`${t.likes} likes (+${pts}, capped)`);
  }

  // Stake is capped too. Conviction is real signal, but a big bag does not
  // make a one-liner informative — it makes the author worth watching, which
  // is a different product surface.
  if (t.pnlUsd !== null && t.pnlUsd > 0) {
    const pts = Math.min(Math.round(Math.log10(t.pnlUsd) * 1.0 * 10) / 10, 5);
    score += pts;
    reasons.push(`$${Math.round(t.pnlUsd).toLocaleString()} at stake (+${pts}, capped)`);
  }

  // Length helps up to a point: a paragraph explaining a mechanism beats a
  // sentence, but an essay is not four times better than a paragraph.
  if (words >= 25) {
    score += 4;
    reasons.push("developed argument (+4)");
  }

  if (opts.peakAt && t.at) {
    const before = Date.parse(t.at) < Date.parse(opts.peakAt);
    score += before ? 4 : -2;
    reasons.push(before ? "posted before the peak (+4)" : "posted after the peak (-2)");
  }

  if (t.closed) {
    score -= 2;
    reasons.push("position already closed (-2)");
  }

  return { score: Math.round(score * 10) / 10, reasons };
}

export interface RankedThesis extends FomoThesis {
  scored: ThesisScore;
}

/**
 * Best theses first. Near-duplicates are collapsed — the same trader posting
 * five variations of one idea should occupy one slot, not five.
 */
export function rankTheses(
  theses: FomoThesis[],
  opts: { peakAt?: string | null; limit?: number; minScore?: number } = {},
): RankedThesis[] {
  const { limit = 5, minScore = 0 } = opts;

  const ranked = theses
    .map((t) => ({ ...t, scored: scoreThesis(t, opts) }))
    .filter((t) => t.scored.score >= minScore)
    .sort((a, b) => b.scored.score - a.scored.score);

  const kept: RankedThesis[] = [];
  const seenAuthors = new Map<string, number>();

  for (const t of ranked) {
    if (kept.length >= limit) break;
    const author = t.author ?? "?";
    const used = seenAuthors.get(author) ?? 0;
    // At most two slots per author, so one prolific poster cannot own the recap.
    if (used >= 2) continue;
    seenAuthors.set(author, used + 1);
    kept.push(t);
  }

  return kept;
}
