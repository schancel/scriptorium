# Illumination

**Implemented by:** `core/illumination.ts`, `core/keyboard.ts`, `core/corpus.ts`

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

- **live** — every key the character costs is in the current stage's key set. The player
  must type it. The cursor will not advance until they do.
- **greyed** — some key it costs is not yet taught. It renders dimmed and
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
stage's key set — *every* key it requires, not merely the one it prints. This is checked
exhaustively over the whole corpus, not sampled, and it is the single most important
correctness property in the codebase. One leaked `z` at
stage 2 and the player is hunting for it — which is the exact behaviour the game exists
to eliminate.

Space is live from stage 0. It is a thumb key, both thumbs rest on it, and it is roughly
18% of all keystrokes; withholding it would gut the density numbers below for no
pedagogical gain.

Because it prints nothing, a live space still has to be *shown* — the rail marks one that
is owed rather than leaving a gap. See [the space affordance](02-rail.md#the-space-affordance).
Which thumb it is credited to is the player's preference, not a property of the key; see
[stats](08-stats.md#nine-rows-not-ten).

## Strokes

A character is not a key. A capital is **two keys struck by two hands** — a shift held
with one, the letter with the other — and `:` is shift and `;` together. So a live glyph
carries a *list of strokes*, each a key and the finger that should strike it, modifiers
first and the printing key last. A greyed glyph carries none: nothing is being asked for.

This is not bookkeeping. A model with one key per character loses three things, and all
three of them are stage 8:

- the [mastery gate](06-curriculum.md#the-mastery-gate) measures a stage's *new keys*, so
  with the shift half of every capital invisible, `<shift>` received **zero samples** and
  the stage that exists to teach two-handed shifting gated on `'`, `:`, `;` and `-`
  instead — on anything except the skill.
- the overlay could only ever light the letter, so the one crutch the player has says
  nothing about the key he does not know how to reach.
- **which** shift could not be named at all. See below.

### The shift is the opposite hand's

Correct technique is the *far* shift: a left-hand letter takes the right shift, a
right-hand letter the left. Shifting with the striking hand rolls the wrist off home row
for every capital in the corpus, and it is exactly what a two-finger typist does today.

So the shift stroke's finger is a fact about the *letter*, not about the key — the same
`<shift>` is a right-pinky stroke for `A` and a left-pinky stroke for `J`. That is why a
stroke carries its finger rather than looking one up: no table keyed on the key could
answer it. The rule itself lives in `core/keyboard.ts` beside the finger table.

The curriculum names **one** `<shift>`, because it teaches one skill and the statistics
should read as one skill. The board has two shift keys, and turning the curriculum's key
into the physical one is the overlay's job alone, at the moment of drawing it — so the
overlay lights the letter and the far shift together, which is what teaches the habit.

## Which finger, and which keys

Classification asks two questions of the physical keyboard: *which keys does this
character cost*, and *which finger strikes them*. Neither is illumination's business, and
both are answered by `core/keyboard.ts`, which has to know the board anyway to draw the
overlay. There is one finger table in the codebase and one shifted-character table, and
`illumination.fingerFor` is a throwing wrapper over the first of them.

This used to be two independent tables. They agreed on the day they were written, which
is the only day that can be checked by eye; the first edit to either would have parted
them, and the symptom — the overlay teaching one finger while the report card scores
another — is not the kind of bug that announces itself. `core/keyboard.test.ts` now
asserts the mapping covers every key of every stage in `data/curriculum.json`, on both
layouts.

**The finger mapping never affects classification.** Layout and thumb preference change
only the *answer to which finger*, never which characters a stage lights — a UK player
and a left-thumb player unlock exactly the same text at exactly the same stage.

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

## Gilding: a mode for people who already type

Withholding letters helps a beginner and hinders a fluent typist. At speed you type
words, not letters -- the motor program for a familiar word fires as a unit -- so omitting
a letter mid-word means suppressing an automatic action. That is more work, not less.

**Gilding** is an opt-in mode, off by default and remembered per player. With it on,
every character in the passage is required: nothing auto-advances, and characters outside
the current stage are *gilded* as they are typed. A part completed with every character
is a fully illuminated page and earns gold leaf.

The name is the theme's -- a scribe filling in the gold on a manuscript gilds it.

It is a mode rather than a permissive free-for-all because intent cannot be read from a
keystroke. With greyed characters merely *optional*, a wrong key before a greyed run is
indistinguishable between a fumbled gild and a fumbled attempt at the live character, and
every way of resolving that guess breaks something. See
[ADR 0008](../decisions/0008-gilding-permissive-input.md).

**The mastery gate counts only the current stage's keys, in both modes.** Gilded keys are
by definition untaught, so they cannot open a gate -- otherwise a fluent typist would be
promoted through a curriculum they never did, and the stage numbers would stop meaning
anything for the beginner they exist to serve. Someone who wants to skip ahead sets their
stage in the menu, which is one honest control rather than a hidden side effect.

## Feel

Greyed runs auto-advance with **no animation delay** — the cursor snaps from one live
character to the next rather than crawling through the dim ones. A crawl makes the
player wait on the game, which is the opposite of player-paced.

That snap behaviour is the first thing to tune once a real beginner plays it, and the
timing lives in [tuning](07-tuning.md) rather than in the code.
