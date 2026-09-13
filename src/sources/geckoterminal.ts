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

import type { RawPool, Pairing } from "../types.ts";

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
    let high = 0;
    let peakTs: number | null = null;
    const lows: number[] = [];

    for (const c of candles) {
      const [ts, , h, l] = c;
      if (typeof h === "number" && h > high) {
        high = h;
        peakTs = typeof ts === "number" ? ts : null;
      }
      if (typeof l === "number" && l > 0) lows.push(l);
    }
    if (high <= 0 || lows.length === 0) return null;

    lows.sort((a, b) => a - b);
    const low = lows[0]!;

    // NOTE: for a token that launched inside this window, `low` is its first
    // print — often a fraction of a cent before any market exists. A multiple
    // off that number is meaningless by construction, and no heuristic here can
    // rescue it. Callers must not quote a multiple for a fresh launch; see
    // McapRange.multiple. Two attempts to fix it at this layer (second-lowest
    // candle, then a low percentile) both failed, because a token minting into
    // an empty pool prints a cluster of junk candles, not one.

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
/**
 * The candidate universe.
 *
 * Partial results beat no results. A snapshot is a point-in-time record that
 * cannot be reconstructed later, so losing a whole day because page 7 of 10
 * rate-limited would be a permanent hole in the archive for a recoverable
 * problem. Failed pages are warned about and skipped.
 *
 * The exception is an empty universe: an empty snapshot is not a thin day, it
 * is a false record of one. That still throws.
 */
