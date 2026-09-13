/**
 * Runner selection: turns ~200 raw pools into the ~10 that are worth writing about.
 *
 * This file is the editorial core of DontFomo. Sorting by raw 24h gain does not
 * work — the top of that list is dominated by $3k-liquidity rugs that printed
 * +1700% and round-tripped. What makes a run *interesting* is that real money
 * participated and could still get out. The filters and score below encode that.
 *
 * Expect to tune these thresholds. That tuning is the product's point of view,
 * not an implementation detail.
 */

import type { FilterConfig, RawPool, Runner } from "./types.ts";
import { hasReportedLiquidity } from "./types.ts";
import { detectNamesake } from "./namesake.ts";
import { splitPoolName } from "./sources/geckoterminal.ts";

function ageInDays(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const ms = Date.now() - new Date(createdAt).getTime();
  return Number.isFinite(ms) ? ms / 86_400_000 : null;
}

/**
 * Churn tolerance depends on age. A token hours old routinely trades hundreds of
 * times its liquidity as it price-discovers; an established token doing that is
 * a much stronger wash-trading signal. Unknown age is treated as established.
 */
function churnLimit(age: number | null, cfg: FilterConfig): number {
  const isNew = age !== null && age < cfg.establishedAfterDays;
  return isNew ? cfg.churnWarnThresholdNew : cfg.churnWarnThresholdEstablished;
}

/**
 * Composite score. Gain is log-scaled so a +1700% microcap doesn't automatically
 * outrank a +80% run with 100x the liquidity; depth and participation breadth are
 * rewarded because they're what make a move real rather than a single-wallet print.
 */
function scoreRunner(
  p: RawPool,
  churn: number | null,
  age: number | null,
  cfg: FilterConfig,
  /** Percentage gain to score on. Defaults to 24h open→close. */
  gainPct: number = p.change.h24,
): number {
  const gain = Math.log10(1 + Math.max(0, gainPct));
  // Depth rewards real markets over thin ones. Liquidity is unreported for most
  // pools here, and log10(1 + 0) is 0 — which zeroed the entire product and sent
  // every such coin to the bottom in arbitrary order, including the day's
  // biggest movers. Volume stands in when depth is missing: a pool's reserves
  // are typically a small fraction of what trades through it in a day, so ~1%
  // keeps the two roughly comparable. A proxy, and deliberately a conservative one.
  const depthBasis = hasReportedLiquidity(p.liquidityUsd) ? p.liquidityUsd : p.volume24hUsd / 100;
  const depth = Math.log10(1 + depthBasis);
  const breadth = Math.log10(1 + p.txns24h.buyers);
  // No penalty for unknown churn — see Runner.churn.
  const washPenalty = churn !== null && churn > churnLimit(age, cfg) ? 0.6 : 1;
  return Number((gain * depth * breadth * washPenalty).toFixed(3));
}

/**
 * Re-scores and re-sorts once market caps are known.
 *
 * Discovery has to rank on the 24h open→close change because the intraday
 * low→high multiple costs an API call per token. That produces orderings the UI
 * visibly contradicts — a 13.7x sitting below a 7x. Once enrichment fills in the
 * real multiple, rank on that instead.
 *
 * Note the shortlist itself was still chosen by the preliminary score, so a
 * token just outside the cut can't climb in. Acceptable while maxRunners is
 * generous relative to how many clear the filters.
 */
/**
 * Final ordering once trader data exists.
 *
 * The headline question this product answers is "which trade made the most
 * independent traders serious money" — not "which chart went up most". So the
 * count of wallets clearing the PnL bar outranks the price multiple whenever we
 * know it, with score as the tiebreak. No-ops when trader data is unavailable,
 * leaving the market-cap ordering intact.
 */
export function rankByBigWinners(runners: Runner[]): void {
  if (!runners.some((r) => r.bigWinners !== null)) return;
  runners.sort((a, b) => (b.bigWinners ?? -1) - (a.bigWinners ?? -1) || b.score - a.score);
}

export function rescoreByMarketCap(runners: Runner[], cfg: FilterConfig): void {
  for (const r of runners) {
    // A launch has no multiple, so it keeps its discovery score (24h change).
    if (!r.mcap || r.mcap.multiple === null || r.mcap.multiple <= 0) continue;
    const gainPct = (r.mcap.multiple - 1) * 100;
    r.score = scoreRunner(r, r.churn, r.ageDays, cfg, gainPct);
  }
  runners.sort((a, b) => b.score - a.score);
}

/** Trades per unique wallet on one side of the book. 0 sellers => not bot-driven. */
function perWallet(trades: number, wallets: number): number {
  return wallets > 0 ? trades / wallets : 0;
}

/** Quality warnings worth showing the reader rather than silently filtering out. */
function computeFlags(p: RawPool, churn: number | null, age: number | null, cfg: FilterConfig): string[] {
  const flags: string[] = [];

  if (churn !== null && churn > churnLimit(age, cfg)) flags.push("possible-wash-trading");
  if (age !== null && age < 1) flags.push("launched-today");

  // A handful of wallets doing thousands of trades is the clearest bot signal
  // available from aggregate data — and it is routinely one-sided, e.g. 3,046
  // buyers against 43 sellers responsible for ~29k sells.
  const { buys, sells, buyers, sellers } = p.txns24h;
  if (perWallet(sells, sellers) > cfg.botTradesPerWalletThreshold) flags.push("bot-driven-selling");
  if (perWallet(buys, buyers) > cfg.botTradesPerWalletThreshold) flags.push("bot-driven-buying");
  if (p.txns24h.sellers > 0 && p.txns24h.buyers / p.txns24h.sellers < 0.7) {
    flags.push("distribution"); // more unique sellers than buyers: someone is exiting
  }
  // Ran hard on the day but is bleeding on the hour — likely already round-tripping.
  if (p.change.h24 > 100 && p.change.h1 < -15) flags.push("fading");
  if (hasReportedLiquidity(p.liquidityUsd) && p.fdvUsd / p.liquidityUsd > 500) flags.push("thin-float");

  return flags;
}

