# Golden examples

**This file is yours to write.** It is injected verbatim into the generation prompt as
few-shot examples, and it is the single highest-leverage thing you can edit — the model
imitates these far more reliably than it follows abstract style rules.

It doubles as the eval set: `npm run eval` scores generated output against these.

## How to write one

Pick a day you know well. Write what the recap *should* have said, given only what was
knowable from the data. Don't write catalysts you learned from outside sources the
pipeline can't see — that teaches the model to invent them.

Aim for 5–10 coins across a few different days. More matters less than variety: include
a boring day, a day where a coin ran on nothing, and a day where the top wallets were
all bots. The model needs to see what "nothing to say here" looks like.

## Format

Repeat this block per coin. Delete the placeholder below once you've added real ones.

```
### $TICKER — <date>
label: <editorial header, e.g. "Runner Of The Day">
evidence: <the one or two facts from the data this is built on>
timeline:
  HH:MM — <what happened, one line>
  HH:MM — <what happened, one line>
```

---

<!-- PLACEHOLDER — delete this block and add real examples.
     Generation still works without examples; output will just be more generic. -->

### $EXAMPLE — 2026-09-10
label: Runner Of The Day
evidence: launched 06:35, peaked 15:00 at $3.2m (10.2x), 8/8 top wallets tagged bundler
timeline:
  06:35 — launched, no liquidity to speak of
  15:00 — topped at $3.2m. every wallet in the top 8 was a bundler bot
