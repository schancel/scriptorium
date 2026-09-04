# Pacing, damage and items

**Implemented by:** `core/entities.ts`, `core/damage.ts`, `core/items.ts`, `core/corpus.ts`

## Player-paced

Nothing moves until the player types. Monsters idle in place — bobbing, jiggling,
telegraphing menace — but they do not advance on a clock.

This is not a difficulty setting, it is the premise. A beginner on home row types 8–15
WPM; any time limit calibrated for a competent typist fails them constantly during the
exact fortnight they are most likely to quit. See
[ADR 0004](../decisions/0004-idle-threat-not-speed-timer.md).

## The threat is idleness, not slowness

Stakes still have to exist or nothing on screen matters. So: a cloud of ink drifts in
when the player stops typing *entirely*, and drips on the manuscript, smudging work
already done. Any correct keystroke drives it back.

The distinction is the whole point. Five seconds deliberating over a single keystroke
costs nothing. Stopping to *hunt the keyboard for a key* brings the cloud. It punishes
precisely the behaviour the game exists to eliminate, and nothing else.

The idle threshold starts generous and tightens by stage — values in
[tuning](07-tuning.md). It can be disabled outright if it turns out to stress rather than
motivate; that switch is deliberate, not a debug leftover.

## Damage is metered

A beginner errs on roughly one keystroke in ten. A heart per typo would empty their hearts four
times per verse.

Instead, errors **smudge** the page. Each mistake adds to a smudge meter; clean typing
wipes it back down; only a *full* meter costs a heart. Stakes without a death spiral, and
the tolerance tightens by stage so it stays meaningful as accuracy improves. See
[ADR 0005](../decisions/0005-smudge-meter-over-per-typo-damage.md).

Wrong keystrokes never advance the cursor. The player must correct the error before
continuing — standard in typing tutors, and non-negotiable for habit formation.

## Items

<!-- generates: data/items.json -->

| id | name | effect | source |
|---|---|---|---|
| `ink_pot` | Ink pot | Restores one heart | Dropped for a clean verse streak, or hidden on side platforms |
| `candle` | Candle | Checkpoint — death returns here | Placed at verse boundaries through a level |
| `gold_leaf` | Gold leaf | Score multiplier for the rest of the level | Hidden on side platforms |
| `quill_nib` | Quill nib | Permanent upgrade: extra heart, slower cloud, or wider smudge tolerance | Behind flashback rooms |
| `wax_seal` | Wax seal | Unlocks routes and cosmetics | Awarded for a perfect chapter |

### The ramp must not outrun the gate

Error cost rises with stage so tolerance narrows as skill grows. But the *gate* also
demands a fixed accuracy (`gate_accuracy`, 95%) to reach a stage at all. If the ramp
climbs faster than that, the game eventually ends a player's run for typing at exactly the
standard it just promoted them for.

It did. Measured over a simulated chapter with errors arriving in bursts, a 95%-accuracy
player -- one who legitimately earned the stage -- lost 6-8 hearts at stage 5 and 16-23 at
stage 9, running out of hearts 5-7 times. The first tuning made error cost climb to 30 while decay stayed
flat at 2, so the break-even error rate fell to 6.7% against a gate demanding 5%: a
margin of 1.3x, which any burst erases.

**The invariant:** at every stage, the break-even error rate --
`smudge_decay_per_key / (smudge_per_error_base + stage * smudge_per_error_step)` --
must be at least **twice** the error rate the gate permits (`1 - gate_accuracy`). A player
meeting the standard the game set must be comfortably safe, not marginally.

Current tuning holds it at 5.0x at stage 0 falling to 2.9x at stage 9. There is a test.

### Say "part", not "candle"

**Candle is our word, not the player's.** It is useful internal vocabulary -- it names
the checkpoint, the chunk boundary and the item at once -- but it appeared in the HUD as
`candle 1/11` and in the report card as *"on to the next candle"* to a player who had
never been told what a candle was. The owner's exact reaction on watching someone play:
*"I don't know what candles are?"*

Player-facing copy says **part** (`part 1/11`, `esc: next part`). The internal names --
`candle_interval`, chunk, checkpoint -- stay as they are.

The word can return to the interface once a candle is actually drawn on the platform,
visibly lighting as the player passes it. Then the metaphor explains itself and needs no
glossary. Introducing thematic vocabulary before the thing it names is on screen is how
a game ends up with a private language its player does not speak.

Candles matter more than they look: they make death cost a verse rather than a chapter.
A beginner needs 20+ minutes for a chapter, and losing that would end the session and
possibly the habit.

So a chapter is not a sitting. `core/corpus.ts` cuts one into `candle_interval` chunks,
and the progress record is written at every chunk boundary — a candle is a save point as
well as a respawn point, and closing the tab costs the same verse or two that dying does.

Hidden items are reached by typing an optional bonus word on a side platform, so
exploration is itself extra practice rather than a detour from it.
