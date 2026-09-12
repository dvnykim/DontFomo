/**
 * Renders a snapshot into a single static HTML page.
 *
 * This is a RECAP, not a leaderboard or a terminal. The market-data dashboards
 * (dexscreener et al.) already own "what are the numbers"; the questions here are
 * "what happened today, in what order, and who made money on it" — which is why
 * the page leads with a timeline and why every coin has room for a human catalyst.
 *
 * Ordering: coins are ranked by how many independent traders cleared the PnL bar,
 * falling back to the market-cap score when trader data isn't available.
 *
 * Every trader/thesis element degrades to an honest empty state. Nothing here
 * fabricates a catalyst or a thesis — inventing those would defeat the point.
 */

import type { Runner, Snapshot, Trader } from "../types.ts";
import { usd } from "../format.ts";
import { groupRunners, type NarrativeGroup } from "../group.ts";

/** Human-authored context, keyed by symbol. Written by hand, never generated. */
export interface DayNotes {
  mood?: string;
  coins?: Record<
    string,
    {
      label?: string;
      /** Manually curated catalyst timeline. Later: AI-assisted from theses. */
      timeline?: Array<{ time: string; text: string }>;
    }
  >;
  /**
   * Editorial titles for narrative sections, keyed by NarrativeGroup.key.
   * The clustering is mechanical; only the naming is a judgement call, so this
   * is the one part of the structure a human or model gets to change.
   */
  groups?: Record<string, { title?: string; note?: string }>;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A ticker as a reader writes it.
 *
 * Some tokens are literally named "$1", so a blind "$" prefix renders "$$1",
 * which reads as a bug rather than as a name.
 */
/** URL-safe anchor for a ticker. Symbols include "+", "$1" and emoji. */
const anchorId = (symbol: string): string =>
  "coin-" + symbol.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const ticker = (symbol: string): string => {
  const t = symbol.trim();
  return t.startsWith("$") ? esc(t) : "$" + esc(t);
};

const num = (n: number): string => Math.round(n).toLocaleString("en-US");

/** HH:MM in UTC. The whole product runs on a UTC day. */
function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(11, 16);
}

/** "5h 24m" style duration between two instants. */
function duration(fromIso: string | null, toIso: string | null): string | null {
  if (!fromIso || !toIso) return null;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

/** Position of an instant across the snapshot window, clamped to 0-100. */
function pct(iso: string | null, from: number, to: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || to <= from) return null;
  return Math.max(0, Math.min(100, ((t - from) / (to - from)) * 100));
}

const shortWallet = (w: string): string => (w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w);

const FLAG_LABELS: Record<string, string> = {
  "possible-wash-trading": "wash?",
  "launched-today": "new",
  "bot-driven-selling": "bot sells",
  "bot-driven-buying": "bot buys",
  distribution: "distribution",
  fading: "fading",
  "thin-float": "thin float",
};

/** Flags that should read as warnings rather than neutral metadata. */
const WARN_FLAGS = new Set([
  "possible-wash-trading",
  "bot-driven-selling",
  "bot-driven-buying",
  "distribution",
  "fading",
  "thin-float",
]);

/**
 * Flags on a single coin.
 *
 * `universal` holds flags that fired on nearly every runner. Those are dropped
 * here and stated once at the bottom of the page instead: a warning printed on
 * 22 of 24 cards has no discriminating power left, it just trains the reader to
 * ignore badges. The finding is real and still reported — once, where it reads
 * as a fact about the day rather than about one coin.
 */
function renderFlags(flags: string[], universal: Set<string> = new Set()): string {
  return flags
    .filter((f) => f !== "launched-today") // already stated by the launch time
    .filter((f) => !universal.has(f))
    .map(
      (f) =>
        `<span class="flag${WARN_FLAGS.has(f) ? " flag-warn" : ""}">${esc(FLAG_LABELS[f] ?? f)}</span>`,
    )
    .join("");
}

// ---------------------------------------------------------------- day timeline

/**
 * The day at a glance: one track per coin, launch marker to peak marker.
 * This is the part that makes it a recap rather than a table — you can see that
 * three coins peaked within the same hour, or that one ran all day.
 */
/**
 * Wallet rows shown before the rest collapse. Winners are always shown on top
 * of this — the cap governs the tail, never the signal.
 */
const TRADERS_SHOWN = 3;

/** Rows the day timeline will draw before it stops being glanceable. */
const TIMELINE_MAX_ROWS = 12;

