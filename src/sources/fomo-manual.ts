/**
 * Manual fomo export parser.
 *
 * Reads the text of a rendered profile page (select-all, paste) and returns a
 * `TraderDay`. This exists because:
 *
 *   1. fomo is a client-rendered app with no REST API — profile data arrives
 *      over a WebSocket, so there is nothing to `fetch` in a cron job.
 *   2. The rendered page is only reachable behind a login, and that session can
 *      trade, withdraw and export the wallet. Putting such a credential in CI
 *      would be indefensible regardless of what the ToS permits.
 *
 * So a human exports, and this parses. When read-only API access lands, only
 * this file is replaced — `TraderDay` is the contract everything downstream
 * depends on.
 *
 * PARSING STRATEGY: sliding-window shape matching, not header anchoring. We do
 * not look for "All swaps" and count forward; we scan for any run of lines whose
 * *shapes* spell a trade. Headers and surrounding layout are the parts most
 * likely to change; the shape of a trade row is the part least likely to.
 *
 * Every parse emits warnings rather than throwing. A layout change should
 * degrade to "parsed 0 trades, here's why" — never to a silent empty day.
 */

import type { FomoTrade, FomoThesis, FomoPosition, TraderDay } from "../types.ts";

/** UI chrome that must never be mistaken for a token symbol. */
const NOISE = new Set([
  "buy", "sell", "thesis", "token", "action", "amount", "mcap", "time", "open",
  "closed", "all swaps", "buys", "sells", "position", "positions", "show dust",
  "send", "following", "followers", "mutuals", "share", "cash", "deposit more",
  "alerts", "tokens", "leaderboard", "feed", "traders", "filters", "recents",
  "clear all", "paste", "stable", "privacy", "terms", "help", "most liked",
  "split bottom", "split right", "total cash", "your positions", "dust",
]);

const isNoise = (s: string) => NOISE.has(s.trim().toLowerCase());

/** "$1,807.80" -> 1807.8 ; "$99.05" -> 99.05 */
export function parseUsd(s: string): number | null {
  const m = s.trim().match(/^\$?([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "$25.2K" -> 25200 ; "$10.6M" -> 10600000 ; "15,815" -> 15815 ; "4.9K" -> 4900 */
export function parseCompact(s: string): number | null {
  const m = s.trim().match(/^\$?([\d,]+(?:\.\d+)?)\s*([KMB])?$/i);
  if (!m) return null;
  const base = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase()] ?? 1;
  return base * mult;
}

/**
 * Relative ages as fomo renders them: "17m", "2h", "1d 5h", "30s".
 * Returns minutes. Seconds round to 0, which is correct — sub-minute precision
 * is noise at a daily cadence.
 */
export function parseAgo(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!/^(\d+\s*[smhd]\s*)+$/.test(t)) return null;
  let mins = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+)\s*([smhd])/g)) {
    matched = true;
    const n = Number(m[1]);
    mins += { s: n / 60, m: n, h: n * 60, d: n * 1440 }[m[2]!]!;
  }
  return matched ? Math.round(mins) : null;
}

/** "$25.1K MC" -> 25100 */
function parseMcapCell(s: string): number | null {
  const m = s.trim().match(/^(\$?[\d,.]+\s*[KMB]?)\s*MC$/i);
  return m ? parseCompact(m[1]!) : null;
}

function isoFrom(exportedAt: string, agoMinutes: number | null): string | null {
  if (agoMinutes === null) return null;
  const t = Date.parse(exportedAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t - agoMinutes * 60_000).toISOString();
}

/** Lines that are pure decoration around a number. */
const isDecor = (s: string) => /^[▲▼()%\s]*$/.test(s) || s.trim() === "?";

/**
 * Trades: five consecutive lines shaped
 *   <symbol> / Buy|Sell / $<amount> / $<n>K MC / <age>
 */