export interface DiscoveryResult {
  runners: Runner[];
  stats: {
    afterFilters: number;
    /**
     * How many pools each filter rejected, in the order they were applied.
     *
     * Without this, tuning coverage is guesswork: a run reporting "178 pools ->
     * 12 runners" says nothing about WHICH threshold did the cutting, and the
     * obvious guess is usually wrong.
     */
    rejections: Record<string, number>;
  };
}

export function selectRunners(pools: RawPool[], cfg: FilterConfig): DiscoveryResult {
  const survivors: Runner[] = [];
  const rejections: Record<string, number> = {};
  const reject = (why: string) => {
    rejections[why] = (rejections[why] ?? 0) + 1;
    return false;
  };

  for (const p of pools) {
    const { base, quote } = splitPoolName(p.name);

    // Cross-pairs (e.g. EMBER/MET) are excluded from PRICING: the percentage
    // change is denominated in another volatile token. The pairing itself is
    // recovered later — see enrichWithPairings.
    if (!cfg.allowedQuoteSymbols.includes(quote) && !reject("quote token")) continue;

    // Liquidity OR demonstrated trading. See illiquidVolumeFloorUsd: depth is
    // simply not reported for most pools here, so requiring it threw away the
    // market rather than the rugs.
    const hasDepth = hasReportedLiquidity(p.liquidityUsd) && p.liquidityUsd >= cfg.minLiquidityUsd;
    const provenByFlow = p.volume24hUsd >= cfg.illiquidVolumeFloorUsd;
    if (!hasDepth && !provenByFlow && !reject("liquidity")) continue;
    if (p.volume24hUsd < cfg.minVolume24hUsd && !reject("volume")) continue;
    if (p.fdvUsd < cfg.minFdvUsd && !reject("market cap")) continue;
    if (p.change.h24 < cfg.minChange24hPct && !reject("24h gain")) continue;
    if (p.txns24h.buyers < cfg.minBuyers24h && !reject("unique buyers")) continue;

    // Null, not Infinity. Unreported depth means churn is unknowable, and
    // treating unknown as "maximally suspicious" libels most of the page.
    const churn = hasReportedLiquidity(p.liquidityUsd) ? p.volume24hUsd / p.liquidityUsd : null;
    const age = ageInDays(p.createdAt);

    survivors.push({
      ...p,
      symbol: base,
      ageDays: age === null ? null : Number(age.toFixed(2)),
      churn: churn === null ? null : Number(churn.toFixed(2)),
      buyerSellerRatio: Number(
        (p.txns24h.sellers > 0 ? p.txns24h.buyers / p.txns24h.sellers : 0).toFixed(2),
      ),
      buysPerBuyer: Number(perWallet(p.txns24h.buys, p.txns24h.buyers).toFixed(1)),
      sellsPerSeller: Number(perWallet(p.txns24h.sells, p.txns24h.sellers).toFixed(1)),
      score: scoreRunner(p, churn, age, cfg),
      flags: computeFlags(p, churn, age, cfg),
      mcap: null,
    pairing: null,
    namesake: detectNamesake(base),
    description: null,
    tickerCopies: 0, // filled by the enrichment pass, which costs one call per runner
      traders: null, // null = not fetched (no Birdeye key); [] = fetched, none found
      bigWinners: null,
      botTraders: null,

    });
  }

  survivors.sort((a, b) => b.score - a.score);

  return {
    runners: dedupeBySymbol(survivors).slice(0, cfg.maxRunners),
    stats: { afterFilters: survivors.length, rejections },
  };
}

/**
 * One entry per ticker, keeping the deepest market.
 *
 * Dedupe already runs on the base TOKEN, which is correct — but distinct tokens
 * routinely share a ticker. On 2026-09-11 three separate EMBER contracts and two
 * NVIDIAs all cleared the filters, and a page listing "$EMBER" three times with
 * three different market caps reads as a broken page rather than a real market.
 *
 * Liquidity decides, not score: among tokens wearing the same name, the one with
 * the deepest book is the one a reader will actually end up trading.
 *
 * The count of losers is kept on the survivor rather than discarded. "Three
 * tokens launched under this ticker today" is a genuine warning — buying the
 * wrong contract is one of the easiest ways to lose money on a launch.
 */
export function dedupeBySymbol(runners: Runner[]): Runner[] {
  const best = new Map<string, Runner>();
  const counts = new Map<string, number>();

  for (const r of runners) {
    const key = r.symbol.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const incumbent = best.get(key);
    if (!incumbent || r.liquidityUsd > incumbent.liquidityUsd) best.set(key, r);
  }

  for (const [key, r] of best) r.tickerCopies = (counts.get(key) ?? 1) - 1;

  // Preserve the incoming score order rather than the map's insertion order.
  return runners.filter((r) => best.get(r.symbol.trim().toLowerCase()) === r);
}