function renderDayTimeline(snapshot: Snapshot): string {
  const from = new Date(snapshot.window.from).getTime();
  const to = new Date(snapshot.window.to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "";

  // Six evenly spaced UTC labels across the window.
  const ticks = Array.from({ length: 6 }, (_, i) => {
    const t = from + ((to - from) * i) / 5;
    return `<span class="tick" style="left:${(i / 5) * 100}%">${new Date(t)
      .toISOString()
      .slice(11, 13)}:00</span>`;
  }).join("");

  // Cap the rows. At 24 runners the timeline stops being a shape you can read
  // in one glance and becomes a second, worse list — and the glanceable shape
  // is the entire reason it exists. The biggest movers carry the day's story.
  const shown = [...snapshot.runners]
    .sort((a, b) => (b.mcap?.high ?? b.fdvUsd) - (a.mcap?.high ?? a.fdvUsd))
    .slice(0, TIMELINE_MAX_ROWS);
  const hidden = snapshot.runners.length - shown.length;

  const rows = shown
    .map((r) => {
      const launchPct = pct(r.createdAt, from, to);
      const peakPct = pct(r.mcap?.peakAt ?? null, from, to);
      const preExisting = launchPct === null || (r.ageDays !== null && r.ageDays >= 1);

      // A coin that predates the window starts its bar at the left edge.
      const start = preExisting ? 0 : (launchPct ?? 0);
      const end = peakPct ?? start;
      const width = Math.max(1.5, end - start);

      const bar =
        `<span class="tl-bar" style="left:${start}%;width:${width}%"></span>` +
        (preExisting ? "" : `<span class="tl-dot tl-launch" style="left:${start}%"></span>`) +
        (peakPct === null ? "" : `<span class="tl-dot tl-peak" style="left:${end}%"></span>`);

      // Always "N of M sampled", never a bare count. The sample is ~8 wallets
      // chosen by volume out of thousands of buyers, so a bare "2 winners" reads
      // as a population fact and is simply false.
      const sampled = r.traders?.length ?? 0;
      const winners =
        r.bigWinners === null || sampled === 0
          ? ""
          : `<span class="tl-winners">${r.bigWinners}/${sampled} sampled</span>`;

      return `
      <div class="tl-row">
        <a class="tl-name" href="#${anchorId(r.symbol)}">${ticker(r.symbol)}</a>
        <span class="tl-track">${bar}</span>
        <span class="tl-meta">${esc(r.mcap ? usd(r.mcap.high) : "—")}${winners}</span>
      </div>`;
    })
    .join("");

  return `
  <section class="timeline">
    <div class="tl-head">
      <h2>The day</h2>
      <div class="tl-legend">
        <span><i class="tl-dot tl-launch"></i>launch</span>
        <span><i class="tl-dot tl-peak"></i>peak</span>
      </div>
    </div>
    <div class="tl-axis">${ticks}</div>
    ${rows}
    ${hidden > 0 ? `<div class="tl-more">+${hidden} more below</div>` : ""}
  </section>`;
}

// -------------------------------------------------------------------- traders

function renderTrader(t: Trader, bar: number): string {
  const big = !t.isBot && t.pnlUsd >= bar;
  const name = t.handle ? `@${esc(t.handle)}` : shortWallet(t.wallet);
  const sign = t.pnlUsd < 0 ? "-" : "+";

  /**
   * Realised vs total matters more than the headline number. A wallet showing
   * +$17k total but -$3k realised hasn't made anything — it's holding paper on a
   * microcap it may not be able to exit. Saying so is the point of the product.
   */
  const settled =
    t.realizedPnlUsd > 0
      ? `<span class="banked">${esc(usd(t.realizedPnlUsd))} banked</span>`
      : t.pnlUsd < 0
        ? `<span class="paper">underwater &mdash; nothing banked</span>`
        : `<span class="paper">unrealised &mdash; still holding</span>`;

  const botTag = t.isBot
    ? `<span class="bot-tag">${esc(t.tags.join(" ") || "bot")}</span>`
    : "";

  // The thesis is the whole differentiator; when absent, say so plainly.
  const thesis = t.thesis
    ? `<p class="thesis">${esc(t.thesis)}</p>`
    : `<p class="thesis thesis-empty">no thesis posted</p>`;

  return `
    <li class="trader${big ? " trader-big" : ""}${t.isBot ? " trader-bot" : ""}">
      <div class="trader-top">
        <span class="trader-name">${name}</span>
        ${botTag}
        ${t.followers === null ? "" : `<span class="trader-followers">${num(t.followers)} followers</span>`}
        <span class="trader-pnl${t.pnlUsd < 0 ? " neg" : ""}">${sign}${esc(usd(Math.abs(t.pnlUsd)))}</span>
      </div>
      <div class="trader-sub">${settled}<span class="trader-trades">${num(t.trades)} trades</span></div>
      ${t.isBot ? "" : thesis}
    </li>`;
}

function renderTraders(r: Runner, bar: number): string {
  if (r.traders === null) {
    return `
      <div class="traders">
        <h3>Traders</h3>
        <p class="empty-note">
          Trader P&amp;L not yet wired up &mdash; needs a Birdeye API key.
          Theses arrive with fomo access.
        </p>
      </div>`;
  }
  if (r.traders.length === 0) {
    return `
      <div class="traders">
        <h3>Traders</h3>
        <p class="empty-note">No qualifying traders found for this token.</p>
      </div>`;
  }

  const real = r.traders.filter((t) => !t.isBot).length;

  // Show who made money, collapse the rest.
  //
  // Eight wallet rows per coin was the single biggest thing on the page — 935
  // rows across 14 cards — and on most coins all eight are bots with nothing
  // banked. That is one sentence of information printed as eight rows, and it
  // buries the coins where a person actually did make money.
  //
  // Anyone who cleared the bar is always shown. Beyond that, the top few by
  // P&L, and the tail folds away with a summary that still states what it is.
  const ranked = [...r.traders].sort((a, b) => Number(a.isBot) - Number(b.isBot) || b.pnlUsd - a.pnlUsd);
  const winners = ranked.filter((t) => !t.isBot && t.pnlUsd >= bar);
  const rest = ranked.filter((t) => !winners.includes(t));
  const shown = [...winners, ...rest.slice(0, Math.max(0, TRADERS_SHOWN - winners.length))];
  const hidden = ranked.filter((t) => !shown.includes(t));
  const hiddenBots = hidden.filter((t) => t.isBot).length;

  // When infrastructure is the only thing in the top wallets, say it outright —
  // it's the most useful sentence on the page for that coin.
  const caveat =
    real === 0
      ? `<p class="empty-note">
           Every top wallet here is automated infrastructure. No discretionary
           trader made this list.
         </p>`
      : "";

  return `
    <div class="traders">
      <h3>Traders <span class="count">${real} real / ${r.traders.length}</span></h3>
      ${caveat}
      <ul class="trader-list">${shown.map((t) => renderTrader(t, bar)).join("")}</ul>
      ${
        hidden.length === 0
          ? ""
          : `<details class="more-traders">
               <summary>${hidden.length} more sampled wallet${hidden.length === 1 ? "" : "s"}${
                 hiddenBots === hidden.length ? ", all automated" : ""
               }</summary>
               <ul class="trader-list">${hidden.map((t) => renderTrader(t, bar)).join("")}</ul>
             </details>`
      }
    </div>`;
}

// ----------------------------------------------------------------- coin cards

function renderCatalysts(symbol: string, notes: DayNotes): string {
  const events = notes.coins?.[symbol]?.timeline ?? [];

  const body =
    events.length === 0
      ? `<p class="empty-note">
           No catalysts logged yet. Add them in <code>notes/&lt;date&gt;.json</code>
           &mdash; e.g. "12:30 &mdash; @someone bought and posted a thesis".
         </p>`
      : `<ol class="catalysts">${events
          .map(
            (e) =>
              `<li><span class="cat-time">${esc(e.time)}</span><span class="cat-text">${esc(e.text)}</span></li>`,
          )
          .join("")}</ol>`;

  return `
    <details class="catalyst-box"${events.length > 0 ? " open" : ""}>
      <summary>Catalysts${events.length > 0 ? ` <span class="count">${events.length}</span>` : ""}</summary>
      ${body}
    </details>`;
}

function renderCard(
  r: Runner,
  rank: number,
  notes: DayNotes,
  bar: number,
  universal: Set<string> = new Set(),
): string {
  const label = notes.coins?.[r.symbol]?.label ?? (rank === 1 ? "Runner of the Day" : "");
  const isHero = rank === 1;

  // Launch time and launch→peak duration only mean something for same-day launches.
  // On a 45-day-old coin "ran 1097h" is technically true and completely useless.
  const isFresh = r.ageDays !== null && r.ageDays < 1;
  const launched = isFresh ? hhmm(r.createdAt) : null;
  const peaked = hhmm(r.mcap?.peakAt ?? null);
  const runFor = isFresh ? duration(r.createdAt, r.mcap?.peakAt ?? null) : null;

  // Mello's two entry shapes: "hit $X" for launches, "$X to $Y" for movers.
  const headline = r.mcap
    ? r.ageDays !== null && r.ageDays < 1
      ? `hit <b>${esc(usd(r.mcap.high))}</b>`
      : `<b>${esc(usd(r.mcap.low))}</b> &rarr; <b>${esc(usd(r.mcap.high))}</b>`
    : "market cap unavailable";

  const timing = [
    launched ? `launched ${launched}` : r.ageDays !== null ? `${Math.round(r.ageDays)}d old` : null,
    peaked ? `peaked ${peaked}` : null,
    runFor ? `ran ${runFor}` : null,
  ]

    .filter(Boolean)
    .join(" &middot; ");

  // See the note in the day timeline: this is a sample of the highest-volume
  // wallets, not a census. "no real trader over $10k" was an outright false
  // claim on a token where one fomo trader alone banked $1.17m.
  const sampledCount = r.traders?.length ?? 0;
  const winners =
    r.bigWinners === null || sampledCount === 0
      ? ""
      : r.bigWinners === 0
        ? `<span class="flag flag-warn" title="Sampled from the highest-volume wallets, not all holders">none of ${sampledCount} sampled over ${esc(usd(bar))}</span>`
        : `<span class="winners" title="Sampled from the highest-volume wallets, not all holders">${r.bigWinners} of ${sampledCount} sampled over ${esc(usd(bar))}</span>`;

  // The pairing sits with the headline, not in the badge row: on a launchpad
  // coin it IS the reason the thing moved, so it reads as part of the claim —
  // "hit $45m, paired with $stonk" — rather than as metadata about it.
  const pairing = r.pairing
    ? `<div class="pairing${r.pairing.dominant ? " pairing-dominant" : ""}"` +
      ` title="${Math.round(r.pairing.share * 100)}% of 24h volume trades against this pair">` +
      `paired with <strong>${ticker(r.pairing.symbol)}</strong></div>`
    : "";

  // Copycat warning. Buying the wrong contract is one of the easiest ways to
  // lose money on a launch, and three tokens called EMBER cleared the filters
  // on a single day.
  const copies =
    r.tickerCopies > 0
      ? `<span class="flag flag-warn" title="Other tokens using this exact ticker also ran today. Check the contract.">` +
        `${r.tickerCopies + 1} tokens named ${ticker(r.symbol)}</span>`
      : "";

  // What it is named after. For a large share of launches this is the whole
  // reason it exists, and it costs nothing to say.
  const named = r.namesake
    ? `<div class="pairing">named after <strong>${esc(r.namesake.name)}</strong></div>`
    : "";

  return `
  <article class="card${isHero ? " hero" : ""}" id="${anchorId(r.symbol)}">
    <header class="card-head">
      <span class="rank">${rank}</span>
      <div class="titles">
        ${label ? `<div class="label">${esc(label)}</div>` : ""}
        <h2 class="ticker">${ticker(r.symbol)}</h2>
        <div class="timing">${timing || "&nbsp;"}</div>
      </div>
      <div class="head-right">
        <div class="headline">${headline}</div>
        ${r.mcap?.multiple != null ? `<div class="multiple">${r.mcap.multiple}x</div>` : ""}
        ${pairing || named}
      </div>
    </header>

    <div class="badges">${copies}${winners}${renderFlags(r.flags, universal)}</div>

    ${renderCatalysts(r.symbol, notes)}
    ${renderTraders(r, bar)}

    <footer class="card-foot">
      <span>${esc(r.dex)}</span>
      <span>now ${esc(usd(r.mcap?.current ?? r.fdvUsd))}</span>
      <span>${
        r.liquidityUsd >= 1000
          ? `liq ${esc(usd(r.liquidityUsd))}`
          : `<span title="GeckoTerminal does not report reserves for this pool type. It is unknown, not zero.">depth not reported</span>`
      }</span>
      <a href="https://dexscreener.com/solana/${esc(r.poolAddress)}" target="_blank" rel="noopener">chart &#8599;</a>
    </footer>
  </article>`;
}

/**
 * Date nav. The archive is the compounding asset here — a point-in-time record
 * of what looked hot that cannot be reconstructed after the fact — so it needs
 * to be reachable, not just committed.
 */
function renderArchiveNav(dates: string[], current: string): string {
  if (dates.length < 2) return "";
  const recent = [...dates].sort().reverse().slice(0, 14);
  const links = recent
    .map((d) => {
      const label = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      return `<a href="${esc(d)}.html"${d === current ? ' class="on"' : ""}>${esc(label)}</a>`;
    })
    .join("");
  return `<nav class="archive" aria-label="Past recaps">${links}</nav>`;
}

/**
 * A coin with nothing to say about it.
 *
 * At 24 tokens, giving every coin a full card with a trader table pads the page
 * with rows that carry no information — and a padded recap is exactly the thing
 * that stops people reading one. A coin with no catalyst, no pairing and no
 * namesake gets a single line instead: it ran, here is how far, that is all we
 * know. The reference format does the same thing under "More Plays".
 */
function renderCompactRow(r: Runner): string {
  const cap = r.mcap ? usd(r.mcap.high) : usd(r.fdvUsd);
  const mult =
    r.mcap?.multiple != null && r.mcap.multiple > 1
      ? ` <span class="cx">${r.mcap.multiple}x</span>`
      : "";
  const copies = r.tickerCopies > 0 ? ` <span class="cwarn">${r.tickerCopies + 1} same ticker</span>` : "";
  return `
    <div class="crow" id="${anchorId(r.symbol)}">
      <span class="cname">${ticker(r.symbol)}</span>
      <span class="ccap">hit ${esc(cap)}${mult}</span>
      ${copies}
    </div>`;
}

/**
 * Nothing beyond the price is known about this coin.
 *
 * A real winner counts as something to say. "Someone cleared $12k here" is the
 * most interesting fact this product can report, and an earlier version buried
 * it in a one-line row because the coin had no catalyst, no pairing and no
 * namesake — demoting the signal the whole pipeline exists to find.
 */
function hasNothingToSay(r: Runner, notes: DayNotes): boolean {
  const timeline = notes.coins?.[r.symbol]?.timeline ?? [];
  return timeline.length === 0 && !r.pairing && !r.namesake && !(r.bigWinners && r.bigWinners > 0);
}

/**
 * One narrative section.
 *
 * The subtitle states the mechanical basis for the grouping — "3 coins trading
 * against $STONK, 61% of their volume" — so a reader can see WHY these are
 * together rather than taking an editorial header on trust.
 */
function renderSection(g: NarrativeGroup, cards: string, notes: DayNotes): string {
  const override = notes.groups?.[g.key];
  const title = override?.title ?? g.title;

  let basis = "";
  if (g.kind === "pairing" && g.pairedWith) {
    const shares = g.runners.map((r) => r.pairing?.share ?? 0).filter((x) => x > 0);
    const avg = shares.length ? Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 100) : 0;
    const n = g.runners.length;
    basis =
      `${n} coin${n === 1 ? "" : "s"} trading against $${esc(g.pairedWith)}` +
      (avg > 0 ? ` &middot; ${avg}% of their volume` : "");
  } else if (g.kind === "namesake") {
    const names = [...new Set(g.runners.map((r) => r.namesake?.name).filter(Boolean))];
    const shown = names.slice(0, 3).join(", ");
    basis =
      `${g.runners.length} named after real things` +
      (shown ? ` &mdash; ${esc(shown)}${names.length > 3 ? ` +${names.length - 3} more` : ""}` : "");
  } else if (g.kind === "venue") {
    basis = `${g.runners.length} off the same launchpad, no shared pairing`;
  } else if (g.kind === "fresh") {
    basis = `${g.runners.length} launched in the last 24h, no shared pairing`;
  } else if (g.kind === "established") {
    basis = "already trading before today, no shared pairing";
  }

  return `
  <section class="group">
    <div class="group-head">
      <h2 class="group-title">${esc(title)}</h2>
      ${basis ? `<div class="group-basis">${basis}</div>` : ""}
    </div>
    ${override?.note ? `<p class="group-note">${esc(override.note)}</p>` : ""}
    ${cards}
  </section>`;
}

