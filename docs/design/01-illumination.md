# Illumination

**Implemented by:** `core/illumination.ts`, `core/corpus.ts`

The central mechanic, and the reason the Bible works as a beginner corpus at all.

## The problem it solves

A curriculum that teaches home row first can only ask for words spelled with
`a s d f g h j k l ;`. Filter Genesis down to those and you get `ask`, `fall`, `a lad`,
`alas`, `salad`. That is not Scripture, it is not interesting, and it throws away the
entire reason for using this text.

The alternative — showing whole verses immediately — teaches nothing, because every
unlearned letter is an invitation to look down and hunt for it. See
[ADR 0003](../decisions/0003-illumination-over-corpus-filtering.md).

## Classification

The real verse is always displayed in full. Each character is classified:

- **live** — the character's key is in the current stage's key set. The player must
  type it. The cursor will not advance until they do.
- **greyed** — the character's key is not yet taught. It renders dimmed and
  auto-advances the moment the cursor reaches it. The player never presses it and is
  never shown where it is.

```
stage 1   In t[h]e be[g]innin[g] Go[d] cre[a]te[d] t[h]e [h]e[a]ven[s] [a]n[d] t[h]e e[a]rt[h].
stage 3   [I]n t[he] [be][g]innin[g] Go[d] c[rea]t[ed] t[he] [heas] [a]n[d] t[he] [ea]rt[h].
stage 6   every lowercase letter live; only capitals and punctuation still greyed
stage 8   fully illuminated — the verse exactly as printed
```

The metaphor is exact and was the reason for the project's name: an illuminated
manuscript, lit letter by letter as the scribe earns it.

**Invariant.** No character classified live may require a key outside the current
stage's key set. This is checked exhaustively over the whole corpus, not sampled, and it
is the single most important correctness property in the codebase. One leaked `z` at
stage 2 and the player is hunting for it — which is the exact behaviour the game exists
to eliminate.

Space is live from stage 0. It is a thumb key, both thumbs rest on it, and it is roughly
18% of all keystrokes; withholding it would gut the density numbers below for no
pedagogical gain.

## Density

Illumination only works if enough of the page is live to feel like typing rather than
watching. With the full home row (including the `g` and `h` index-finger stretches) plus
space, roughly **40% of keystrokes in ordinary English prose are live at stage 1**.

That estimate comes from English letter frequency and must not be trusted. The real
figure is computed against the actual text by `tools/build_wordlists.py` and written to
`data/coverage.json`. If measured stage-1 coverage over Genesis lands below ~30%, the
stage boundaries in [the curriculum](06-curriculum.md) move before anything else is
built.

Two mechanisms keep density up where the text is unhelpful:

- **Passage selection.** Early levels prefer passages scoring above-average live density
  for the current stage, so a beginner is not dropped into a genealogy of unlearned
  proper nouns.
- **Drill interludes.** Short bursts between passages using words drawn from that same
  chapter which are *fully* typable at the current stage. Keeps keystrokes-per-minute up
  without breaking the reading.

## Feel

Greyed runs auto-advance with **no animation delay** — the cursor snaps from one live
character to the next rather than crawling through the dim ones. A crawl makes the
player wait on the game, which is the opposite of player-paced.

That snap behaviour is the first thing to tune once a real beginner plays it, and the
timing lives in [tuning](07-tuning.md) rather than in the code.
