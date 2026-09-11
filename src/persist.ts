/**
 * What is allowed to touch disk.
 *
 * `data/` is committed to a public repo permanently. Permission to *read* fomo's
 * content is not permission to *archive* it — see DECISIONS.md. Platform-sourced
 * fields are fetched at render time, used, and dropped.
 *
 * Kept in its own module (rather than in run.ts) so it is testable without
 * executing the pipeline entrypoint.
 */

import type { Snapshot } from "./types.ts";

/**
 * Strips platform-sourced fields from a snapshot before serialisation.
 *
 * This is the last line of defence: even if an upstream change starts populating
 * these fields, nothing platform-derived reaches the committed archive. On-chain
 * data (wallet, P&L, volume, trade counts) is public and stays.
 */
export function stripEphemeral(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    runners: snapshot.runners.map((r) => ({
      ...r,
      traders:
        r.traders?.map((t) => ({
          ...t,
          handle: null,
          thesis: null,
          thesisPostedAt: null,
          followers: null,
        })) ?? null,
    })),
  };
}
