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

## 2026-09-11 — Invert the pipeline: traders and pairings pick the coins

**Decision.** Stop using market cap as the proxy for "worth writing about". Use what
tokens are paired against, what they are named after, and what traders said.

**Why.** Measured, not assumed. Of 10 coins the market-cap pipeline surfaced on
2026-09-11, exactly one appeared in a top trader's 68 open positions — a $109 dust
holding. 30 of his 34 live trades sat below the $1m floor, median cap ~$72k. The two
halves were describing different markets.

**Consequence accepted.** Coverage now depends on signals that are absent on some days.
A day with no pairings and no captured theses produces a page of one-line entries. That
is the correct output for such a day, and the temptation to pad it is the thing most
likely to make this product worthless.

## 2026-09-11 — Never state how many people made money

**Decision.** No surface — page, generated line, or section title — may state a count of
winners without disclosing that it is a sample. Enforced by `populationClaim`, not by
prompt.

**Why.** Trader data is roughly the 8 highest-volume wallets out of thousands of buyers.
A published line read "only two real winners cleared here" for a token where a single
trader was up $1.17m. That is not a cautiously-worded true fact; it is false, and it is
false in the direction that most damages a reader who was there.

**Consequence accepted.** Some genuinely interesting sentences cannot be written. "Nobody
made money on this" is often true and we may not say it.

## 2026-09-11 — A catalyst explains why; price restatement is blocked mechanically

**Decision.** `isPriceRestatement` drops any generated line carrying price facts that
names no mechanism, wallet fact, or pairing. Short launch/peak markers are exempt.

**Why.** An audit of the 15 lines published on 2026-09-11 found 14 were price
restatements — chart captions for a chart the reader is already looking at — and the one
survivor was the false winners claim. A style rule in the prompt had not prevented any
of it.

**Consequence accepted.** Coins whose only available fact is price now render as a single
line. Pages are shorter and more honest.

## 2026-09-11 — Unknown is not the same as bad

**Decision.** Missing data is represented as `null` and excluded from judgement, never
coerced to a value that happens to be actionable.

**Why.** `churn` was `volume / liquidity`, and liquidity is unreported for most pools on
this network. Computed as `Infinity`, it exceeded every threshold — flagging those coins
as possible wash trading and cutting their scores 40%. Roughly 15 of 24 coins would have
carried a public accusation generated entirely by an absent field. The same absent field,
used as a filter, had been rejecting 135 of 178 pools and holding coverage at 12.

**Consequence accepted.** Some real wash trading goes unflagged, because on a pool with
no reported depth we genuinely cannot tell.
