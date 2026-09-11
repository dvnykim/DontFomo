# Golden examples

**This file is yours to write.** It is injected verbatim into the generation prompt as
few-shot examples, and it is the single highest-leverage thing you can edit — the model
imitates these far more reliably than it follows abstract style rules.

It doubles as the eval set.

## How to write one

Pick a day you know well. Write what the recap *should* have said, given only what was
knowable from the data. Don't write catalysts you learned from outside sources the
pipeline can't see — that teaches the model to invent them.

Aim for 5–10 coins across a few different days. More matters less than variety: include
a boring day, a day where a coin ran on nothing, and a day where the top wallets were
all bots. The model needs to see what "nothing to say here" looks like.

## Rules the examples must obey

1. **Every number in a timeline line must appear in its `evidence` block.** The validator
   drops lines with unsupported figures, so an example that breaks this teaches the model
   a habit that gets it filtered.
2. **Never name a wallet, handle or ticker that isn't in the evidence.**
3. **Short beats complete.** Two sharp lines outperform five hedged ones.
4. **Silence is a valid answer.** If a coin did nothing interesting, the example should
   show that — one flat line, no manufactured drama.

## Format

```
### $TICKER — <date>
label: <editorial header, e.g. "Runner Of The Day">
evidence: <the facts from the data this is built on>
timeline:
  HH:MM — <what happened, one line>
  HH:MM — <what happened, one line>
```

---

# 2026-09-10 — evidence pre-filled, timelines for you to write

The `evidence:` lines below are extracted verbatim from `data/2026-09-10.json`. Write the
`timeline:` lines in your own voice. That's the part the model is actually learning.

> **mood:** `<one line — what the whole day felt like. this sets the tone for everything.>`

---

### $baton — 2026-09-10
label: Runner Of The Day
evidence: launched 06:35, peaked 15:00 at $3.24m from $0.32m (10.2x), $60.7m volume,
  3048 buyers vs 46 sellers, 8 of 8 top wallets tagged bundler, 0 real winners above $10k
timeline:
  06:35 — <what a launch at $317k with no liquidity looks like>
  15:00 — <it 10x'd and not one human cleared $10k. that's the story — say it plainly>

### $CATE — 2026-09-10
label: <the only coin where a person actually made money — name it accordingly>
evidence: 46 days old, $35.27m base to $70.12m peak at 10:00 (2.0x), $17.8m volume,
  13407 buyers vs 13202 sellers, 1 real winner above $10k, 4 bots in top 8, no flags
timeline:
  10:00 — <a boring 2x on a liquid coin, but the only real winner all day. why that beats a 10x>

### $DeepSeek — 2026-09-10
label: <your call>
evidence: launched 14:05, peaked 16:00 at $2.37m from $0.58m (4.1x), $20.8m volume,
  2031 buyers vs 46 sellers, 8 of 8 top wallets bots, 0 real winners
timeline:
  14:05 — <->
  16:00 — <->

### $HOOD — 2026-09-10
label: <your call — note this is the same shape as DeepSeek, launched 13:45 vs 14:05>
evidence: launched 13:45, peaked 16:00 at $2.33m from $0.67m (3.5x), $25.5m volume,
  2017 buyers vs 40 sellers, 8 of 8 top wallets bots, 0 real winners
timeline:
  16:00 — <when two coins run identically, saying so once is better than saying it twice>

### $KIMCHI — 2026-09-10
label: <your call>
evidence: launched 02:36, peaked 03:00 at $1.44m from $0.46m (3.1x), $16.9m volume,
  3070 buyers vs 65 sellers, 8 of 8 top wallets bots, 0 real winners
timeline:
  03:00 — <peaked 24 minutes after launch. this is the "nothing to say" case — keep it to one line>

---

# The examples that matter most

These two teach restraint, which is the hardest thing to get from a model. Fill them in
from any day you remember — they don't have to be from a snapshot we have.

### <a day when nothing ran>
label: —
evidence: <e.g. nothing cleared the filters; best mover was 1.4x on thin volume>
timeline:
  <one line. resist the urge to fill space. "quiet day, nothing worth chasing" is a
   complete recap and the model needs permission to write it.>

### <a coin that ran on nothing>
label: <->
evidence: <big multiple, no catalyst visible in the data>
timeline:
  <say that no reason was visible. do NOT invent a narrative — this example exists
   specifically to teach the model not to.>