function parseTrades(lines: string[], exportedAt: string): FomoTrade[] {
  const out: FomoTrade[] = [];
  const seen = new Set<string>();

  for (let i = 0; i + 4 < lines.length; i++) {
    const [sym, act, amt, cap, age] = lines.slice(i, i + 5) as [string, string, string, string, string];
    const action = act.trim().toLowerCase();
    if (action !== "buy" && action !== "sell") continue;
    if (isNoise(sym) || !sym.trim()) continue;

    const amountUsd = parseUsd(amt);
    const mcapUsd = parseMcapCell(cap);
    const agoMinutes = parseAgo(age);
    if (amountUsd === null || mcapUsd === null || agoMinutes === null) continue;

    // The feed and the swaps table render the same trade twice with slightly
    // different rounding ($99.05 vs $100), so dedupe on the coarse shape.
    const key = `${sym}|${action}|${Math.round(amountUsd)}|${agoMinutes}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      symbol: sym.trim(),
      action,
      amountUsd,
      mcapUsd,
      agoMinutes,
      at: isoFrom(exportedAt, agoMinutes),
    });
    i += 4;
  }
  return out;
}

/** "154 older" / "3 newer" are pagination controls, not content. */
const PAGINATION = /^\d+\s+(older|newer)$/i;
const BARE_INT = /^\d[\d,]*$/;

/**
 * Theses, in both shapes fomo renders.
 *
 *   profile page:  <author> / Thesis / [Closed] / <age> / [?] / <symbol> / <$pnl> / … / <text…> / <likes>
 *   token page:    <author> / Thesis / [Closed] / <age> / <$pnl> / … / <text…> / <likes>
 *
 * On a token page every thesis is about that token, so no symbol is rendered —
 * hence `defaultSymbol`. Distinguished by whether the line after the age parses
 * as a dollar amount.
 *
 * Text is accumulated across lines: the best theses are multi-paragraph, and
 * taking only the first line threw away most of what made them worth reading.
 */
function parseTheses(lines: string[], exportedAt: string, defaultSymbol: string | null): FomoThesis[] {
  const out: FomoThesis[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().toLowerCase() !== "thesis") continue;

    const author = i > 0 ? lines[i - 1]!.trim() : "";
    let j = i + 1;

    const closed = lines[j]?.trim().toLowerCase() === "closed";
    if (closed) j++;

    const agoMinutes = parseAgo(lines[j] ?? "");
    if (agoMinutes !== null) j++;

    while (j < lines.length && (isDecor(lines[j]!) || !lines[j]!.trim())) j++;

    // A dollar amount here means the token page, where the symbol is implicit.
    //
    // A figure of any shape means the same thing. Checking only for a dollar
    // amount let "3.58%" through as a ticker, which then became its own entry
    // in the recap — a percentage rendered as a coin.
    let symbol = defaultSymbol;
    const candidate = lines[j]?.trim();
    const looksNumeric = !candidate || /^[$−+-]?[\d,.]+\s*[%xkmb]?$/i.test(candidate);
    if (!looksNumeric && !isNoise(candidate)) {
      symbol = candidate;
      j++;
    }
    if (!symbol) continue;

    let pnlUsd: number | null = null;
    let changePct: number | null = null;
    let likes: number | null = null;
    const body: string[] = [];

    for (let k = j; k < Math.min(j + 40, lines.length); k++) {
      const line = lines[k]!.trim();
      if (!line || isDecor(line)) continue;
      if (PAGINATION.test(line)) break;

      if (body.length === 0) {
        // Header block: P&L and percentage come before any prose.
        const usd = parseUsd(line);
        if (usd !== null && pnlUsd === null) { pnlUsd = usd; continue; }
        const pct = line.match(/^([\d,.]+)\s*%$/);
        if (pct && changePct === null) { changePct = Number(pct[1]!.replace(/,/g, "")); continue; }
      }

      // A bare integer after prose has started is the like count, and ends it.
      if (BARE_INT.test(line)) {
        if (body.length > 0) { likes = Number(line.replace(/,/g, "")); break; }
        continue;
      }
      body.push(line);
    }

    const text = body.join(" ").trim();
    if (!text) continue;

    // A real thesis always has an author above it. Requiring one kills the
    // false positive where the chart-overlay checkbox labelled "Thesis" gets
    // read as an entry and the surrounding UI chrome becomes its body.
    if (!author || isNoise(author)) continue;

    const key = `${symbol}|${author}|${text.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      symbol,
      author,
      text,
      agoMinutes,
      at: isoFrom(exportedAt, agoMinutes),
      pnlUsd,
      changePct,
      likes,
      closed,
    });
  }
  return out;
}

