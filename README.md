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

**v1, shipping daily.** Runner discovery, market-cap ranges, peak timing, the day
timeline, per-wallet trader P&L and generated narrative all run unattended at 09:00 UTC
and publish to GitHub Pages.

**v2 in progress: the pipeline is being inverted.** Measured against real fomo activity,
market cap turned out to be the wrong filter — see [Why the pipeline
inverted](#why-the-pipeline-inverted). Trader-led discovery is built and tested; it is
gated on read-only API access, with a manual export path in the meantime.

## Quick start

```bash
npm install
npm run daily        # recap -> narrate -> site  (the whole pipeline)

npm run recap        # writes data/<UTC-date>.json  (~3 min, keyless rate limit)
npm run narrate      # generates notes/<UTC-date>.json  (needs ANTHROPIC_API_KEY)
npm run site         # renders one page per day into site/
npm test             # guardrail tests

npm run grab         # capture a fomo profile from the clipboard -> input/
npm run traders      # aggregate exports; --onchain resolves tickers to pools
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
   ├─ pools per survivor   → what it's PAIRED WITH        (the catalyst)
   ├─ Birdeye per survivor → per-wallet P&L        (optional, needs key)
   ├─ group by shared pairing → the recap's sections
   │
   ├─ data/YYYY-MM-DD.json  → committed to the repo
   │
   ├─ narrate: Claude writes notes/YYYY-MM-DD.json from the snapshot,
   │           every claim filtered by validateOutput   (non-fatal if it fails)
   │
   └─ deploy:  render one page per day → GitHub Pages
```

The narration step is `continue-on-error` — a generation failure must never cost the
day's snapshot. It is *not* silent, though: a failed run posts a warning annotation and
a run-summary entry, because a broken generator that leaves the job green could go
unnoticed for weeks.

## Why the pipeline inverted

The original pipeline asked *what has a big market cap?* and used that as a proxy for
*worth writing about*. Checked against what fomo traders actually do, that proxy is
simply wrong.

Comparing the 10 coins discovery surfaced on 2026-09-11 against one top trader's activity:

| | |
|---|---|
| Coins the on-chain pipeline surfaced | 10 |
| That trader's open positions | 68 |
| **Overlap** | **1** — a $109 dust holding |
| His live trades below the $1m FDV floor | **30 of 34** |
| Median cap he trades | **$72k** — 14x below the floor |

The two halves were describing different markets. A thesis layer bolted onto the old
pipeline would almost never have matched anything.

So the question inverts: instead of finding big coins and asking who traded them, find
what traders with real followings bought and look those up. **Conviction and attention
replace market cap as the filter** — and "did someone with 15,815 followers put real
money in and explain why" is a far better proxy for *worth writing about* than a market
cap ever was.

Ranking is on **independent buyers**, then follower reach, then dollars. Not on price
performance: one trader buying is noise, four is a story, and price is what every other
tool already shows.

### Resolving a ticker to a real token

Trader exports give a ticker and the cap fomo displayed at trade time. Neither alone
identifies a token, because **tickers collide badly**. Searching `ONYC` returns a $310m
established token *and* the $47k microcap a trader actually bought. Taking the top hit
would publish a fabrication.

The reported market cap is the disambiguator. Against real trades, exact ticker + nearest
FDV resolved every symbol within **1.6x** while rejecting the ONYC imposter at **9,896x**
off. Liquidity breaks ties, because several correctly-matched pools are abandoned shells
with ~$0 reserves.

Unresolvable tickers return `null` and render as unverified. **A wrong token is worse
than an unresolved one.**

### Why the export is manual

fomo has no REST API — profile data arrives over a WebSocket, so there is nothing to
`fetch` from a cron job. The rendered page is only reachable behind a login, and that
session can trade, withdraw and export the wallet.

Putting such a credential in CI would be indefensible regardless of what the terms
permit, so the export stays manual until read-only API access is granted. `TraderDay` is
the contract; swapping the source replaces one file.

## The recap is sections, not a ranking

A daily recap is read for *what the market was doing*, not for a leaderboard. The
reference format clusters coins by shared catalyst and titles each cluster:

```
Rotate Back To Stonk
  $KNOTS   -> hit $45m, paired with $stonk
  $btc     -> hit $18.3m, bitcoin rewards
  $NEARKAT -> hit $9.7m, paired with $near
```

Eight coins running for one reason is the story. Ten unrelated facts in rank order is
not, and it is what every terminal already gives you.

**The clustering is mechanical, the naming is editorial.** Tokens sharing a pairing are
grouped by `src/group.ts`; the model is then handed those groups *as keys to name*. It
never decides who belongs with whom — a model asked to both cluster and label will
cheerfully cluster to fit a label it likes.

Each section prints its own basis underneath the title — *"3 coins trading against
$STONK · 61% of their volume"* — so a reader can check the grouping instead of trusting
the header. Coins with no shared pairing fall back to a split on age, which is a
deliberately weak grouping: it says "we know these ran and not why", which is honest.

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

**The guardrails are mechanical, not prompted.** Prompts can be talked around; a post-hoc
filter cannot. `validateOutput` checks every generated line *and every editorial label*:

| Check | Blocks |
|---|---|
| `unsupportedNumber` | Figures not derivable from that coin's snapshot. Clock times are stripped first so `15:00` isn't read as `15` |
| `copiesThesis` | 8-word overlap with any thesis — a licensing problem, so it is checked first |
| `crossDayClaim` | "same as yesterday", "second day", "last week". Evidence is one snapshot, so continuity claims are unsupported *by construction* |
| unsupported `@handle` / `$ticker` | Entities absent from the evidence |

Each was added after finding the failure in real output, not in the abstract. The
cross-day check exists because a generation labelled a coin "Same As Yesterday" — plausible,
uncheckable, and exactly the filler that erodes trust. Labels went unchecked entirely until
that surfaced, so a fabricated figure in a header reached the page while the same figure in
a timeline line was caught.

A bad label is blanked rather than dropping the coin: the timeline is still good, it just
loses its headline. Dropped lines are logged with a reason, never silently discarded.
See `src/generate.test.ts` and the policy table in [DECISIONS.md](DECISIONS.md).

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
This file **is** generated by `npm run narrate`, and hand-written notes are never
silently replaced — generation refuses to overwrite without `--force`. Write it by hand
whenever you know something the data cannot show.

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

## Where a catalyst comes from

A catalyst answers *why*, and price cannot contain the answer. Three mechanical
sources, in the order the pipeline prefers them:

| Source | Example | Cost |
|---|---|---|
| **Pairing** | `paired with $stonk` | 1 request per runner |
| **Namesake** | `named after Tesla` | a static list, free |
| **Theses** | `revenue over $1m a day, 30% of supply burnt` | manual capture |

Anything left gets no catalyst and one line on the page. `$TICKER -> hit $2m` is a
complete, honest entry; inventing a reason to fill the slot is the failure mode that
makes a recap worthless.

### Namesake

A large share of launches are named after something that already exists — a listed
company, an AI product, a brand. Eleven of twenty-four runners on one live scan were
wearing a real name, and "pump.fun turned into a stock-ticker costume party" is a
sentence about the market that costs nothing to derive.

**Exact matches only.** Saying a coin is "the Tesla play" because its ticker resembles
`TSLA` invents a narrative, which is the thing every guardrail here exists to prevent.
`TSLAX` and `APPL` deliberately do not match.

## Pairing is the catalyst

On launchpads like stonk.fun a coin is launched *paired* to another asset, and that
pairing is the reason it ran. The recaps this product is modelled on say so directly:

> `$KNOTS -> hit $45m, paired with $stonk`

That is derivable with no model and no platform data — it is just which pools the token
actually trades in. The pipeline was throwing it away: discovery filters to SOL and
stablecoin pools for sound pricing reasons, and the pairing went out with the distorted
percentage. On 2026-09-11 the `STONK/KNOTS` pools traded **$9.8m** against **$4.3m** in
`KNOTS/SOL` — the pairing was the token's main venue and the snapshot recorded only the
SOL side.

Price still comes from the SOL pool. The pairing comes from one extra request per runner.

### Share is what makes it a claim rather than arithmetic

A pairing is a relationship between unequals, and both tokens see the same pools. Taken
naively the pipeline reports `$STONK paired with $KNOTS`, which is true as arithmetic and
backwards as a claim — STONK is a $236m token that does not depend on a launch against it.

Share settles direction: that pair is **61% of KNOTS' volume and 7% of STONK's**. A floor
of 15% (and $25k) keeps the relationship pointing at the smaller token and drops dust —
several runners had sub-$5k pools whose only effect would have been to attach a
confident-sounding catalyst to a move they had nothing to do with.

## Liquidity is not reported, and that nearly hid the market

The single biggest coverage bug, and it looked nothing like one.

Coverage sat at 12 tokens against a reference format carrying 40+. The obvious suspect
was the market-cap floor. It was wrong — instrumenting rejections per filter showed
**liquidity** was cutting 135 of 178 pools.

GeckoTerminal returns near-zero `reserve_in_usd` for most pools on this network. On one
scan **128 of 177 pools reported under $1k of depth while doing $2.56bn of combined
volume**, and the day's biggest mover showed **$0 liquidity against $158m of volume**.
The field is absent, not small.

Two consequences, both fixed:

1. **A depth floor rejected the market, not the rugs.** Depth is now one of two ways to
   qualify — reported liquidity *or* demonstrated flow (volume plus the existing
   unique-buyer and market-cap floors). A rug with $3k of depth and $80k of volume still
   fails both. Coverage went 12 → 81 pools clearing filters.
2. **`churn` was computed as `Infinity`.** Since `Infinity` exceeds every threshold,
   every such coin was flagged `possible-wash-trading` and had its score cut 40% — which
   after the coverage fix would have been ~15 of 24 coins on the page carrying a public
   accusation generated by a missing number. Churn is now `null` when depth is unknown.
   **Unknown is not the same as bad.**

The lesson worth keeping: the run reported "178 pools → 12 runners" for days without
saying which threshold did the cutting. Counting rejections per filter took ten minutes
and immediately contradicted the obvious guess.

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
- **Cross-pairs are excluded from PRICING, not from the record.** A pool like `EMBER/MET`
  quotes its change in another volatile token, so the percentage doesn't mean what it
  appears to. But the pairing itself is usually *why the token moved* — see
  [Pairing is the catalyst](#pairing-is-the-catalyst).
- **Flags warn, they don't drop.** "This ran but looks washed" is itself worth saying.

## Known gaps

- **`minChange24hPct: 30` still biases toward launches.** Established coins rarely move
  30% in a day, so the page skews fresh. The coverage fix helped (81 pools clear the
  filters against 12), but an "existing coin that ran 3x" bucket would need its own
  thresholds.
- **Thesis capture is manual and therefore fragile.** It needs a person and a browser
  every day, and daily manual processes lapse. The archive survives a missed day — the
  on-chain half is fully automatic — but the *why* for that day is gone permanently.
  Read-only API access from the platform is the only real fix.
- **`bot-driven-selling` fires on nearly every runner.** The numbers are real (one runner
  had 3,047 unique buyers against 45 sellers doing ~29k sells), so it looks like a true
  property of fresh launches rather than a bad threshold. Weak discriminator, genuine
  finding — don't tune it just to make output look cleaner.
- **Trader sampling is volume-biased, and the sample is tiny.** Birdeye returns roughly
  the 8 highest-volume wallets out of thousands of buyers, so a modest-size winner is
  routinely missed. **Nothing on the page may state how many people made money** — it
  says "2 of 8 sampled", and `populationClaim` drops any generated line that doesn't
  disclose the sample. An earlier version wrote "only two real winners cleared here" for
  a token where one trader alone was up $1.17m. Fixing it properly means computing P&L
  from raw transaction history (Helius) rather than a pre-ranked endpoint.
- **Most coins get no catalyst.** Pairing covers some, namesake covers some, theses need
  manual capture. Everything else renders as one line saying what it hit and nothing
  more. That is the intended behaviour, not a gap to paper over — but it does mean a
  day with few pairings produces a thin page.
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
