# Decisions

Standing decisions and their rationale, so neither of us re-litigates them later.

---

## 2026-09-11 — Publish without human review

**Decision:** the daily recap generates and publishes unattended. No approval gate.

**Recommendation at the time was against this.** The argument for a gate: a model error
goes public under Daniel's name and is discovered by readers rather than by us, and this
product exists as a credibility layer — a wrong call screenshotted is expensive in a way
that a 30-second daily approval is not.

**Chosen anyway, deliberately.** Full automation is the point of the product.

**Mitigations built instead of a gate:**
- Every generated line carries provenance (`model`, `generatedAt`, `evidenceSha256`)
- Unsupported claims are dropped mechanically before render (see below)
- Empty output is a valid outcome — the pipeline never pads a thin day

---

## 2026-09-11 — Free inference on narrative, hard limits on people

**Decision:** the model may infer freely to match the reference recap voice.

**Scoped, because unrestricted inference about named people is a different risk class
than inference about markets.** The line is drawn at identifiable individuals:

| Claim type | Policy |
|---|---|
| Market narrative, metas, "this ran alongside X" | Free rein |
| Characterisation — "hated rally", "round-tripped" | Free rein |
| A named person **did** something | Must appear in evidence |
| A named person's **motive**, intent, or wrongdoing | Never asserted |
| Quotes, theses, follower counts | Verbatim from evidence only |

**Why this specific line:** the reference recaps are mostly verifiable facts plus light
characterisation. *"@rstrosrs is acquiring robinhood hats"* is a fact; *"essentially
running the kabuto king technique"* is characterisation. Neither requires invention.
What's excluded is the model independently concluding someone rugged their followers —
which is both the least defensible output and the one most likely to draw a response.

**Enforcement is mechanical, not prompted.** `validateOutput` in `src/generate.ts` strips
any line naming an `@handle` or `$ticker` absent from the evidence block. Prompts can be
talked around; a post-hoc filter cannot. Dropped lines are logged, not silently discarded.

---

## 2026-09-11 — Model: `claude-opus-4-8`

**Decision:** default to Opus 4.8 rather than a cheaper tier.

Roughly $9/month vs ~$2/month for Haiku 4.5 at this volume. Chosen because output
publishes unreviewed under Daniel's name, so generation quality is doing more work than
usual. Override with `DONTFOMO_MODEL` if the cost/quality trade shifts.

---

## Earlier — no scraping without permission

The fomo app's terms explicitly prohibit automated extraction. The project was built
on-chain-first for this reason, with thesis/handle/follower fields present but null,
so platform access would only ever *fill fields in* rather than reshape the schema.

Permission has since been granted (2026-09-11, written, no API).

**Scope as confirmed by Daniel:**

| Question | Answer |
|---|---|
| May we store their content? | **No.** Read, hold in memory, discard after render. |
| Rate limits / crawl constraints? | None specified — set our own conservatively. |
| Attribution required? | Not required. |
| Who does the grant name? | Both Daniel personally and DontFomo. |

---

## 2026-09-11 — fomo data is ephemeral, never persisted

**Decision:** fomo-derived content (theses, handles, follower counts) is fetched at
render time, held in memory, and discarded. It is never written to `data/`, which is
committed to a public repo permanently.

**Why this is stricter than it first looks.** The obvious case is the snapshot archive.
The non-obvious one is the *generated narrative*: if the model quotes a thesis verbatim
into `notes/<date>.json`, that file is committed — and we have re-created the archive we
just agreed not to build, laundered through the LLM.

**Enforcement:**
- `Trader.thesis` / `handle` / `followers` are populated only in the in-memory object
  passed to the renderer. `writeSnapshot` strips them before serialising.
- `validateOutput` rejects any generated line reproducing a significant verbatim run from
  a thesis. Paraphrase and reference are fine; copying is not.
- `site/` is gitignored, so rendered HTML carrying thesis text is deployed but not archived.

**Consequence, accepted:** the longitudinal archive stays on-chain-only. We will never be
able to backfill "what did traders say on day N" — that data exists only in the rendered
page for that day. This is the correct trade given the permission scope, but it does mean
the thesis layer never becomes a compounding asset the way the price archive does.
