/**
 * GeckoTerminal keyless public API.
 *
 * Two constraints discovered by testing, both of which shape the pipeline:
 *   1. `sort` only accepts h24_volume_usd_desc | h24_tx_count_desc. There is NO
 *      sort by price change, so top gainers must be computed client-side.
 *   2. Pagination hard-stops at page 10 (20 per page => 200 pool ceiling).
 *
 * Rate limit is ~10 req/min keyless, so calls are serialized with a delay.
 */

import type { RawPool } from "../types.ts";

const BASE = "https://api.geckoterminal.com/api/v2";
// 10 req/min keyless. 7s leaves headroom; at 6.5s the run reliably tripped a 429
// partway through pagination and had to burn ~40s on backoff.
const REQUEST_DELAY_MS = 7_000;
const MAX_PAGE = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

async function getJson(path: string, attempt = 1): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });

  // 429 is expected under the keyless limit; back off and retry rather than losing the run.
  if (res.status === 429 && attempt <= 3) {
    const backoff = REQUEST_DELAY_MS * 2 * attempt;
    console.warn(`  rate limited on ${path}, retrying in ${backoff / 1000}s`);
    await sleep(backoff);
    return getJson(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status} on ${path}`);
  return res.json();
}

/**
 * Hourly candles for the last 24h.
 *
 * Needed because the recap format traders actually use quotes the intraday
 * low→high move ("$8m to $80m (10x)"), which is NOT the same as the 24h
 * open→close change the pools endpoint reports. For `baton` those were 7.0x
 * and 4.85x respectively.
 */
export async function fetchDayRange(
  poolAddress: string,
  network = "solana",
): Promise<{ low: number; high: number; peakAt: string | null } | null> {
  try {
    const json = await getJson(
      `/networks/${network}/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=24&currency=usd`,
    );
    const candles: number[][] = json?.data?.attributes?.ohlcv_list ?? [];
    if (candles.length === 0) return null;

    // Candle tuple: [timestamp, open, high, low, close, volume]
    let low = Infinity;
    let high = 0;
    let peakTs: number | null = null;

    for (const c of candles) {
      const [ts, , h, l] = c;
      if (typeof h === "number" && h > high) {
        high = h;
        peakTs = typeof ts === "number" ? ts : null;
      }
      if (typeof l === "number" && l > 0 && l < low) low = l;
    }
    if (high <= 0 || !Number.isFinite(low)) return null;

    // Hourly candles, so this resolves the peak to the hour it printed in.
    return { low, high, peakAt: peakTs === null ? null : new Date(peakTs * 1000).toISOString() };
  } catch (err) {
    // A missing range degrades the entry, it shouldn't kill the whole run.
    console.warn(`  ohlcv failed for ${poolAddress}: ${(err as Error).message}`);
    return null;
  }
}

/** Extracts the bare symbol from an "ABC / SOL" pool name. */
function splitPoolName(name: string): { base: string; quote: string } {
  const [base = "", quote = ""] = name.split("/").map((s) => s.trim());
  return { base, quote };
}

function toRawPool(p: any, source: "volume" | "trending"): RawPool | null {
  const a = p?.attributes;
  const r = p?.relationships;
  if (!a || !r?.base_token?.data?.id) return null;

  const ch = a.price_change_percentage ?? {};
  const tx = a.transactions?.h24 ?? {};

  return {
    poolAddress: a.address,
    name: a.name ?? "",
    dex: r.dex?.data?.id ?? "unknown",
    baseTokenId: r.base_token.data.id,
    quoteTokenId: r.quote_token?.data?.id ?? "",
    createdAt: a.pool_created_at ?? null,
    priceUsd: num(a.base_token_price_usd),
    fdvUsd: num(a.fdv_usd),
    liquidityUsd: num(a.reserve_in_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    change: { m5: num(ch.m5), h1: num(ch.h1), h6: num(ch.h6), h24: num(ch.h24) },
    txns24h: {
      buys: num(tx.buys),
      sells: num(tx.sells),
      buyers: num(tx.buyers),
      sellers: num(tx.sellers),
    },
    sources: [source],
  };
}

/**
 * Builds the candidate universe: the top 200 pools by 24h volume, plus the
 * trending list. Trending is included because it captures heat that pure volume
 * ranking misses — a token can run hard without cracking the volume top 200.
 */
export async function fetchCandidatePools(network = "solana"): Promise<RawPool[]> {
  const out: RawPool[] = [];

  for (let page = 1; page <= MAX_PAGE; page++) {
    const json = await getJson(
      `/networks/${network}/pools?sort=h24_volume_usd_desc&page=${page}`,
    );
    const pools = (json?.data ?? [])
      .map((p: any) => toRawPool(p, "volume"))
      .filter(Boolean) as RawPool[];
    out.push(...pools);
    console.log(`  volume page ${page}: +${pools.length} (total ${out.length})`);
    if (pools.length === 0) break;
    await sleep(REQUEST_DELAY_MS);
  }

  const trending = await getJson(`/networks/${network}/trending_pools?duration=24h`);
  const trendingPools = (trending?.data ?? [])
    .map((p: any) => toRawPool(p, "trending"))
    .filter(Boolean) as RawPool[];
  out.push(...trendingPools);
  console.log(`  trending: +${trendingPools.length} (total ${out.length})`);

  return out;
}

/**
 * Collapses multiple pools of the same base token into one, keeping the deepest
 * pool. Necessary because a token like STONK routinely appears 2-3 times across
 * different DEXes and would otherwise occupy several recap slots.
 */
export function dedupeByBaseToken(pools: RawPool[]): RawPool[] {
  const best = new Map<string, RawPool>();

  for (const pool of pools) {
    const existing = best.get(pool.baseTokenId);
    if (!existing) {
      best.set(pool.baseTokenId, { ...pool });
      continue;
    }
    // Preserve the union of discovery sources across merged duplicates.
    const sources = Array.from(new Set([...existing.sources, ...pool.sources]));
    const winner = pool.liquidityUsd > existing.liquidityUsd ? pool : existing;
    best.set(pool.baseTokenId, { ...winner, sources });
  }

  return [...best.values()];
}

export { splitPoolName };
