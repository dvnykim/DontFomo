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
  churn: number,
  age: number | null,
  cfg: FilterConfig,
  /** Percentage gain to score on. Defaults to 24h open→close. */
  gainPct: number = p.change.h24,
): number {
  const gain = Math.log10(1 + Math.max(0, gainPct));
  const depth = Math.log10(1 + p.liquidityUsd);
  const breadth = Math.log10(1 + p.txns24h.buyers);
  const washPenalty = churn > churnLimit(age, cfg) ? 0.6 : 1;
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
    if (!r.mcap || r.mcap.multiple <= 0) continue;
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
function computeFlags(p: RawPool, churn: number, age: number | null, cfg: FilterConfig): string[] {
  const flags: string[] = [];

  if (churn > churnLimit(age, cfg)) flags.push("possible-wash-trading");
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
  if (p.liquidityUsd > 0 && p.fdvUsd / p.liquidityUsd > 500) flags.push("thin-float");

  return flags;
}

export interface DiscoveryResult {
  runners: Runner[];
  stats: { afterFilters: number };
}

export function selectRunners(pools: RawPool[], cfg: FilterConfig): DiscoveryResult {
  const survivors: Runner[] = [];

  for (const p of pools) {
    const { base, quote } = splitPoolName(p.name);

    // Cross-pairs (e.g. EMBER/MET) are excluded: the percentage change is
    // denominated in another volatile token, so it doesn't mean what it looks like.
    if (!cfg.allowedQuoteSymbols.includes(quote)) continue;

    if (p.liquidityUsd < cfg.minLiquidityUsd) continue;
    if (p.volume24hUsd < cfg.minVolume24hUsd) continue;
    if (p.fdvUsd < cfg.minFdvUsd) continue;
    if (p.change.h24 < cfg.minChange24hPct) continue;
    if (p.txns24h.buyers < cfg.minBuyers24h) continue;

    const churn = p.liquidityUsd > 0 ? p.volume24hUsd / p.liquidityUsd : Infinity;
    const age = ageInDays(p.createdAt);

    survivors.push({
      ...p,
      symbol: base,
      ageDays: age === null ? null : Number(age.toFixed(2)),
      churn: Number(churn.toFixed(2)),
      buyerSellerRatio: Number(
        (p.txns24h.sellers > 0 ? p.txns24h.buyers / p.txns24h.sellers : 0).toFixed(2),
      ),
      buysPerBuyer: Number(perWallet(p.txns24h.buys, p.txns24h.buyers).toFixed(1)),
      sellsPerSeller: Number(perWallet(p.txns24h.sells, p.txns24h.sellers).toFixed(1)),
      score: scoreRunner(p, churn, age, cfg),
      flags: computeFlags(p, churn, age, cfg),
      mcap: null,
    pairing: null, // filled by the enrichment pass, which costs one call per runner
      traders: null, // null = not fetched (no Birdeye key); [] = fetched, none found
      bigWinners: null,
      botTraders: null,

    });
  }

  survivors.sort((a, b) => b.score - a.score);

  return {
    runners: survivors.slice(0, cfg.maxRunners),
    stats: { afterFilters: survivors.length },
  };
}
