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

> dontfomo@0.1.0 scaffold-example
> node --experimental-strip-types src/scaffold-example.ts 2026-09-12

# 2026-09-12

> **mood:** `<one line. what the whole day felt like.>`

## <title for this section>
key: `pair:met:ember`   <!-- all trading against $MET -->

```
$EMBER -> hit $49m (7.9x), <paired with $MET>
```

## <title for this section>
key: `namesake:stock`   <!-- named after: Apple, Google, Tesla, Amazon, Netflix -->

```
$AAPL -> hit $20m, <named after Apple>
$GOOGL -> hit $6.0m, <named after Google>
$TSLA -> hit $5.6m, <named after Tesla>
$AMZN -> hit $3.1m, <named after Amazon>
$NFLX -> hit $2.8m, <named after Netflix>
```

## <title for this section>
key: `namesake:ai`   <!-- named after: Anthropic, Nvidia, DeepSeek, OpenAI -->

```
$Anthropic -> hit $7.6m, <named after Anthropic>
$NVIDIA -> hit $4.3m, <named after Nvidia>
$DeepSeekAI -> hit $3.4m, <named after DeepSeek>
$OPENAI -> hit $2.9m, <named after OpenAI>
```

## <title for this section>
key: `venue:pumpswap`   <!-- same launchpad -->

```
$曙宝 -> hit $26m, <why — or delete this clause>
$FLYBRAIN -> hit $26m, <2 tokens shared this ticker>
$CATAI -> hit $24m, <why — or delete this clause>
$PAYAI -> hit $8.6m, <why — or delete this clause>
$armani -> hit $6.5m, <2 tokens shared this ticker>
$MONA -> hit $6.4m, <2 tokens shared this ticker>
$ALL -> hit $5.6m, <2 tokens shared this ticker>
$GRND -> hit $4.1m, <2 tokens shared this ticker>
$NIKE -> hit $3.7m, <named after Nike>
$ALLINU -> hit $3.6m, <why — or delete this clause>
$Stunk -> hit $3.2m, <why — or delete this clause>
$FLYFOX -> hit $2.7m, <why — or delete this clause>
$DKNG -> hit $2.2m, <2 tokens shared this ticker>
$Rockstar -> hit $1.5m, <why — or delete this clause>
```

<!--
  Every figure above is from the snapshot, so it is safe to keep.
  Delete any coin you would not have written about. A shorter example
  teaches restraint, which is the hardest thing to get from the model.
-->

> dontfomo@0.1.0 scaffold-example
> node --experimental-strip-types src/scaffold-example.ts 2026-09-12

# 2026-09-12

> **mood:** `<one line. what the whole day felt like.>`

## <title for this section>
key: `pair:met:ember`   <!-- all trading against $MET -->

```
$EMBER -> hit $49m (7.9x), <paired with $MET>
```

## <title for this section>
key: `namesake:stock`   <!-- named after: Apple, Google, Tesla, Amazon, Netflix -->

```
$AAPL -> hit $20m, <named after Apple>
$GOOGL -> hit $6.0m, <named after Google>
$TSLA -> hit $5.6m, <named after Tesla>
$AMZN -> hit $3.1m, <named after Amazon>
$NFLX -> hit $2.8m, <named after Netflix>
```

## <title for this section>
key: `namesake:ai`   <!-- named after: Anthropic, Nvidia, DeepSeek, OpenAI -->

```
$Anthropic -> hit $7.6m, <named after Anthropic>
$NVIDIA -> hit $4.3m, <named after Nvidia>
$DeepSeekAI -> hit $3.4m, <named after DeepSeek>
$OPENAI -> hit $2.9m, <named after OpenAI>
```

## <title for this section>
key: `venue:pumpswap`   <!-- same launchpad -->

```
$曙宝 -> hit $26m, <why — or delete this clause>
$FLYBRAIN -> hit $26m, <2 tokens shared this ticker>
$CATAI -> hit $24m, <why — or delete this clause>
$PAYAI -> hit $8.6m, <why — or delete this clause>
$armani -> hit $6.5m, <2 tokens shared this ticker>
$MONA -> hit $6.4m, <2 tokens shared this ticker>
$ALL -> hit $5.6m, <2 tokens shared this ticker>
$GRND -> hit $4.1m, <2 tokens shared this ticker>
$NIKE -> hit $3.7m, <named after Nike>
$ALLINU -> hit $3.6m, <why — or delete this clause>
$Stunk -> hit $3.2m, <why — or delete this clause>
$FLYFOX -> hit $2.7m, <why — or delete this clause>
$DKNG -> hit $2.2m, <2 tokens shared this ticker>
$Rockstar -> hit $1.5m, <why — or delete this clause>
```

<!--
  Every figure above is from the snapshot, so it is safe to keep.
  Delete any coin you would not have written about. A shorter example
  teaches restraint, which is the hardest thing to get from the model.
-->