export async function fetchCandidatePools(network = "solana"): Promise<RawPool[]> {
  const out: RawPool[] = [];
  const failures: number[] = [];

  for (let page = 1; page <= MAX_PAGE; page++) {
    try {
      const json = await getJson(
        `/networks/${network}/pools?sort=h24_volume_usd_desc&page=${page}`,
      );
      const pools = (json?.data ?? [])
        .map((p: any) => toRawPool(p, "volume"))
        .filter(Boolean) as RawPool[];
      out.push(...pools);
      console.log(`  volume page ${page}: +${pools.length} (total ${out.length})`);
      if (pools.length === 0) break;
    } catch (err) {
      failures.push(page);
      console.warn(`  volume page ${page} failed: ${(err as Error).message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  try {
    const trending = await getJson(`/networks/${network}/trending_pools?duration=24h`);
    const trendingPools = (trending?.data ?? [])
      .map((p: any) => toRawPool(p, "trending"))
      .filter(Boolean) as RawPool[];
    out.push(...trendingPools);
    console.log(`  trending: +${trendingPools.length} (total ${out.length})`);
  } catch (err) {
    console.warn(`  trending failed: ${(err as Error).message}`);
  }

  if (failures.length > 0) {
    console.warn(
      `  NOTE: ${failures.length} page(s) failed (${failures.join(", ")}) — ` +
        `the universe is incomplete and today's coverage may be thinner than usual.`,
    );
  }
  if (out.length === 0) {
    throw new Error(
      "No pools fetched at all. Refusing to write an empty snapshot — " +
        "an empty day and a failed fetch must not look the same in the archive.",
    );
  }

  return out;
}

/**
 * Collapses multiple pools of the same base token into one, keeping the deepest
 * pool. Necessary because a token like STONK routinely appears 2-3 times across
 * different DEXes and would otherwise occupy several recap slots.
 */
/**
 * One pool per token, preferring one we can price.
 *
 * Depth alone is the wrong tiebreak. Discovery only accepts SOL and stablecoin
 * quotes — a cross-pair denominates its percentage change in another volatile
 * token, so the number does not mean what it looks like — but this function runs
 * FIRST. Picking the deepest pool regardless of quote therefore handed the
 * filters a cross-pair and they dropped the token entirely.
 *
 * It cost exactly the coins whose pairing is the story. On 2026-09-10 that was
 * RAYCAT (deepest pool RAYCAT/RAY, $15m cap, +399%) and BTC (BTC/WBTC, $14m) —
 * both of which had perfectly good SOL pools we never looked at, and both of
 * which the reference recap led a section with.
 *
 * So: prefer a priceable quote, and only fall back to depth within that class.
 * The pairing is recovered separately by enrichWithPairings, which reads every
 * pool the token trades in rather than just this one.
 */
export function dedupeByBaseToken(
  pools: RawPool[],
  priceableQuotes: string[] = ["SOL", "USDC", "USDT"],
): RawPool[] {
  const allowed = new Set(priceableQuotes.map((q) => q.toLowerCase()));
  const priceable = (p: RawPool) => allowed.has(splitPoolName(p.name).quote.toLowerCase());

  const best = new Map<string, RawPool>();

  for (const pool of pools) {
    const existing = best.get(pool.baseTokenId);
    if (!existing) {
      best.set(pool.baseTokenId, { ...pool });
      continue;
    }

    const sources = Array.from(new Set([...existing.sources, ...pool.sources]));
    const a = priceable(existing);
    const b = priceable(pool);

    // Priceable beats deep; depth decides only within the same class.
    const winner =
      a !== b ? (b ? pool : existing) : pool.liquidityUsd > existing.liquidityUsd ? pool : existing;

    best.set(pool.baseTokenId, { ...winner, sources });
  }

  return [...best.values()];
}

export { splitPoolName };

// ===========================================================================
// Symbol resolution — the bridge from trader-led discovery to on-chain data
//
// Trader exports give a ticker and the market cap fomo showed at trade time.
// Neither alone is enough to identify a token, because tickers collide badly:
// searching "ONYC" returns a $310m established token AND the $47k microcap a
// trader actually bought. Picking the top hit would publish a fabrication.
//
// The market cap is the disambiguator. Measured against real trades, exact
// ticker + nearest FDV resolved every symbol within 1.6x, while rejecting the
// ONYC imposter at 9,896x off.
// ===========================================================================

export interface PoolCandidate {
  poolAddress: string;
  name: string;
  baseSymbol: string;
  fdvUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number;
  createdAt: string | null;
}

export interface ResolvedToken extends PoolCandidate {
  /** How far on-chain FDV sat from the caller's hint, as a multiple >= 1. */
  mcapRatio: number | null;
}

/** Widest gap between reported and on-chain market cap we will still accept. */
export const MAX_MCAP_RATIO = 5;

function toCandidate(p: any): PoolCandidate | null {
  const a = p?.attributes;
  const addr = a?.address ?? p?.id;
  if (!a || typeof addr !== "string") return null;
  return {
    poolAddress: addr.replace(/^solana_/, ""),
    name: String(a.name ?? ""),
    baseSymbol: String(a.name ?? "").split("/")[0]!.trim(),
    fdvUsd: num(a.fdv_usd),
    liquidityUsd: num(a.reserve_in_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    priceUsd: num(a.base_token_price_usd),
    createdAt: typeof a.pool_created_at === "string" ? a.pool_created_at : null,
  };
}

/**
 * Pick the pool a trader actually traded.
 *
 * Pure so the judgement is testable without the network — this decides what
 * gets published, so it needs pinning down more than the fetch does.
 *
 * Order of operations matters:
 *   1. Exact ticker only. Fuzzy matching invents tokens.
 *   2. Market cap within tolerance. This is what rejects ticker squatters.
 *   3. Deepest liquidity among survivors — several correctly-matched pools are
 *      abandoned shells with ~$0 reserves; the live one is the real market.
 *
 * Returns null rather than a best guess. An unresolved token renders as
 * "couldn't verify on-chain", which is honest; a wrong token is a fabrication.
 */
export function selectBestPool(
  candidates: PoolCandidate[],
  symbol: string,
  mcapHintUsd: number | null,
  maxRatio = MAX_MCAP_RATIO,
): ResolvedToken | null {
  const want = symbol.trim().toLowerCase();
  const exact = candidates.filter((c) => c.baseSymbol.toLowerCase() === want);
  if (exact.length === 0) return null;

  const withRatio = exact.map((c) => ({
    ...c,
    mcapRatio:
      mcapHintUsd === null || mcapHintUsd <= 0 || c.fdvUsd <= 0
        ? null
        : Math.max(c.fdvUsd / mcapHintUsd, mcapHintUsd / c.fdvUsd),
  }));

  // No hint: fall back to the deepest pool for that ticker.
  if (mcapHintUsd === null || mcapHintUsd <= 0) {
    return withRatio.sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0] ?? null;
  }

  const plausible = withRatio.filter((c) => c.mcapRatio !== null && c.mcapRatio <= maxRatio);
  if (plausible.length === 0) return null;

  return plausible.sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0]!;
}

/**
 * Resolve a ticker + reported market cap to a real Solana pool.
 * One request; callers must space them by REQUEST_DELAY_MS.
 */
export async function resolveTokenBySymbol(
  symbol: string,
  mcapHintUsd: number | null,
  network = "solana",
): Promise<ResolvedToken | null> {
  const q = encodeURIComponent(symbol.trim());
  const json = await getJson(`/search/pools?query=${q}&network=${network}&page=1`);
  const candidates = (json?.data ?? [])
    .map(toCandidate)
    .filter((c: PoolCandidate | null): c is PoolCandidate => c !== null);
  return selectBestPool(candidates, symbol, mcapHintUsd);
}

export { REQUEST_DELAY_MS, sleep };

// ===========================================================================
// Pairing detection
//
// `allowedQuoteSymbols` keeps discovery on SOL/stable pools, which is correct
// for PRICE: a cross-pair quotes its change in another volatile token, so the
// percentage does not mean what it appears to. But filtering those pools threw
// away the pairing *fact* along with the distorted price, and the pairing is
// the single most common catalyst in the recaps this product is modelled on.
//
// So: price still comes from the SOL pool, and the pairing comes from asking
// what else the token trades against. One extra request per runner.
// ===========================================================================

