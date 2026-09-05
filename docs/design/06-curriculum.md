# The curriculum

**Implemented by:** `core/curriculum.ts`

## Ordering

Frequency-weighted rather than strictly row-by-row. The ordering directly controls how
much of the page is lit at each stage — see [illumination](01-illumination.md#density) —
and reading real text early is half the point of the project. Each stage's new keys are
still reachable from fingers already anchored on home row, so this trades none of the
mechanical discipline of a row-by-row tutor.

## Stages

<!-- generates: data/curriculum.json -->

| stage | keys | coverage | description |
|---|---|---|---|
| 0 | `f j <space>` | 0.21 | the two bumps and the space bar, no verses yet |
| 1 | `a s d f g h j k l ;` | 0.46 | scattered letters lit |
| 2 | `e i` | 0.61 | short words fully lit |
| 3 | `r u` | 0.67 | most short words lit |
| 4 | `t o` | 0.80 | sentences mostly readable as typed |
| 5 | `n y` | 0.86 | only the odd dim letter left |
| 6 | `c m w v b p` | 0.94 | every lowercase letter lit |
| 7 | `q x z , . /` | 0.97 | punctuation joins in |
| 8 | `<shift> ' : ; -` | 1.00 | capitals and the last punctuation: the whole verse |
| 9 | `0 1 2 3 4 5 6 7 8 9` | 1.00 | the numbers in verse references |

`/` is in stage 7 because `?` is shift+`/` on US ANSI. Without it, every question mark in
the corpus -- there are 6,557 -- stays permanently greyed, and stage 8 could never reach
the "fully illuminated" coverage it claims.

`description` is **player-facing copy**, not a note to ourselves. It is the promotion
panel's lead sentence and the label beside every entry in the menu's stage picker, so it
follows [the tone](10-first-run.md#tone) and uses the player's vocabulary rather than
ours: a character the stage has taught is *lit* and one it has not is *dim*, never `live`
or `greyed` or `illuminated` -- three words this interface has never defined for him.

`keys` is cumulative in effect — each stage's key set is the union of its own row and
every row above it. `coverage` is the **measured** fraction of live keystrokes, from `tools/build_wordlists.py`
run over all 8.1 million characters of WEB and KJV. Re-run it after any change to this
table; it writes the full breakdown to `data/coverage.json` and fails loudly if stage 1
drops below `min_stage1_coverage`.

Stages 1-5 beat the original letter-frequency estimate by a wide margin -- stage 1 lights
up 46% of keystrokes rather than the predicted 40%, which is the difference between the
first hour feeling like typing and feeling like watching.

Stage 8 matters more than its position suggests. Proper two-handed shifting — left shift
for right-hand capitals and vice versa — is a skill two-finger typists never acquire, and
it is taught explicitly here rather than assumed.

`<shift>` is one key in this table and two on the board, deliberately. It is one *skill*,
so the gate below and the report card should both read as one number; which of the two
physical shifts a capital wants is decided per character, from the letter's hand, and only
the overlay ever needs the answer. See
[illumination: the shift is the opposite hand's](01-illumination.md#the-shift-is-the-opposite-hands).

## The mastery gate

A stage unlocks when, **on that stage's new keys specifically**:

- accuracy is at or above the threshold over the trailing window, **and**
- median keystroke latency is below the stage's threshold

Thresholds live in [tuning](07-tuning.md).

A capital counts toward this gate as a keystroke on `<shift>` *and* one on its letter,
because that is what the hands did. It contributes a single latency sample, on the letter:
one keypress is one measurement, and crediting the modifier with it too would put every
capital into the median twice. So at stage 8 the accuracy half of the gate is carried
largely by shifting, which is the point — a stage-8 player who never shifts correctly
cannot pass by typing colons well. See [stats](08-stats.md#definitions).

**The gate counts only this stage's new keys, in both modes.** With
[gilding](01-illumination.md#gilding-a-mode-for-people-who-already-type) on, a player types
the untaught characters too -- and none of it reaches the gate, because a gilded character
records no key statistics at all. Counting them would promote a fluent typist through a
curriculum they never did, and the stage numbers would stop measuring what they claim for
the beginner they exist to serve. See
[ADR 0008](../decisions/0008-gilding-permissive-input.md#why-gilding-must-not-open-the-gate).

**The menu sets the stage directly.** That is the honest route for someone who already
types, and it is what makes leaving the gate alone affordable: skipping ahead is one
control the player operates out loud rather than a hidden consequence of a difficulty
mode. Setting it clears the trailing window -- which held the old stage's new keys -- and
touches nothing else: not the history, not the lifetime totals, not the bookmark.

Both conditions are required, and the second one is the important one. Accuracy alone can
be satisfied by typing slowly and looking down — which is exactly the habit being
replaced. **Slow-but-accurate is the hunt-and-peck signature and must not pass the gate.**
There is a test asserting precisely that.

## Breaking the looking-down habit

Escalating, so the support is withdrawn as it stops being needed:

1. **Keyboard overlay.** An on-screen keyboard with the next key highlighted, colour-coded
   by which finger should strike it. On by default. A capital highlights **both** of its
   keys — the letter and the shift on the *opposite* hand — because the reach the player
   does not know is the shift, and lighting the near one would drill the wrist-rolling
   habit this stage exists to replace.
2. **Earned fade-out.** Once a key's accuracy passes threshold, that key stops being
   *pointed at*: it no longer lights gold when it is owed, and it drops the finger colour
   that was telling him which finger to strike it with. The crutch removes itself key by
   key, as it is earned, without the player ever choosing to give it up — and what comes
   up behind the board is [the scribe at his lectern](02-rail.md#the-scribe-at-his-lectern),
   uncovered a key at a time rather than introduced at a threshold.

   **The key itself is still drawn, always.** This once removed the key from the overlay
   outright, and the owner reported it as a bug within the evening: *"why are some keys
   missing from the keyboard?"* Two things were wrong with it. A board with holes in it
   is not the board under his hands, which [the layout rule below](#keyboard-layout)
   forbids outright; and a reward that reads as damage is not a reward. So the band is
   given back by **receding the whole overlay together** — its opacity falls with the
   share of the stage's keys that have retired, down to `overlay_retired_alpha`, and the
   lectern rises through it at the same rate. The reveal stays gradual and unannounced,
   which was the good half of the idea, and the picture stays whole, which is the half
   that was missing.

   **Measured over a lifetime, not over a stretch.** A key is earned across weeks, and
   a stretch of verses is a hundred and fifty keystrokes spread over nine fingers — fewer
   than `mastery_min_samples` on most of them. Judged from the part in front of him, a
   key a player retired months ago comes back at the top of every stretch and the crutch
   is never actually given up. The card reads the lifetime table for the same reason; see
   [stats](08-stats.md#reachable-on-purpose).
3. **The report card.** Per-finger accuracy and speed after every level. A two-finger
   typist's card is unmistakable — two columns of data and eight empty ones. Making that
   visible is half the battle. See [stats](08-stats.md).

## Keyboard layout

The overlay must match the player's physical keyboard exactly, or it teaches the wrong
finger for `'`, `#` and `\`. US ANSI is the default; ISO (UK and most of Europe) has a
taller Enter and an extra key beside it and is selectable. Layout affects the overlay and
finger mapping only — never the curriculum or the illumination sets.