// ------------------------------------------------------------------ full page

/**
 * @param archive Every date with a snapshot, so each page can link the others.
 *                Empty renders no nav — a single-day site needs none.
 */
export function renderPage(
  snapshot: Snapshot,
  notes: DayNotes = {},
  archive: string[] = [],
): string {
  const { date, runners, stats, config } = snapshot;
  const bar = config.bigWinnerPnlUsd;

  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  // The share card is the whole preview most people ever see. Lead with the
  // day's read when there is one — a generic description wastes the only line
  // that decides whether anyone opens the link.
  const topLine = notes.mood?.trim();
  const shareDescription = topLine
    ? topLine.length > 180
      ? topLine.slice(0, 177) + "..."
      : topLine
    : `${runners.length} coins ran on Solana. What they were paired with, when they peaked, ` +
      `and what the wallets actually did.`;

  // A flag on nearly every coin is a property of the day, not of any coin.
  const UNIVERSAL_AT = 0.6;
  const flagCounts = new Map<string, number>();
  for (const r of runners) {
    for (const f of new Set(r.flags)) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  }
  const universal = new Set(
    [...flagCounts]
      .filter(([f, n]) => f !== "launched-today" && runners.length >= 4 && n / runners.length >= UNIVERSAL_AT)
      .map(([f]) => f),
  );

  // Sections, not a ranked list. Eight coins running for one reason is the
  // story; ten unrelated facts in rank order is a leaderboard.
  const groups = groupRunners(runners);
  let rank = 0;
  const sections = groups
    .map((g) => {
      // Coins we can say something about get a card; the rest get one line.
      const detailed = g.runners.filter((r) => !hasNothingToSay(r, notes));
      const bare = g.runners.filter((r) => hasNothingToSay(r, notes));

      const cards = detailed.map((r) => renderCard(r, ++rank, notes, bar, universal)).join("\n");
      const body = cards ? `<div class="cards">${cards}</div>` : "";
      const rows = bare.length > 0 ? `<div class="crows">${bare.map(renderCompactRow).join("")}</div>` : "";
      return renderSection(g, body + rows, notes);
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DontFomo &mdash; ${esc(pretty)}</title>
<meta name="description" content="${esc(shareDescription)}">
<meta property="og:type" content="article">
<meta property="og:title" content="DontFomo &mdash; ${esc(pretty)}">
<meta property="og:description" content="${esc(shareDescription)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="DontFomo &mdash; ${esc(pretty)}">
<meta name="twitter:description" content="${esc(shareDescription)}">
<style>
  :root {
    --bg:#0a0b0d; --surface:#131519; --surface-2:#1a1d23; --border:#24282f;
    --text:#e8eaed; --muted:#8b919c; --dim:#5c626d;
    --up:#22c98f; --down:#f0616d; --warn:#e0a33a; --accent:#6c8cff;
  }
  .tl-more { margin-top:8px; padding-left:66px; font-size:11px; color:var(--dim); }
  .crows { border:1px solid var(--border); border-radius:10px; background:var(--surface);
           padding:4px 0; margin-top:10px; }
  .crow { display:flex; align-items:baseline; gap:10px; padding:7px 14px; font-size:13px; }
  .crow + .crow { border-top:1px solid var(--border); }
  .cname { font-weight:650; color:var(--text); min-width:120px; }
  .ccap { color:var(--muted); }
  .cx { color:var(--up); font-weight:600; }
  .cwarn { color:var(--warn); font-size:11px; }
  /* The timeline is the page's one glanceable view; letting it act as an index
     is most of the value of having it on a screen this tall. */
  a.tl-name { text-decoration:none; color:var(--text); }
  a.tl-name:hover { color:var(--accent); }
  .card, .crow { scroll-margin-top:16px; }
  .card:target { outline:1px solid var(--accent); outline-offset:3px; }
  .crow:target { outline:1px solid var(--accent); outline-offset:2px; }
  html { scroll-behavior:smooth; }
  @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } }
  .more-traders { margin-top:8px; }
  .more-traders summary { cursor:pointer; font-size:11px; color:var(--dim);
                          list-style:none; padding:4px 0; }
  .more-traders summary::-webkit-details-marker { display:none; }
  .more-traders summary::before { content:"▸ "; }
  .more-traders[open] summary::before { content:"▾ "; }
  .more-traders summary:hover { color:var(--muted); }
  .group { margin:0 0 34px; }
  .group-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;
                margin:0 0 12px; padding-bottom:8px; border-bottom:1px solid var(--border); }
  .group-title { margin:0; font-size:17px; font-weight:650; letter-spacing:-.01em; color:var(--text); }
  .group-basis { font-size:11px; color:var(--dim); }
  .group-note { margin:0 0 12px; font-size:13px; color:var(--muted); line-height:1.6; }
  .pairing { font-size:11px; color:var(--muted); margin-top:.3rem; }
  .pairing strong { color:var(--accent); font-weight:600; }
  .pairing-dominant strong { color:var(--up); }
  .archive{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:1rem}
  .archive a{font-size:.72rem;color:var(--dim);text-decoration:none;
    padding:.22rem .5rem;border:1px solid var(--border);border-radius:3px}
  .archive a:hover{color:var(--text);border-color:var(--muted)}
  .archive a.on{color:var(--text);border-color:var(--accent)}
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--text);
    font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  /* A recap is scanned, not read linearly, so on a laptop the constraint is how
     much of the day fits in one look — not line length. An 800px column used
     44% of a 1440px screen and made 24 coins a very long scroll. Text inside a
     card still sits at a comfortable measure because the cards are what widen,
     not the paragraphs. */
  .wrap { max-width:1180px; margin:0 auto; padding:40px 24px 80px; }

  /* Two cards abreast once there is room for both to stay readable. Below that
     it degrades to the single column the phone already used. */
  .cards { display:grid; gap:14px; grid-template-columns:1fr; }
  @media (min-width:1040px) {
    .cards { grid-template-columns:repeat(2, minmax(0, 1fr)); align-items:start; }
    .cards > .card.hero { grid-column:1 / -1; }
  }

  /* The tail is one line each, so it packs tighter than the cards do. */
  @media (min-width:1040px) {
    .crows { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr));
             column-gap:0; padding:0; background:transparent; border:none; }
    .crow { border:1px solid var(--border); border-radius:8px; margin:0 0 8px;
            background:var(--surface); }
    .crow + .crow { border-top:1px solid var(--border); }
    .crows > .crow:nth-child(odd) { margin-right:4px; }
    .crows > .crow:nth-child(even) { margin-left:4px; }
  }
  h2,h3 { margin:0; }

  header.page { margin-bottom:28px; max-width:760px; }
  .brand { font-size:13px; font-weight:700; letter-spacing:.14em; text-transform:uppercase;
           color:var(--accent); margin-bottom:10px; }
  h1 { font-size:30px; margin:0 0 6px; letter-spacing:-.02em; }
  .mood { color:var(--muted); font-size:16px; margin:0; }
  .mood-empty { color:var(--dim); font-style:italic; }

  /* ---- day timeline ---- */
  .timeline { background:var(--surface); border:1px solid var(--border); border-radius:12px;
              padding:18px 20px 20px; margin-bottom:24px; }
  .tl-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:16px; }
  .tl-head h2 { font-size:15px; letter-spacing:-.01em; }
  .tl-legend { display:flex; gap:14px; font-size:11px; color:var(--dim); }
  .tl-legend span { display:flex; align-items:center; gap:5px; }
  .tl-legend i { position:static; display:inline-block; }

  .tl-axis { position:relative; height:14px; margin-left:74px; margin-right:78px;
             border-bottom:1px solid var(--border); margin-bottom:10px; }
  .tick { position:absolute; top:0; transform:translateX(-50%); font-size:10px;
          color:var(--dim); font-variant-numeric:tabular-nums; }

  .tl-row { display:flex; align-items:center; gap:0; height:26px; }
  .tl-name { width:74px; flex:none; font-size:13px; font-weight:600;
             overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tl-track { position:relative; flex:1; height:100%; }
  .tl-track::before { content:""; position:absolute; left:0; right:0; top:50%;
                      height:1px; background:var(--border); }
  .tl-bar { position:absolute; top:50%; transform:translateY(-50%); height:4px;
            border-radius:2px; background:linear-gradient(90deg,#2c3550,var(--accent)); }
  .tl-dot { position:absolute; top:50%; width:8px; height:8px; border-radius:50%;
            transform:translate(-50%,-50%); }
  .tl-launch { background:var(--muted); }
  .tl-peak { background:var(--up); box-shadow:0 0 0 3px rgba(34,201,143,.15); }
  .tl-meta { width:78px; flex:none; text-align:right; font-size:11px; color:var(--muted);
             font-variant-numeric:tabular-nums; }
  .tl-winners { display:block; color:var(--up); font-size:10px; }

  /* ---- coin cards ---- */
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px;
          padding:18px 20px; margin-bottom:14px; }
  .card.hero { border-color:#33405f; background:linear-gradient(180deg,#171b26,var(--surface) 60%); }

  .card-head { display:flex; align-items:flex-start; gap:12px; }
  .rank { font-variant-numeric:tabular-nums; font-size:13px; font-weight:700; color:var(--dim);
          background:var(--surface-2); border-radius:6px; padding:3px 8px; margin-top:3px; }
  .hero .rank { color:var(--accent); background:#1c2338; }
  .titles { flex:1; min-width:0; }
  .label { font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
           color:var(--accent); margin-bottom:3px; }
  .ticker { font-size:22px; letter-spacing:-.01em; }
  .hero .ticker { font-size:26px; }
  .timing { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; margin-top:3px; }

  .head-right { text-align:right; flex:none; }
  .headline { font-size:17px; color:var(--muted); white-space:nowrap; }
  .headline b { color:var(--text); font-size:20px; font-weight:700; }
  .hero .headline b { font-size:24px; }
  .multiple { display:inline-block; margin-top:5px; font-size:13px; font-weight:700;
              color:var(--up); background:#14291f; padding:2px 8px; border-radius:6px; }

  .badges { display:flex; flex-wrap:wrap; gap:6px; margin:14px 0 0; }
  .flag, .winners { font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
                    padding:3px 8px; border-radius:5px; background:var(--surface-2);
                    color:var(--muted); white-space:nowrap; }
  .flag-warn { background:#2e2415; color:var(--warn); }
  .winners { background:#14291f; color:var(--up); }

  /* ---- catalysts ---- */
  .catalyst-box { margin-top:14px; border-top:1px solid var(--border); padding-top:12px; }
  .catalyst-box summary { cursor:pointer; font-size:12px; font-weight:600; letter-spacing:.06em;
                          text-transform:uppercase; color:var(--muted); list-style:none; }
  .catalyst-box summary::-webkit-details-marker { display:none; }
  .catalyst-box summary::before { content:"\\25B8"; display:inline-block; margin-right:7px;
                                  transition:transform .15s; color:var(--dim); }
  .catalyst-box[open] summary::before { transform:rotate(90deg); }
  .catalysts { list-style:none; margin:12px 0 0; padding:0; }
  .catalysts li { display:flex; gap:12px; padding:5px 0; font-size:14px; }
  .cat-time { flex:none; width:52px; color:var(--accent); font-variant-numeric:tabular-nums;
              font-weight:600; font-size:13px; }
  .cat-text { color:var(--text); }
  .count { display:inline-block; margin-left:4px; padding:1px 6px; border-radius:4px;
           background:var(--surface-2); color:var(--dim); font-size:11px; }

  /* ---- traders ---- */
  .traders { margin-top:16px; border-top:1px solid var(--border); padding-top:14px; }
  .traders h3 { font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
                color:var(--muted); margin-bottom:10px; }
  .trader-list { list-style:none; margin:0; padding:0; }
  .trader { padding:9px 12px; border-radius:8px; background:var(--surface-2); margin-bottom:6px; }
  .trader-big { background:#16241d; }
  .trader-top { display:flex; align-items:baseline; gap:10px; }
  .trader-name { font-weight:600; font-size:14px; }
  .trader-followers { font-size:11px; color:var(--dim); }
  .trader-pnl { margin-left:auto; font-weight:700; color:var(--up);
                font-variant-numeric:tabular-nums; }
  .trader-pnl.neg { color:var(--down); }
  .trader-bot { opacity:.55; }
  .bot-tag { font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase;
             padding:2px 6px; border-radius:4px; background:#2e2415; color:var(--warn); }
  .trader-sub { display:flex; gap:10px; align-items:baseline; margin-top:3px;
                font-size:11px; color:var(--dim); }
  .banked { color:var(--up); }
  .paper { color:var(--warn); }
  .trader-trades { margin-left:auto; font-variant-numeric:tabular-nums; }
  .thesis { margin:5px 0 0; font-size:13px; color:var(--muted); line-height:1.45; }
  .thesis-empty { color:var(--dim); font-style:italic; }

  .empty-note { margin:10px 0 0; font-size:13px; color:var(--dim); font-style:italic; line-height:1.5; }
  .empty-note code { font-style:normal; background:var(--surface-2); padding:1px 5px;
                     border-radius:4px; font-size:12px; }

  .card-foot { display:flex; gap:14px; flex-wrap:wrap; margin-top:14px; padding-top:12px;
               border-top:1px solid var(--border); font-size:11px; color:var(--dim); }
  .card-foot a { color:var(--muted); text-decoration:none; }
  .card-foot a:hover { color:var(--accent); }

  .empty { background:var(--surface); border:1px dashed var(--border); border-radius:12px;
           padding:32px; text-align:center; color:var(--muted); }
  footer.page { margin-top:36px; padding-top:20px; border-top:1px solid var(--border);
                font-size:12px; color:var(--dim); line-height:1.7; }
  footer.page b { color:var(--muted); font-weight:600; }

  @media (max-width:600px) {
    .card-head { flex-wrap:wrap; }
    .head-right { text-align:left; width:100%; padding-left:34px; }
    .headline { white-space:normal; }
    .tl-name { width:58px; font-size:12px; }
    .tl-axis { margin-left:58px; margin-right:64px; }
    .tl-meta { width:64px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="page">
    <div class="brand">DontFomo</div>
    <h1>${esc(pretty)}</h1>
    ${
      notes.mood
        ? `<p class="mood">${esc(notes.mood)}</p>`
        : `<p class="mood mood-empty">add the one-line market read here</p>`
    }
    ${renderArchiveNav(archive, date)}
  </header>

  ${
    runners.length === 0
      ? `<div class="empty">Nothing cleared the filters today.</div>`
      : renderDayTimeline(snapshot) + `<main>${sections}</main>`
  }

  <footer class="page">
    ${
      universal.size > 0
        ? `<b>${[...universal].map((f) => esc(FLAG_LABELS[f] ?? f)).join(", ")}</b> applied to
           most coins today, so it is stated here rather than on every card.<br>`
        : ""
    }
    Grouped by what each token trades against &mdash; coins sharing a pairing ran for the
    same reason. Sections without one are split by age, which means we know they ran and
    not why.<br>
    Trader figures are a <b>sample</b> of the highest-volume wallets, never a count of
    everyone who profited.<br>
    Scanned <b>${num(stats.poolsScanned)}</b> pools &rarr; <b>${num(stats.afterDedupe)}</b> unique
    tokens &rarr; <b>${num(stats.runnersKept)}</b> shown. Market caps are intraday
    low&rarr;high; times are UTC.<br>
    Public on-chain data via GeckoTerminal. Not financial advice.
  </footer>
</div>
</body>
</html>
`;
}
