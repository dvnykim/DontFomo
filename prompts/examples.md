# Golden examples

**This file is yours to write.** It is injected verbatim into the generation prompt as
few-shot examples, and it is the single highest-leverage thing you can edit — the model
imitates these far more reliably than it follows abstract rules.

It doubles as the eval set.

## A note on where the format came from

The structure below — sections titled by theme, coins as `$TICKER -> hit $Xm, why` — is
modelled on how memecoin recaps are actually written and read. The *shape* is the useful
part and is what this file encodes.

Do not paste anyone else's recap in here as an example. The voice has to be yours, or the
model learns to imitate someone imitating them, and the result reads like a knock-off of a
thing people already follow.

## Start from a real day, not a blank page

```bash
npm run scaffold-example -- 2026-09-11 >> prompts/examples.md
```

That prints the day's real structure with every FIGURE already filled in from the
snapshot and every JUDGEMENT left blank. The facts are the tedious half and are already
known; the voice is the half that has to be yours.

Then: write the section titles, write the `why` clauses, and **delete any coin you would
not have written about**. The deleting matters as much as the writing — a shorter example
teaches restraint, which is the hardest behaviour to get and the one that keeps the page
worth reading.

## How to write one

Pick a day you remember. Write the sections as they should have read, using only what the
pipeline could actually know.

Aim for a handful of days with real variety. The two that matter most are at the bottom:
a dead day, and a coin that ran on nothing. Those teach restraint, which is the hardest
behaviour to get and the one that keeps the page trustworthy.

## Rules an example must obey

1. **Every figure must be derivable from that day's snapshot.** An example that breaks
   this teaches a habit the validator then deletes.
2. **Section titles name the theme, not the mechanism.** "Rotate Back To Stonk", not
   "Paired With $STONK" — the mechanism is already printed under the title.
3. **Never state how many people made money.** Trader data is a sample of ~8 wallets.
4. **No claims about other days.** Each run sees one snapshot.
5. **Silence is a valid line.** `$TICKER -> hit $2m` with no reason is complete and honest.

## Format

```
## <Section Title>            <- 2-5 words, names the theme
key: pair:stonk               <- the group key from the evidence
note: <one line, or omit>     <- only if true of the whole section

$TICKER -> hit $Xm (Nx), <why>
$TICKER -> hit $Xm, <why>
```

---

# Day 1 — <date>

> **mood:** `<one line. what the whole day felt like.>`

## <title for the paired group>
key: `pair:<symbol>`
note: `<omit unless there is something true of all of them>`

```
$<A> -> hit $Xm (Nx), <what was different about THIS one, not the shared premise>
$<B> -> hit $Xm, <->
```

## <title for the launches>
key: `fresh`

```
$<C> -> hit $Xm, <->
```

---

# The two that matter most

### A day when nothing ran
> **mood:** `<->`

```
<One line, or an empty page. "quiet day, nothing worth chasing" is a complete recap.
 The model needs permission to write it, and only an example gives that.>
```

### A coin that ran on nothing
```
$<D> -> hit $Xm
<No reason. Do NOT invent one — this example exists specifically to teach that.>
```
