/**
 * Snapshot schema.
 *
 * DESIGN RULE: the FOMO integration must only ever *fill in* fields, never
 * reshape them. Every trader-layer and thesis-layer field therefore exists from
 * day one as nullable. When permission lands we populate `Trader.handle`,
 * `Trader.thesis` and `Trader.followers` — no migration, no renderer rewrite,
 * and old snapshots stay readable.
 *
 * Bump SCHEMA_VERSION on any breaking change and keep readers tolerant of older
 * versions rather than rewriting history: snapshots are an append-only archive.
 */

export const SCHEMA_VERSION = 2;

export interface RawPool {
  poolAddress: string;
  name: string;
  dex: string;
  baseTokenId: string;
  quoteTokenId: string;
  createdAt: string | null;
  priceUsd: number;
  fdvUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  change: { m5: number; h1: number; h6: number; h24: number };
  txns24h: { buys: number; sells: number; buyers: number; sellers: number };
  /** Which discovery pass surfaced this pool. A pool can be found by both. */
  sources: Array<"volume" | "trending">;
}

/**
 * A single trader's result on one token.
 *
 * `wallet` and `pnlUsd` come from on-chain data. The remaining fields are the
 * FOMO layer and stay null until we have written permission — they are the
 * reason this product isn't just another leaderboard.
 */
export interface Trader {
  wallet: string;
  /** Realised + unrealised, i.e. what the position is actually worth to them. */
  pnlUsd: number;
  realizedPnlUsd: number;
  volumeUsd: number;
  trades: number;
  /**
   * Source-provided labels, e.g. "bundler". These mark MEV/sniper infrastructure
   * rather than discretionary traders — the highest-volume wallets on a token are
   * routinely bundlers turning millions of volume into three-figure profit.
   */
  tags: string[];
  /**
   * True for MEV/sniper infrastructure rather than discretionary traders.
   * Derived from `tags`; these wallets are shown but excluded from winner counts.
   */
  isBot: boolean;
  /** ISO timestamps, when derivable and inside the snapshot window. */
  firstBuyAt: string | null;
  lastSellAt: string | null;

  // ---- FOMO layer: populated only with permission ----
  handle: string | null;
  thesis: string | null;
  thesisPostedAt: string | null;
  followers: number | null;
}

/** Market-cap range for the day, in the units traders actually speak in. */
export interface McapRange {
  current: number;
  low: number;
  high: number;
  multiple: number;
  /** When the intraday high printed — drives the day timeline. */
  peakAt: string | null;
}

/**
 * What a token is paired against — the catalyst format traders actually use.
 *
 * On launchpads like stonk.fun a coin is launched *paired* to another asset,
 * and that pairing IS the reason it moved: "$KNOTS hit $45m, paired with
 * $stonk" says more than any price figure can.
 *
 * It is also mechanically derivable, which makes it the rare catalyst that
 * needs no model and no platform data. On 2026-09-11 the STONK/KNOTS pool did
 * $6.9m of volume against $3.1m in KNOTS/SOL — the pairing was the dominant
 * venue, and the pipeline recorded only the SOL side.
 */
export interface Pairing {
  /** The other side, e.g. "STONK". Never a pricing venue like SOL or USDC. */
  symbol: string;
  /** Combined 24h volume across every pool quoting this pair. */
  volumeUsd: number;
  /** Share of the token's total pool volume running through this pairing. */
  share: number;
  /** True when the pairing out-trades the SOL and stablecoin venues combined. */
  dominant: boolean;
}

/** A pool that survived filtering, with derived signals attached. */
export interface Runner extends RawPool {
  symbol: string;
  ageDays: number | null;
  /** 24h volume / current liquidity. Very high values suggest wash trading. */
  churn: number;
  /** Unique buyers / unique sellers over 24h. */
  buyerSellerRatio: number;
  /**
   * Trades per unique wallet. Humans place a handful of trades a day; values in
   * the hundreds mean a small set of wallets is cycling the token algorithmically.
   */
  buysPerBuyer: number;
  sellsPerSeller: number;
  score: number;
  /** Non-fatal quality warnings, surfaced in the UI rather than silently dropped. */
  flags: string[];
  /** Null when the OHLCV lookup failed. */
  mcap: McapRange | null;
  /**
   * What this token is paired against, when it is paired with anything other
   * than a pricing venue. Null means SOL/stables only — an ordinary launch.
   */
  pairing: Pairing | null;