/**
 * Positions render as:
 *   <symbol> / <qty> <symbol> / $<value> / ▲|▼ / <pct>%
 * The repeated symbol on line 2 is a strong, cheap signal.
 */
function parsePositions(lines: string[]): FomoPosition[] {
  const out: FomoPosition[] = [];
  const seen = new Set<string>();

  for (let i = 0; i + 2 < lines.length; i++) {
    const sym = lines[i]!.trim();
    if (!sym || isNoise(sym)) continue;

    const qty = lines[i + 1]!.trim();
    // Line 2 must end with the same symbol, e.g. "5.3M RAYCAT".
    if (!qty.endsWith(` ${sym}`)) continue;
    if (!/^[\d,.]+\s*[KMB]?\s/i.test(qty)) continue;

    const valueUsd = parseUsd(lines[i + 2]!);
    if (valueUsd === null) continue;

    let changePct: number | null = null;
    for (let k = i + 3; k < Math.min(i + 6, lines.length); k++) {
      const m = lines[k]!.trim().match(/^([\d,.]+)\s*%$/);
      if (m) { changePct = Number(m[1]!.replace(/,/g, "")); break; }
    }

    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push({ symbol: sym, valueUsd, changePct });
    i += 2;
  }
  return out;
}

function parseHeader(lines: string[]) {
  let handle: string | null = null;
  let followers: number | null = null;
  let following: number | null = null;
  let tradeCount: number | null = null;
  let avgHold: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    const h = line.match(/^@([A-Za-z0-9_]+)$/);
    if (h && !handle) handle = h[1]!;

    // "15,815" on one line, "Followers" on the next.
    const label = lines[i + 1]?.trim().toLowerCase();
    if (label === "followers" && followers === null) followers = parseCompact(line);
    if (label === "following" && following === null) following = parseCompact(line);

    const tc = line.match(/^([\d,.]+\s*[KMB]?)\s+trades$/i);
    if (tc && tradeCount === null) tradeCount = parseCompact(tc[1]!);

    const ah = line.match(/^(.+?)\s+avg\.\s*hold$/i);
    if (ah && !avgHold) avgHold = ah[1]!.trim();
  }

  return { handle, followers, following, tradeCount, avgHold };
}

/**
 * Parse a pasted profile page.
 *
 * @param raw        Text content of the page.
 * @param exportedAt ISO timestamp of when the export was taken. Required,
 *                   because every age on the page is relative to it — without
 *                   it no trade can be placed on a timeline.
 */
export function parseProfile(
  raw: string,
  exportedAt: string,
  defaultSymbol: string | null = null,
): TraderDay {
  const lines = raw.split("\n").map((l) => l.replace(/ /g, " ").trimEnd());
  const warnings: string[] = [];

  if (!Number.isFinite(Date.parse(exportedAt))) {
    throw new Error(`exportedAt must be a valid ISO timestamp, got: ${exportedAt}`);
  }

  const { handle, followers, following, tradeCount, avgHold } = parseHeader(lines);

  const trades = parseTrades(lines, exportedAt);
  const theses = parseTheses(lines, exportedAt, defaultSymbol);
  const positions = parsePositions(lines);

  // A token page and a trader profile fail in different ways, and warning about
  // the wrong one sends you hunting a problem that isn't there. A token page has
  // many authors and no swaps table; a profile has one handle and both.
  const isTokenPage = defaultSymbol !== null && !handle;

  if (isTokenPage) {
    if (theses.length === 0) {
      warnings.push("parsed 0 theses — open the Thesis tab before capturing");
    }
  } else {
    if (!handle) warnings.push("no @handle found — is this a profile page?");
    if (followers === null) warnings.push("follower count not found");
    if (trades.length === 0) warnings.push("parsed 0 trades — scroll until the swaps table renders");
    if (theses.length === 0) warnings.push("parsed 0 theses — nothing to build catalysts from");
  }

  return {
    // A token page has no single author, so naming one would be a fiction.
    handle: handle ?? (defaultSymbol ? `token:${defaultSymbol}` : "unknown"),
    displayName: null,
    followers,
    following,
    bio: null,
    portfolioUsd: null,
    pnl24hUsd: null,
    tradeCount,
    avgHold,
    trades,
    theses,
    positions,
    exportedAt,
    parseWarnings: warnings,
  };
}
