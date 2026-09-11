/**
 * Narrative grouping.
 *
 * The recaps this product is modelled on do not rank coins — they CLUSTER them
 * by shared catalyst and title each cluster:
 *
 *     Rotate Back To Stonk
 *       $KNOTS   -> hit $45m, paired with $stonk
 *       $btc     -> hit $18.3m, bitcoin rewards
 *       $NEARKAT -> hit $9.7m, paired with $near
 *
 * A flat top-10 loses the thing that makes a recap readable: that eight coins
 * ran for ONE reason. Nobody wants ten unrelated facts; they want "here is what
 * the market was doing today, and here is what it did it with".
 *
 * The clustering is mechanical — tokens sharing a pairing belong together, and
 * that is derivable from pool data. Only the TITLE is editorial, which is the
 * same split used everywhere else here: machines decide what is true, the model
 * decides how to say it.
 */

import type { Runner } from "./types.ts";

export type GroupKind = "pairing" | "venue" | "fresh" | "established" | "other";

/**
 * AMM identifiers map to the launchpad a trader would name. `pumpswap` is
 * pump.fun's pool program, so a coin trading there launched on pump.fun —
 * which is a real theme, and the axis the reference recaps group on.
 */
const VENUE_NAMES: Record<string, string> = {
  pumpswap: "pump.fun",
  pumpfun: "pump.fun",
  meteora: "Meteora",
  raydium: "Raydium",
  orca: "Orca",
  launchlab: "LaunchLab",
  moonshot: "Moonshot",
  believe: "Believe",
};

export const venueName = (dex: string): string =>
  VENUE_NAMES[dex.toLowerCase()] ?? dex;

export interface NarrativeGroup {
  /** Stable identity, e.g. "pair:stonk". Used to attach a generated title. */
  key: string;
  /** Mechanical fallback title. The model may replace it; it must stand alone. */
  title: string;
  kind: GroupKind;
  runners: Runner[];
  /** The shared pairing, when that is what binds the group. */
  pairedWith: string | null;
}

export interface GroupConfig {
  /** Below this a shared pairing is a coincidence, not a theme. */
  minGroupSize: number;
  /**
   * Below this a shared venue is just "two coins launched on the biggest
   * launchpad", which is true of most days and therefore says nothing.
   */
  minVenueSize: number;
  /** A token younger than this is a launch rather than a mover. */
  freshDays: number;
}

export const DEFAULT_GROUPS: GroupConfig = { minGroupSize: 2, minVenueSize: 3, freshDays: 1 };

/** Total peak market cap, so the biggest story leads. */
function groupWeight(g: NarrativeGroup): number {
  return g.runners.reduce((sum, r) => sum + (r.mcap?.high ?? r.fdvUsd), 0);
}

/**
 * Cluster runners into the sections a recap is actually written in.
 *
 * Priority matters. A shared pairing is the strongest signal available — it
 * means these coins ran for the same reason — so it claims tokens first.
 * What is left falls back to age, which at least separates "a launch happened"
 * from "something old moved".
 */
export function groupRunners(
  runners: Runner[],
  cfg: GroupConfig = DEFAULT_GROUPS,
): NarrativeGroup[] {
  const groups: NarrativeGroup[] = [];
  const claimed = new Set<Runner>();

  // 1. Shared pairings.
  const byPair = new Map<string, Runner[]>();
  for (const r of runners) {
    if (!r.pairing) continue;
    const k = r.pairing.symbol.toLowerCase();
    byPair.set(k, [...(byPair.get(k) ?? []), r]);
  }

  for (const [, members] of byPair) {
    if (members.length < cfg.minGroupSize) continue;
    const symbol = members[0]!.pairing!.symbol;
    for (const m of members) claimed.add(m);
    groups.push({
      key: `pair:${symbol.toLowerCase()}`,
      title: `Paired With $${symbol}`,
      kind: "pairing",
      pairedWith: symbol,
      runners: members.sort((a, b) => (b.mcap?.high ?? b.fdvUsd) - (a.mcap?.high ?? a.fdvUsd)),
    });
  }

  // 2. A lone token with a pairing still gets its own section — a single coin
  //    running on a named reason is a story, it just isn't a theme.
  for (const r of runners) {
    if (claimed.has(r) || !r.pairing) continue;
    claimed.add(r);
    groups.push({
      key: `pair:${r.pairing.symbol.toLowerCase()}:${r.symbol.toLowerCase()}`,
      title: `$${r.symbol} × $${r.pairing.symbol}`,
      kind: "pairing",
      pairedWith: r.pairing.symbol,
      runners: [r],
    });
  }

  // 3. Shared launch venue. Weaker than a pairing but still a real theme —
  //    "eleven coins came off pump.fun today" is a sentence about the market.
  const rest0 = runners.filter((r) => !claimed.has(r));
  const byVenue = new Map<string, Runner[]>();
  for (const r of rest0) {
    if (!r.dex) continue;
    byVenue.set(r.dex, [...(byVenue.get(r.dex) ?? []), r]);
  }
  for (const [dex, members] of byVenue) {
    if (members.length < cfg.minVenueSize) continue;
    for (const m of members) claimed.add(m);
    groups.push({
      key: `venue:${dex.toLowerCase()}`,
      title: `Off ${venueName(dex)}`,
      kind: "venue",
      pairedWith: null,
      runners: members.sort((a, b) => (b.mcap?.high ?? b.fdvUsd) - (a.mcap?.high ?? a.fdvUsd)),
    });
  }

  // 4. Everything else splits on age. This is a weak grouping and is meant to
  //    be: it says "we know these ran and not why", which is honest.
  const rest = runners.filter((r) => !claimed.has(r));
  const fresh = rest.filter((r) => r.ageDays !== null && r.ageDays < cfg.freshDays);
  const older = rest.filter((r) => !fresh.includes(r));

  const byCap = (a: Runner, b: Runner) => (b.mcap?.high ?? b.fdvUsd) - (a.mcap?.high ?? a.fdvUsd);

  if (fresh.length > 0) {
    groups.push({
      key: "fresh",
      title: fresh.length === 1 ? "Launched Today" : "Today's Launches",
      kind: "fresh",
      pairedWith: null,
      runners: fresh.sort(byCap),
    });
  }
  if (older.length > 0) {
    groups.push({
      key: "established",
      title: "Already Trading",
      kind: "established",
      pairedWith: null,
      runners: older.sort(byCap),
    });
  }

  // Biggest story first, but multi-token themes outrank lone coins of similar
  // size: "eight coins ran on one thing" is the more interesting sentence.
  return groups.sort((a, b) => {
    const rankOf = (g: NarrativeGroup) =>
      g.kind === "pairing" && g.runners.length > 1 ? 3 : g.kind === "pairing" ? 2 : g.kind === "venue" ? 1 : 0;
    return rankOf(b) - rankOf(a) || groupWeight(b) - groupWeight(a);
  });
}

/** Flatten back to a ranked list, preserving group order. */
export function flatten(groups: NarrativeGroup[]): Runner[] {
  return groups.flatMap((g) => g.runners);
}