  // ---- trader layer: null until a Birdeye key is configured ----
  /** Ranked by PnL descending. Null means "not fetched", [] means "none found". */
  traders: Trader[] | null;
  /**
   * How many *non-bot* wallets cleared the P&L bar. Null when unknown.
   * Bots are excluded deliberately — see FilterConfig.botTags.
   */
  bigWinners: number | null;
  /** How many of the returned top wallets were infrastructure. */
  botTraders: number | null;
}

export interface Snapshot {
  schemaVersion: number;
  /** UTC date, YYYY-MM-DD. One snapshot per day. */
  date: string;
  generatedAt: string;
  network: string;
  /** The 24h window this snapshot covers, so the timeline has fixed bounds. */
  window: { from: string; to: string };
  config: FilterConfig;
  stats: {
    poolsScanned: number;
    afterDedupe: number;
    afterFilters: number;
    runnersKept: number;
    /** Null when trader data wasn't fetched. */
    tradersFetched: number | null;
  };
  runners: Runner[];
}

// ===========================================================================
// fomo layer — PLATFORM-SOURCED, NEVER ARCHIVED
//
// Read under read-only permission granted 2026-09-11. Storage was explicitly
// NOT granted, so nothing below may reach data/. It lives in memory during a
// run and in the gitignored render, then is dropped.
//
// Source today is a manual export (you paste a profile page, we parse it).
// The parser's *output shape* is the contract, so when read-only API access
// lands it becomes a drop-in swap with no downstream changes.
//
// Note these are NOT part of Snapshot. That is deliberate: a type that cannot
// be reached from Snapshot cannot be accidentally serialised into the archive.
// ===========================================================================

/** One swap from a trader's history. */
export interface FomoTrade {
  symbol: string;
  action: "buy" | "sell";
  amountUsd: number;
  /** Market cap at the time of the trade — the unit fomo displays in. */
  mcapUsd: number | null;
  /** Source shows relative ages ("17m"), so this is minutes before exportedAt. */
  agoMinutes: number | null;
  /** Absolute time, derived from agoMinutes + exportedAt. */
  at: string | null;
}

/**
 * A trader's written call on a token. The reason this product exists.
 *
 * `author` and `likes` are what make a thesis rankable. A token's feed is
 * mostly noise ("$STONK to the moon", "breh") with a few posts that actually
 * say something; without the author's stake and the crowd's reaction there is
 * no way to tell them apart, and the recap ends up quoting the loudest rather
 * than the most informative.
 */
export interface FomoThesis {
  symbol: string;
  /** Who wrote it. Null on a single-trader export where the author is implicit. */
  author: string | null;
  text: string;
  agoMinutes: number | null;
  at: string | null;
  /** The author's P&L on this position — their stake in being right. */
  pnlUsd: number | null;
  changePct: number | null;
  /** Crowd reaction. Null when the export didn't include a count. */
  likes: number | null;
  /** Whether the position was closed when the thesis was shown. */
  closed: boolean;
}

/** An open position on a trader's profile. */
export interface FomoPosition {
  symbol: string;
  valueUsd: number;
  changePct: number | null;
}

/**
 * One trader's profile as exported. Every field here is platform-sourced.
 *
 * `parseWarnings` is load-bearing: the source is a rendered page, so layout
 * changes degrade parsing silently unless surfaced. A run that parses zero
 * trades should say so loudly rather than render an empty day.
 */
export interface TraderDay {
  handle: string;
  displayName: string | null;
  followers: number | null;
  following: number | null;
  bio: string | null;
  portfolioUsd: number | null;
  pnl24hUsd: number | null;
  tradeCount: number | null;
  avgHold: string | null;
  trades: FomoTrade[];
  theses: FomoThesis[];
  positions: FomoPosition[];
  exportedAt: string;
  parseWarnings: string[];
}

