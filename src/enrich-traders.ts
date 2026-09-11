/**
 * Attach on-chain reality to trader-led tokens.
 *
 * Traders tell us *what* they bought and what cap they saw. Only the chain can
 * say what actually happened to it. This is the join.
 *
 * The market cap used as the resolution hint is the trader's MOST RECENT
 * observation, not their entry. GeckoTerminal reports current FDV, so comparing
 * against the newest figure is the fair test — a coin that entered at $22k and
 * now sits at $900k would look like a resolution failure against its entry.
 */

import {
  resolveTokenBySymbol,
  fetchDayRange,
  REQUEST_DELAY_MS,
  sleep,
} from "./sources/geckoterminal.ts";
import type { TraderLedToken } from "./types.ts";

export interface EnrichReport {
  resolved: number;
  unresolved: string[];
  /** Resolved, but far enough from the reported cap to be worth hedging about. */
  lowConfidence: string[];
}

/**
 * Resolves each token and, when `withRange`, pulls its intraday high/low.
 *
 * Costs up to 2 keyless requests per token at ~7s apiece, so a 12-token day is
 * roughly 3 minutes. Failures are per-token: one bad lookup leaves that token
 * unresolved rather than losing the day.
 */
export async function enrichTraderLedTokens(
  tokens: TraderLedToken[],
  opts: { withRange?: boolean; network?: string; log?: boolean } = {},
): Promise<EnrichReport> {
  const { withRange = true, network = "solana", log = true } = opts;
  const report: EnrichReport = { resolved: 0, unresolved: [], lowConfidence: [] };

  for (const [i, token] of tokens.entries()) {
    if (i > 0) await sleep(REQUEST_DELAY_MS);

    const hint = token.lastTradeMcapUsd ?? token.firstBuyMcapUsd;
    let match = null;
    try {
      match = await resolveTokenBySymbol(token.symbol, hint, network);
    } catch (err) {
      if (log) console.warn(`  $${token.symbol}: lookup failed — ${(err as Error).message}`);
    }

    if (!match) {
      report.unresolved.push(token.symbol);
      if (log) console.log(`  $${token.symbol.padEnd(14)} unresolved`);
      continue;
    }

    token.onchain = { ...match, mcap: null };
    report.resolved++;
    if (match.mcapRatio !== null && match.mcapRatio > 3) report.lowConfidence.push(token.symbol);

    if (withRange) {
      await sleep(REQUEST_DELAY_MS);
      try {
        const range = await fetchDayRange(match.poolAddress, network);
        if (range) {
          const supply = match.priceUsd > 0 ? match.fdvUsd / match.priceUsd : 0;
          token.onchain.mcap = {
            current: match.fdvUsd,
            low: range.low * supply,
            high: range.high * supply,
            multiple: range.low > 0 ? range.high / range.low : 1,
            peakAt: range.peakAt,
          };
        }
      } catch {
        // Range is a nice-to-have; identity is what matters.
      }
    }

    if (log) {
      const conf = match.mcapRatio === null ? "" : ` (${match.mcapRatio.toFixed(1)}x off reported)`;
      const mult = token.onchain.mcap ? `  ${token.onchain.mcap.multiple.toFixed(1)}x intraday` : "";
      console.log(`  $${token.symbol.padEnd(14)} ${match.name}${conf}${mult}`);
    }
  }

  return report;
}
