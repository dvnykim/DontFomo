/**
 * Shared formatting helpers.
 *
 * Kept separate from run.ts so importing a formatter doesn't pull in (and
 * execute) the pipeline entrypoint.
 */

/** Compact market-cap notation, matching how traders write it: $8m, $746m, $1.2b. */
export function usd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}b`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
