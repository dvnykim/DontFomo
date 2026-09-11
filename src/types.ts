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
  maxRunners: 10,
  maxTradersPerRunner: 8,
};
