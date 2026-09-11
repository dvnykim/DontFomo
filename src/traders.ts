/**
 * Trader-led aggregation — the inverted pipeline.
 *
 * The original pipeline asked "what has a big market cap?" and used that as a
 * proxy for "worth writing about". Measured against real fomo activity that
 * proxy is simply wrong: of 10 coins the on-chain pipeline surfaced on
 * 2026-09-11, exactly one appeared in a top trader's 68 open positions, and it
 * was a $109 dust holding. 30 of his 34 live trades sat below the $1m floor,
 * median cap ~$72k.
 *
 * So the question is inverted. Instead of finding big coins and asking who
 * traded them, find what traders with real followings bought and look those up.
 * Conviction and attention replace market cap as the filter.
 *
 * Ranking signal, in order:
 *   1. How many *independent* traders bought it. Consensus is the rarest signal
 *      and the hardest to fake — one trader buying is noise, four is a story.
 *   2. Combined follower reach, i.e. how many people saw the call.
 *   3. Total dollars committed.
 *
 * Deliberately NOT ranked on price performance. That is what every other tool
 * already does, and it reads the day backwards: it tells you what already
 * happened rather than what people actually did.
 */

import type { TraderDay, TraderLedToken, FomoThesis } from "./types.ts";

export interface TraderLedConfig {
  /** Ignore dust. Traders place $10 probe buys constantly; they aren't calls. */
  minBuyUsd: number;
  /** Keep at most this many tokens in the recap. */
  maxTokens: number;
}

export const DEFAULT_TRADER_CONFIG: TraderLedConfig = {
  minBuyUsd: 50,
  maxTokens: 12,
};

/** Case-insensitive symbol key. Traders type `$Verity` and `$VERITY`. */
const key = (s: string) => s.trim().toLowerCase();

export function buildTraderLedTokens(
  days: TraderDay[],
  cfg: TraderLedConfig = DEFAULT_TRADER_CONFIG,
): TraderLedToken[] {
  const followersByHandle = new Map<string, number>();
  for (const d of days) followersByHandle.set(d.handle, d.followers ?? 0);

  const acc = new Map<string, TraderLedToken & { buyerSet: Set<string> }>();
  // Per-call, not module-level: shared scratch state would corrupt the second
  // invocation with ordering from the first.
  const firstAgo = new Map<string, number>();
  const lastAgo = new Map<string, number>();

  const get = (symbol: string) => {
    const k = key(symbol);
    let t = acc.get(k);
    if (!t) {
      t = {
        symbol: symbol.trim(),
        buyers: [],
        buyerSet: new Set<string>(),
        buyCount: 0,
        sellCount: 0,
        totalBuyUsd: 0,
        totalSellUsd: 0,
        theses: [],
        followerReach: 0,
        firstBuyMcapUsd: null,
        lastTradeMcapUsd: null,
        firstBuyAt: null,
      };
      acc.set(k, t);
    }
    return t;
  };

  for (const day of days) {
    for (const trade of day.trades) {
      if (trade.action === "buy" && trade.amountUsd < cfg.minBuyUsd) continue;
      const t = get(trade.symbol);

      if (trade.action === "buy") {
        t.buyCount++;
        t.totalBuyUsd += trade.amountUsd;
        if (!t.buyerSet.has(day.handle)) {
          t.buyerSet.add(day.handle);
          t.buyers.push(day.handle);
          t.followerReach += followersByHandle.get(day.handle) ?? 0;
        }
        // Earliest buy = largest agoMinutes. This is the entry worth quoting:
        // "first bought at $22k" is the fact that makes a later peak mean something.
        const prevFirst = firstAgo.get(key(trade.symbol));
        if (trade.agoMinutes !== null && (prevFirst === undefined || trade.agoMinutes > prevFirst)) {
          firstAgo.set(key(trade.symbol), trade.agoMinutes);
          t.firstBuyMcapUsd = trade.mcapUsd;
          t.firstBuyAt = trade.at;
        }
      } else {
        t.sellCount++;
        t.totalSellUsd += trade.amountUsd;
      }

      // Most recent trade = smallest agoMinutes.
      const prev = lastAgo.get(key(trade.symbol));
      if (trade.agoMinutes !== null && (prev === undefined || trade.agoMinutes < prev)) {
        lastAgo.set(key(trade.symbol), trade.agoMinutes);
        t.lastTradeMcapUsd = trade.mcapUsd;
      }
    }

    for (const thesis of day.theses) {
      const t = get(thesis.symbol);
      if (!t.theses.some((x) => x.text === thesis.text)) t.theses.push(thesis);
    }
  }

  const out = [...acc.values()].map(({ buyerSet: _drop, ...rest }) => rest);

  out.sort(
    (a, b) =>
      b.buyers.length - a.buyers.length ||
      b.followerReach - a.followerReach ||
      b.totalBuyUsd - a.totalBuyUsd,
  );

  return out.slice(0, cfg.maxTokens);
}

/**
 * Tokens where the group sold more than it bought. Worth surfacing: "four
 * traders you follow were distributing this today" is more useful than silence.
 */
export function isDistribution(t: TraderLedToken): boolean {
  return t.sellCount > 0 && t.totalSellUsd > t.totalBuyUsd;
}

/** Theses across all tokens, newest first — the raw material for catalysts. */
export function allTheses(tokens: TraderLedToken[]): FomoThesis[] {
  return tokens
    .flatMap((t) => t.theses)
    .sort((a, b) => (a.agoMinutes ?? 1e9) - (b.agoMinutes ?? 1e9));
}
