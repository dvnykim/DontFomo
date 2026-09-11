/**
 * Birdeye — per-wallet trader data.
 *
 * This is the only source that can answer "who caught it and what did they make",
 * which GeckoTerminal cannot: it exposes pool aggregates only, so it can say 2,031
 * wallets bought but not which wallets or what any of them made.
 *
 * Requires BIRDEYE_API_KEY. Without one every call short-circuits and runners keep
 * `traders: null`, so the pipeline still produces a valid snapshot — the site just
 * renders empty states. Free tier is 30k CU/month at 1 RPS.
 *
 * Response fields VERIFIED against a live 200 response:
 *   owner, tags[], trade, tradeBuy, tradeSell, volume (TOKEN UNITS),
 *   volumeUsd, totalPnl, realizedPnl, unrealizedPnl,
 *   firstTradeUnixTime, lastTradeUnixTime
 */

import type { Trader } from "../types.ts";

const BASE = "https://public-api.birdeye.so";
const RATE_LIMIT_MS = 1_100; // free tier is 1 request/second

/**
 * The API only accepts sort_by=volume — sort_by=pnl returns 400 "invalid format" —
 * and the highest-volume wallets are overwhelmingly bots. A live sample's top 5 by
 * volume made -$1,960, +$539, +$103, +$147 and -$52, two of them tagged "bundler".
 * So over-fetch by volume and rank by P&L locally.
 *
 * `limit` is capped server-side: limit=5 returns 200 but limit=50 returns 400, so
 * we request OVERFETCH and fall back to SAFE_LIMIT once if rejected.
 *
 * ⚠️ Known limitation: because results are volume-sorted and the cap is low, a
 * genuine big winner who traded modest size can fall outside the returned set
 * entirely. Trader lists are therefore "top winners among the highest-volume
 * wallets", not "top winners overall".
 */
const OVERFETCH = 20;
const SAFE_LIMIT = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function hasApiKey(): boolean {
  return Boolean(process.env.BIRDEYE_API_KEY);
}

function n(v: unknown): number {
  const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : 0;
}

/**
 * Unix seconds → ISO, but only if it lands inside the snapshot window.
 * `firstTradeUnixTime` appears to be wallet-scoped rather than token-scoped — a
 * live sample returned a 2024 timestamp for a token that launched this year — so
 * out-of-window values are dropped rather than shown as this token's activity.
 */
function isoInWindow(unixSeconds: unknown, from: number, to: number): string | null {
  const s = n(unixSeconds);
  if (s <= 0) return null;
  const ms = s * 1000;
  return ms < from || ms > to ? null : new Date(ms).toISOString();
}

function toTrader(
  raw: Record<string, unknown>,
  from: number,
  to: number,
  botTags: string[],
): Trader | null {
  const wallet = typeof raw.owner === "string" ? raw.owner : null;
  if (!wallet) return null;

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === "string")
    : [];

  return {
    wallet,
    isBot: tags.some((t) => botTags.includes(t)),
    pnlUsd: n(raw.totalPnl),
    realizedPnlUsd: n(raw.realizedPnl),
    volumeUsd: n(raw.volumeUsd), // NOT `volume`, which is denominated in token units
    trades: n(raw.trade),
    tags,
    firstBuyAt: isoInWindow(raw.firstTradeUnixTime, from, to),
    lastSellAt: isoInWindow(raw.lastTradeUnixTime, from, to),
    // FOMO layer — stays null until we have written permission.
    handle: null,
    thesis: null,
    thesisPostedAt: null,
    followers: null,
  };
}

/**
 * Top traders for one token over the last 24h, ranked by PnL descending.
 * Returns null when no key is configured or the request fails, so callers can
 * distinguish "not fetched" from "fetched, nobody qualified".
 */
export async function fetchTopTraders(
  tokenAddress: string,
  limit: number,
  windowFrom: string,
  windowTo: string,
  botTags: string[],
  chain = "solana",
): Promise<Trader[] | null> {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key) return null;

  const request = (n: number) =>
    fetch(
      `${BASE}/defi/v2/tokens/top_traders?address=${tokenAddress}` +
        `&time_frame=24h&sort_type=desc&sort_by=volume&limit=${n}`,
      { headers: { "X-API-KEY": key, "x-chain": chain, Accept: "application/json" } },
    );

  try {
    let res = await request(OVERFETCH);

    // A 400 here is usually the server-side limit cap rather than a bad address,
    // so retry once smaller before giving up on the token.
    if (res.status === 400) {
      await sleep(RATE_LIMIT_MS);
      res = await request(SAFE_LIMIT);
    }

    if (res.status === 401) {
      console.warn("  birdeye: unauthorized — check BIRDEYE_API_KEY");
      return null;
    }
    if (res.status === 429) {
      console.warn("  birdeye: rate limited, backing off");
      await sleep(RATE_LIMIT_MS * 4);
      return null;
    }
    if (!res.ok) {
      // Surface the API's own message — it's specific and saves a lot of guessing.
      const body = await res.text().catch(() => "");
      console.warn(`  birdeye: HTTP ${res.status} ${body.slice(0, 120)}`);
      return null;
    }

    const json = (await res.json()) as any;
    const items: unknown[] = json?.data?.items ?? [];
    if (!Array.isArray(items)) return null;

    const from = new Date(windowFrom).getTime();
    const to = new Date(windowTo).getTime();

    const traders = items
      .map((i) => toTrader(i as Record<string, unknown>, from, to, botTags))
      .filter((t): t is Trader => t !== null);

    // Real traders first, then bots — both kept, because "every top wallet here
    // was a bundler" is itself the story on a lot of these launches.
    return traders
      .sort((a, b) => Number(a.isBot) - Number(b.isBot) || b.pnlUsd - a.pnlUsd)
      .slice(0, limit);
  } catch (err) {
    console.warn(`  birdeye failed for ${tokenAddress}: ${(err as Error).message}`);
    return null;
  }
}

export { RATE_LIMIT_MS, OVERFETCH };
