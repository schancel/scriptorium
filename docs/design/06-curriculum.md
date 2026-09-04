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
| 0 | `f j <space>` | 0.20 | anchor drill only, no verses |
| 1 | `a s d f g h j k l ;` | 0.40 | scattered letters lit |
| 2 | `e i` | 0.55 | short words fully lit |
| 3 | `r u` | 0.62 | most short words |
| 4 | `t o` | 0.75 | sentences mostly readable as typed |
| 5 | `n y` | 0.82 | occasional greyed letter |
| 6 | `c m w v b p` | 0.95 | all lowercase live |
| 7 | `q x z , .` | 0.97 | punctuation joins in |
| 8 | `<shift> ' : ; -` | 1.00 | fully illuminated verses |
| 9 | `0 1 2 3 4 5 6 7 8 9` | 1.00 | verse references, chapter navigation |

`keys` is cumulative in effect — each stage's key set is the union of its own row and
every row above it. `coverage` is the *predicted* fraction of live keystrokes, from
English letter frequency. It is a placeholder: `tools/build_wordlists.py` measures the
real figure against the corpus and writes `data/coverage.json`, and these numbers get
corrected from that measurement.

Stage 8 matters more than its position suggests. Proper two-handed shifting — left shift
for right-hand capitals and vice versa — is a skill two-finger typists never acquire, and
it is taught explicitly here rather than assumed.

## The mastery gate

A stage unlocks when, **on that stage's new keys specifically**:

- accuracy is at or above the threshold over the trailing window, **and**
- median keystroke latency is below the stage's threshold

Thresholds live in [tuning](07-tuning.md).

Both conditions are required, and the second one is the important one. Accuracy alone can
be satisfied by typing slowly and looking down — which is exactly the habit being
replaced. **Slow-but-accurate is the hunt-and-peck signature and must not pass the gate.**
There is a test asserting precisely that.

## Breaking the looking-down habit

Escalating, so the support is withdrawn as it stops being needed:

1. **Keyboard overlay.** An on-screen keyboard with the next key highlighted, colour-coded
   by which finger should strike it. On by default.
2. **Earned fade-out.** Once a key's accuracy passes threshold, that key stops being
   highlighted on the overlay. The crutch removes itself key by key, as it is earned,
   without the player ever choosing to give it up.
3. **The report card.** Per-finger accuracy and speed after every level. A two-finger
   typist's card is unmistakable — two columns of data and eight empty ones. Making that
   visible is half the battle. See [stats](08-stats.md).

## Keyboard layout

The overlay must match the player's physical keyboard exactly, or it teaches the wrong
finger for `'`, `#` and `\`. US ANSI is the default; ISO (UK and most of Europe) has a
taller Enter and an extra key beside it and is selectable. Layout affects the overlay and
finger mapping only — never the curriculum or the illumination sets.