/**
 * Below these a pairing is not a catalyst. See the reasoning in derivePairing:
 * the share floor is what keeps the relationship pointing the right way.
 */
export const MIN_PAIRING_SHARE = 0.15;
export const MIN_PAIRING_VOLUME_USD = 25_000;

/** Venues a token trades against for pricing rather than for narrative. */
const PRICING_VENUES = new Set([
  "sol", "wsol", "usdc", "usdt", "usdg", "usd1", "jitosol", "msol", "bsol", "weth", "wbtc",
]);

/**
 * The other side of a pool, given the token we care about.
 * Pool names read "BASE / QUOTE", and our token may be on either side —
 * KNOTS' biggest pool is named "STONK / KNOTS".
 */
export function otherSide(poolName: string, symbol: string): string | null {
  const parts = poolName.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const want = symbol.trim().toLowerCase();
  const [a, b] = parts as [string, string];
  if (a.toLowerCase() === want) return b;
  if (b.toLowerCase() === want) return a;
  return null;
}

export interface PoolVenue {
  name: string;
  volume24hUsd: number;
}

/**
 * Pure so the judgement is testable without the network.
 *
 * Ranks by combined volume because a pairing routinely spans several pools of
 * different depths — KNOTS/STONK existed four times over, and only the sum
 * shows it beating the SOL venue.
 */
export function derivePairing(pools: PoolVenue[], symbol: string): Pairing | null {
  const byQuote = new Map<string, number>();
  let total = 0;

  for (const p of pools) {
    const other = otherSide(p.name, symbol);
    if (!other) continue;
    total += p.volume24hUsd;
    const key = other.toLowerCase();
    byQuote.set(key, (byQuote.get(key) ?? 0) + p.volume24hUsd);
  }
  if (total <= 0) return null;

  let best: { symbol: string; volumeUsd: number } | null = null;
  let pricingVolume = 0;

  for (const [key, vol] of byQuote) {
    if (PRICING_VENUES.has(key)) {
      pricingVolume += vol;
      continue;
    }
    if (!best || vol > best.volumeUsd) {
      // Recover the original casing; traders write $STONK, not $stonk.
      const cased = pools.map((p) => otherSide(p.name, symbol)).find((o) => o?.toLowerCase() === key);
      best = { symbol: cased ?? key, volumeUsd: vol };
    }
  }
  if (!best) return null;

  const share = best.volumeUsd / total;

  // Materiality, which also resolves DIRECTION.
  //
  // A pairing is a relationship between unequals: KNOTS was launched against
  // STONK, not the reverse. Both tokens see the same pools, so without a floor
  // the pipeline reports "$STONK paired with $KNOTS" — true as arithmetic,
  // backwards as a claim, and the opposite of what a recap would say.
  //
  // Share settles it. That pair is 60% of KNOTS' volume and 7% of STONK's:
  // the smaller token depends on the pairing, the larger one does not.
  //
  // The floor also drops dust. Several runners had sub-$5k pools whose only
  // effect would be to attach a confident-sounding catalyst to a move that had
  // nothing to do with them.
  if (share < MIN_PAIRING_SHARE || best.volumeUsd < MIN_PAIRING_VOLUME_USD) return null;

  return {
    symbol: best.symbol,
    volumeUsd: best.volumeUsd,
    share,
    dominant: best.volumeUsd > pricingVolume,
  };
}

/** Every pool a token trades in. One request; space calls by REQUEST_DELAY_MS. */
export async function fetchTokenPairing(
  tokenAddress: string,
  symbol: string,
  network = "solana",
): Promise<Pairing | null> {
  const addr = tokenAddress.replace(/^solana_/, "");
  const json = await getJson(`/networks/${network}/tokens/${addr}/pools?page=1`);
  const pools: PoolVenue[] = (json?.data ?? []).map((p: any) => ({
    name: String(p?.attributes?.name ?? ""),
    volume24hUsd: num(p?.attributes?.volume_usd?.h24),
  }));
  return derivePairing(pools, symbol);
}

/**
 * What a project says it is.
 *
 * Only worth calling for tokens that have no other catalyst — it is a third
 * request per runner, and most memecoins 404 here because they have no metadata
 * at all. Returns null rather than throwing: a missing description degrades one
 * line, it should not cost the run.
 */
export async function fetchTokenDescription(
  tokenAddress: string,
  network = "solana",
): Promise<string | null> {
  const addr = tokenAddress.replace(/^solana_/, "");
  try {
    const json = await getJson(`/networks/${network}/tokens/${addr}/info`);
    const raw = json?.data?.attributes?.description;
    if (typeof raw !== "string") return null;

    const text = raw.replace(/\s+/g, " ").trim();
    if (text.length < 12) return null;

    // One sentence. These are marketing copy and run long; the recap has room
    // for a clause, not a pitch.
    const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
    return firstSentence.length > 180 ? firstSentence.slice(0, 177) + "..." : firstSentence;
  } catch {
    return null;
  }
}
