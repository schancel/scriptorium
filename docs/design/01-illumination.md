# Illumination

**Implemented by:** `core/illumination.ts`, `core/keyboard.ts`, `core/corpus.ts`, `core/typing.ts`

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

That is enforced by *construction*, not by care: a gilded character reaches `keyStats`
with nothing at all -- no hit, no error, no latency -- so there is nothing in the table the
gate reads for it to find. See [stats](08-stats.md#which-characters-count-depends-on-the-mode).

### Producible is not the same as live

Classification answers two questions per character, not one. `live` is a statement about
the *stage*: every key this character costs has been taught. `producible` is a statement
about the *board*: some keyboard makes this character at all.

Illumination only needs the first. Gilding needs both, because "every character is
required" would otherwise be a wall at the first em dash or curly quote in an imported
book -- characters no key produces at any stage. Those still snap past in gilding mode,
exactly as greyed runs do without it. The snap is instant and the cursor never rests on
one, so nothing ambiguous is reintroduced: the character under the cursor is always a
target the player can strike.

Producibility never varies by stage and never affects `live`. The illumination invariant
is untouched by the mode.

### How it reads on screen

- The character under the cursor is a target whether it is live or greyed, so the caret
  rests on greyed characters and the error colour applies to them.
- A greyed character **behind** the cursor -- one the player has typed -- is drawn **gold**.
  The page gilds itself behind the scribe, which is the whole of the metaphor and the only
  feedback that says the extra work registered.
- A greyed character **ahead** of the cursor is still dim. It is still untaught; the mode
  changes what is asked for, not what has been taught.
- The keyboard overlay lights **nothing** while the cursor sits on a gilded character.
  Pointing at the next live character would name a key that is not being asked for, and
  pointing at the greyed one would show a beginner where an untaught key lives -- which is
  the habit this whole mechanic exists to remove.
- The HUD carries the **score** beside WPM and accuracy — the gild total is the bulk of it
  in this mode — and carries it whenever the player has one. It is absent at zero: a number
  nobody can move is not worth the room. It is no longer gilding-only, because an
  [ink pot at full hearts](03-pacing.md#an-ink-pot-at-full-hearts-must-still-be-worth-something)
  scores too, and points paid into a counter the player cannot see are not paid at all.

### Being offered it

The game may offer the mode after `gild_offer_sessions` consecutive sessions at or above
`gild_offer_wpm`. It **offers**; it never switches itself on, and there is no code path
from the check to the switch. The offer is made once and both answers are remembered --
an offer that reappears after every good session has stopped being an offer.

The offer says out loud that the mode will not move the player's stage, and names the
menu's stage control in the same breath. The one thing a player might reasonably hope for
here is a shortcut through the curriculum, and letting them discover otherwise by playing
would be a worse way to say it.

## Feel

Greyed runs auto-advance with **no animation delay** — the cursor snaps from one live
character to the next rather than crawling through the dim ones. A crawl makes the
player wait on the game, which is the opposite of player-paced.

That snap behaviour is the first thing to tune once a real beginner plays it, and the
timing lives in [tuning](07-tuning.md) rather than in the code.
