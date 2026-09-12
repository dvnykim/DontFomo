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
