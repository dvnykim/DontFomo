/**
 * Second-pass enrichment: adds the market-cap range that the recap format needs.
 *
 * Split from discovery because it costs one API call per runner. Running it only
 * on the final shortlist keeps a full pass at ~10 extra calls instead of ~200.
 */

import type { FilterConfig, Runner } from "./types.ts";
import { fetchDayRange } from "./sources/geckoterminal.ts";
import { fetchTopTraders, hasApiKey, RATE_LIMIT_MS } from "./sources/birdeye.ts";

const REQUEST_DELAY_MS = 7_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * FDV is reported at the current price, so the same ratio converts any price on
 * the day into the market cap it implied at that moment.
 */
function mcapAtPrice(price: number, currentPrice: number, currentFdv: number): number {
  if (currentPrice <= 0) return 0;
  return (price / currentPrice) * currentFdv;
}

export async function enrichWithMarketCap(runners: Runner[], network = "solana"): Promise<void> {
  for (const [i, r] of runners.entries()) {
    const range = await fetchDayRange(r.poolAddress, network);

    if (range && r.priceUsd > 0) {
      const low = mcapAtPrice(range.low, r.priceUsd, r.fdvUsd);
      const high = mcapAtPrice(range.high, r.priceUsd, r.fdvUsd);
      r.mcap = {
        current: Math.round(r.fdvUsd),
        low: Math.round(low),
        high: Math.round(high),
        multiple: low > 0 ? Number((high / low).toFixed(1)) : 0,
        peakAt: range.peakAt,
      };
    } else {
      r.mcap = null;
    }

    const shown = r.mcap ? `${r.mcap.multiple}x` : "unavailable";
    console.log(`  mcap ${i + 1}/${runners.length} ${r.symbol}: ${shown}`);

    if (i < runners.length - 1) await sleep(REQUEST_DELAY_MS);
  }
}

/**
 * Attaches per-wallet trader data. No-ops without a Birdeye key, leaving
 * `traders: null` so the site can distinguish "not fetched" from "none found".
 *
 * Returns how many runners got trader data, for the snapshot stats.
 */
export async function enrichWithTraders(
  runners: Runner[],
  cfg: FilterConfig,
  window: { from: string; to: string },
): Promise<number | null> {
  if (!hasApiKey()) {
    console.log("  no BIRDEYE_API_KEY — skipping trader enrichment");
    return null;
  }

  let fetched = 0;
  for (const [i, r] of runners.entries()) {
    const traders = await fetchTopTraders(
      r.baseTokenId.replace(/^solana_/, ""),
      cfg.maxTradersPerRunner,
      window.from,
      window.to,
      cfg.botTags,
    );

    if (traders) {
      r.traders = traders;
      // Bots are excluded from the winner count: on one live runner all 8 top
      // wallets were bundlers with negative realised P&L, so counting them as
      // winners would have been actively misleading.
      r.bigWinners = traders.filter((t) => !t.isBot && t.pnlUsd >= cfg.bigWinnerPnlUsd).length;
      r.botTraders = traders.filter((t) => t.isBot).length;
      fetched++;
      console.log(
        `  traders ${i + 1}/${runners.length} ${r.symbol}: ` +
          `${traders.length} found, ${r.bigWinners} real winners over ` +
          `$${(cfg.bigWinnerPnlUsd / 1000).toFixed(0)}k, ${r.botTraders} bots`,
      );
    } else {
      console.log(`  traders ${i + 1}/${runners.length} ${r.symbol}: unavailable`);
    }

    if (i < runners.length - 1) await sleep(RATE_LIMIT_MS);
  }
  return fetched;
}
