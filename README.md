# DontFomo

A daily recap of what ran on Solana, when it peaked, and who made money on it.

The tool assembles the timeline. You write the take.

## Why this exists

This is a **recap**, not a terminal. Dexscreener, Birdeye and a dozen others already
own "what are the numbers" — that market is saturated and free. The questions nobody
answers well are *what happened today, in what order, and who made money on it*.

Manual daily recaps (see [@mellometrics](https://x.com/mellometrics)) get real attention,
but the tedious half — finding what ran, pulling caps and participation, filtering rugs —
is mechanical. This automates that half and leaves the editorial half to a human.

## Status

**v1.** Runner discovery, market-cap ranges, peak timing, the day timeline and per-wallet
trader P&L all work against live data. Theses are the one remaining gap and are gated on
platform permission.

## Quick start

```bash
npm install
npm run daily        # recap -> narrate -> site  (the whole pipeline)

npm run recap        # writes data/<UTC-date>.json  (~3 min, keyless rate limit)
npm run narrate      # generates notes/<UTC-date>.json  (needs ANTHROPIC_API_KEY)
npm run site         # renders site/index.html
npm test             # guardrail tests
```

## Schedule

The Action runs at **09:00 UTC**, chosen from measured data rather than convenience.
Sampling seven days of Solana volume by hour:

| Window | UTC | Share per hour |
|---|---|---|
| Busiest | 12:00–15:00 | 5.3–9.3% |
| Quietest | 06:00–11:00 | 2.6–3.0% |

Running in the trough means the snapshot lands after the US session has wound down,
rather than catching coins mid-run. This matters concretely: a test run at 14:09 UTC
had **two of four coins peaking in the final candle** — still moving when captured.

Because hourly OHLCV is retroactive, one daily run can still reconstruct exact peak
times. There's no need to poll all day.

Suggested rhythm: snapshot 09:00 UTC → write takes → publish ~13:00 UTC, into the
highest-volume hour.

## How it works

```
09:00 UTC   GitHub Action
   │
   ├─ GeckoTerminal: top 200 pools by volume + 20 trending   (keyless)
   ├─ dedupe by base token, keep the deepest pool
   ├─ filter: quote token, liquidity, volume, market cap, gain, buyers
   ├─ OHLCV per survivor  → intraday low/high + peak time
   ├─ Birdeye per survivor → per-wallet P&L        (optional, needs key)
   │
   └─ data/YYYY-MM-DD.json  → committed to the repo
                │
   you  ────────┴─ notes/YYYY-MM-DD.json (hand-written) → npm run site → deploy
```

## The schema is the contract

`src/types.ts` is the stable interface between data collection and presentation.
One rule governs it:

> **Integrations may only fill fields in, never reshape them.**

Every trader- and thesis-layer field exists from day one as nullable. When platform
access lands we populate `Trader.handle`, `Trader.thesis`, `Trader.followers` — no
migration, no renderer rewrite, and the UI can be redesigned freely without touching
collection. `SCHEMA_VERSION` is bumped on breaking changes; readers stay tolerant of
older snapshots because the archive is append-only.

`traders: null` means *not fetched*; `traders: []` means *fetched, nobody qualified*.
The UI renders those differently on purpose.

## Narrative generation

`npm run narrate` writes `notes/<date>.json` — the same file a human would hand-write, so
the renderer needs no special case. It refuses to overwrite existing notes without
`--force`, so a hand-written day is never silently replaced.

**The guardrail is mechanical, not prompted.** `validateOutput` strips any generated line
naming an `@handle` or `$ticker` that isn't in the evidence block. Prompts can be talked
around; a post-hoc filter cannot. Dropped lines are logged with a reason, never silently
discarded. See `src/generate.test.ts` and the policy table in [DECISIONS.md](DECISIONS.md).

Every generated file records `_generated: {model, generatedAt, evidenceSha256}` so a bad
line is traceable and the input is reproducible.

### Tuning it

Two files drive output quality, in descending order of leverage:

| File | What it does |
|---|---|
| `prompts/examples.md` | Few-shot examples. **Highest leverage** — the model imitates these far more reliably than it follows abstract rules. Also the eval set. |
| `prompts/style.md` | Voice and format conventions. |

Both are injected into the cached system prefix. Note Opus needs a ~4096-token prefix
before prompt caching engages at all — with short prompt files, caching is a no-op.

## Writing the take by hand

The site renders prompts wherever human context belongs. Hand-write or edit
`notes/<YYYY-MM-DD>.json`:

```json
{
  "mood": "higher for longer",
  "coins": {
    "Arc": {
      "label": "Runner Of The Day",
      "timeline": [
        { "time": "14:20", "text": "@someone bought and posted a thesis (100k followers)" },
        { "time": "16:05", "text": "listed on X, volume tripled" }
      ]
    }
  }
}
```

Keys are token symbols as they appear in the snapshot; everything is optional.
**This file is never generated.** The catalyst behind a run is off-chain and social;
deriving it from price data would mean inventing it. Later this becomes AI-assisted
*from real theses* — which is augmentation, not fabrication.

> `notes/2026-09-10.json` currently holds clearly-marked `EXAMPLE` placeholders to
> demonstrate the populated layout. Replace before publishing.

## Data sources

| Source | Provides | Key | Cost |
|---|---|---|---|
| GeckoTerminal | pools, trending, OHLCV | none | free |
| Birdeye | per-wallet P&L per token | `BIRDEYE_API_KEY` | free tier: 30k CU/mo, 1 RPS |
| fomo | trade theses, handles, followers | **written permission** | — |

GeckoTerminal exposes pool aggregates only — it can say 2,031 wallets bought a token,
but not which wallets or what they made. That's why trader data needs a second source.

### Birdeye constraints (verified against live responses)

- `top_traders` **is** available on the free tier.
- `sort_by` accepts `volume` only — `sort_by=pnl` returns 400 "invalid format". So
  results are over-fetched by volume and ranked by P&L locally.
- `limit` is capped server-side: 5 returns 200, 50 returns 400. The client requests
  20 and retries once at 10.
- `volume` is denominated in **token units**; `volumeUsd` is the dollar figure.
- `firstTradeUnixTime` looks wallet-scoped rather than token-scoped (a sample returned
  a 2024 timestamp for a recent token), so out-of-window values are discarded.

**Known sampling limitation:** because results are volume-sorted and the cap is low, a
genuine winner who traded modest size can fall outside the returned set. Trader lists are
"top winners among the highest-volume wallets", not "top winners overall".

## Bots are the default, not the exception

The single most important thing live data revealed: **the highest-volume wallets on a
fresh launch are almost entirely MEV/bundler infrastructure.**

On one run, 4 of 5 runners had **8 of 8** top wallets tagged `bundler` — each ~2,900
trades, ~$2.5m volume, and *negative realised P&L* while showing positive totals. Their
"profit" was unrealised paper on a microcap already retracing.

Two consequences, both encoded in the pipeline:

1. **Wallets tagged `bundler` or `dev` are excluded from winner counts** (`botTags` in
   `DEFAULT_FILTERS`). They're still displayed — "every top wallet here was a bundler" is
   the most useful sentence on the page for that coin.
2. **Realised P&L is shown next to total.** A wallet up $17k total but down $3k realised
   has not made money; it is holding paper it may not be able to exit.

This is the differentiation. A 10x microcap where only bots profited is a *worse* story
than a 2x on a liquid coin where a human actually banked money — and the ranking reflects
that, because `bigWinners` outranks the price multiple.

### GeckoTerminal constraints

Discovered by testing, and both shape the design:

- `sort` accepts only `h24_volume_usd_desc` and `h24_tx_count_desc`. **There is no sort
  by price change**, so top gainers must be computed client-side — hence pulling a
  200-pool universe and ranking locally.
- Pagination hard-stops at page 10, capping that universe at 200 pools.
- Keyless limit is ~10 req/min; a full run takes ~3 minutes and occasionally 429s.
  The client backs off and retries.

## Why git is the database

Each day's snapshot is committed as JSON and never revised — free storage, free history,
and a **longitudinal record that can't be backfilled**. Point-in-time "what looked hot
today" is unrecoverable after the fact. On day 1 it's nothing; by day 90 it's an asset
nobody else has.

## Tuning

`DEFAULT_FILTERS` in `src/types.ts` is the product's point of view, not config trivia.
Sorting purely by 24h gain does not work — that list is dominated by $3k-liquidity rugs
that printed +1700% and round-tripped within the hour.

Notes from calibrating against live data:

- **Churn is age-scaled.** A token hours old legitimately trades hundreds of times its
  liquidity. A flat threshold flagged *every* result as wash trading, making the flag
  useless.
- **There's a market-cap floor.** Without it the list fills with sub-$500k coins doing
  2x, which nobody writes recaps about.
- **Cross-pairs are excluded.** A pool like `EMBER/MET` quotes its change in another
  volatile token, so the number doesn't mean what it appears to.
- **Flags warn, they don't drop.** "This ran but looks washed" is itself worth saying.

## Known gaps

- **Everything is `launched-today`.** Established coins rarely move 30%+ in a day, so
  they never clear the filters. Covering the "existing coin that ran 3x" category needs
  a second bucket with its own thresholds.
- **`bot-driven-selling` fires on nearly every runner.** The numbers are real (one runner
  had 3,047 unique buyers against 45 sellers doing ~29k sells), so it looks like a true
  property of fresh launches rather than a bad threshold. Weak discriminator, genuine
  finding — don't tune it just to make output look cleaner.
- **Trader sampling is volume-biased.** See the Birdeye constraints above — modest-size
  winners can be missed entirely. Fixing this properly means computing P&L from raw
  transaction history (Helius) rather than a pre-ranked endpoint.
- **Ranking is scored twice.** Discovery ranks on 24h open→close because the true
  multiple costs a call per token; the shortlist is re-ranked once real multiples and
  winner counts are known. A token outside the initial cut can't climb in.

## Platform data is ephemeral — never archived

Read permission was granted for fomo's content (2026-09-11). **Storage permission was
not.** Theses, handles and follower counts are fetched at render time, used, and dropped.

Three enforcement points, all tested:

| Boundary | Mechanism |
|---|---|
| Snapshot archive | `stripEphemeral` nulls platform fields before anything touches `data/` |
| Generated narrative | `validateOutput` drops lines reproducing ≥8 consecutive thesis words |
| Rendered page | `site/` is gitignored — deployed, not committed |

The second one is the non-obvious leak: a model quoting a thesis verbatim into
`notes/<date>.json` would re-create the archive we agreed not to build, laundered through
the LLM. Paraphrase and reference are fine; copying is blocked.

**Accepted consequence:** the longitudinal archive stays on-chain-only. We can never
backfill "what did traders say on day N" — that exists solely in that day's rendered page.
Correct given the permission scope, but it means the thesis layer never compounds the way
the price archive does.

## Legal note

Public on-chain and public API data only, plus platform content under explicit written
permission with the storage limits above. Scraping without permission is prohibited by
fomo's terms — the thesis layer was gated behind obtaining permission first, not behind
building it and hoping.