/**
 * A trader-led token matched to a real pool.
 *
 * `mcapRatio` is a confidence measure, not decoration: it is how far on-chain
 * FDV sat from the cap fomo reported at trade time. A resolution at 1.2x is
 * near-certain; the renderer should hedge above ~3x.
 */
export interface OnchainMatch {
  poolAddress: string;
  name: string;
  fdvUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd: number;
  createdAt: string | null;
  mcapRatio: number | null;
  /** Intraday range, when OHLCV was fetched. */
  mcap: McapRange | null;
}

/**
 * A token surfaced because notable traders bought it — the inverted pipeline.
 *
 * The old pipeline asked "what has a big market cap?" and used that as a proxy
 * for "worth writing about". This asks "did people with real followings put
 * real money in and explain why?", which is a far better proxy and is why the
 * $1m FDV floor does not apply here. Median cap fomo traders actually trade is
 * ~$72k — 14x below that floor.
 */
export interface TraderLedToken {
  symbol: string;
  /** Handles that bought, most-recent first. */
  buyers: string[];
  buyCount: number;
  sellCount: number;
  totalBuyUsd: number;
  totalSellUsd: number;
  theses: FomoThesis[];
  /** Combined follower count of everyone who bought — attention, not price. */
  followerReach: number;
  firstBuyMcapUsd: number | null;
  lastTradeMcapUsd: number | null;
  firstBuyAt: string | null;
  /**
   * Null means the ticker could not be verified on-chain — either no pool with
   * that exact ticker, or none whose market cap was close enough to be the one
   * actually traded. Rendered as unverified rather than guessed at.
   */
  onchain: OnchainMatch | null;
}

export interface FilterConfig {
  /** Quote tokens whose price we trust as a USD proxy. Cross-pairs distort the % change. */
  allowedQuoteSymbols: string[];
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  /**
   * Market-cap floor. Without it the list fills with sub-$500k coins doing 2x,
   * which nobody writes recaps about — the reference recaps headline $16m-$700m
   * tokens and rarely go below ~$1m.
   */
  minFdvUsd: number;
  minChange24hPct: number;
  minBuyers24h: number;
  /**
   * Churn (24h volume / liquidity) above which we flag possible wash trading.
   * Age-scaled: a token that launched hours ago legitimately churns hundreds of
   * times its liquidity, so a flat threshold flags every new launch and tells you
   * nothing. Established tokens doing the same are far more suspicious.
   */
  churnWarnThresholdNew: number;
  churnWarnThresholdEstablished: number;
  /** Age in days at which a token stops being treated as a fresh launch. */
  establishedAfterDays: number;
  /** Trades-per-wallet above which one side of the book looks bot-driven. */
  botTradesPerWalletThreshold: number;
  /** A trader counts as a "big winner" at or above this P&L. */
  bigWinnerPnlUsd: number;
  /**
   * Tags marking a wallet as infrastructure rather than a trader. Live data showed
   * all 8 top wallets on one runner tagged "bundler", each with ~2,900 trades and
   * negative realised P&L — counting those as winners would be actively misleading.
   */
  botTags: string[];
  /**
   * How many coins reach the page. The reference recaps carry 40+ across a
   * dozen sections; a top-10 reads as a leaderboard, which is the thing this
   * product is explicitly not. Each runner costs ~2 keyless requests, so this
   * is a time budget as much as an editorial one.
   */
  maxRunners: number;
  /** How many traders to keep per coin. */
  maxTradersPerRunner: number;
}

export const DEFAULT_FILTERS: FilterConfig = {
  allowedQuoteSymbols: ["SOL", "USDC", "USDT"],
  minLiquidityUsd: 50_000,
  minVolume24hUsd: 250_000,
  minFdvUsd: 1_000_000,
  minChange24hPct: 30,
  minBuyers24h: 150,
  churnWarnThresholdNew: 400,
  churnWarnThresholdEstablished: 50,
  establishedAfterDays: 2,
  botTradesPerWalletThreshold: 50,
  bigWinnerPnlUsd: 10_000,
  botTags: ["bundler", "dev"],
  maxRunners: 24,
  maxTradersPerRunner: 8,
};
