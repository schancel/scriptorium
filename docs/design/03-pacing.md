# Pacing, damage and items

**Implemented by:** `core/entities.ts`, `core/damage.ts`, `core/items.ts`, `core/corpus.ts`, `core/sprites.ts`

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

## A monster is a word

Monsters idle, and something has to happen to them or the platformer is scenery behind a
typing exercise. The owner's report after the first playable build was exactly that: *"The
skeletons don't get defeated yet, but very cool."*

So each monster is **anchored to a word** in the passage. Finishing that word fells it: the
scribe strikes, the monster bursts, and it is gone. The camera already advances one stride
per completed word, so a monster's world position and the word that kills it are the same
fact stated twice; the strike lands on the keystroke that completes the word, on the same
signal that moves the world.

What follows from that, and what must stay true:

- **A monster cannot block progress and cannot be lost to.** There is no timer, no
  approach, no health bar, no way to fail a fight and no way to be hurt by one. A player
  who takes four minutes over a word finds the monster exactly where it was, still bobbing.
  Combat is a *reward* for typing, wearing the costume of a fight. See
  [ADR 0004](../decisions/0004-idle-threat-not-speed-timer.md).
- **Nothing about it advances on a clock.** A monster's anchor, its position and whether it
  has been struck are all functions of the cursor. The burst and the two strike verbs have
  durations (`monster_burst_ms`, `stomp_ms`, `ink_ms`) because an animation must, but they
  only ever *start* on a keystroke, and while they run nothing is at stake.
- **Drops are occasional and seeded.** A felled monster sometimes leaves an ink pot --
  `monster_drop_chance`, drawn from the injected PRNG in `core/rng.ts`, so a passage
  replays identically. The pot is granted as it is dropped rather than left lying to be
  collected: a pickup the player could walk past would be a way to lose something by being
  slow, and that is the one thing this game does not have.
- **The combo is acknowledged, modestly.** A long clean run adds up to `combo_drop_bonus`
  to the drop chance and rings the defeat cue harder. Breaking the combo returns both to
  base; it never takes anything away, and there is no second failure mode hiding in it.

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
| `gold_leaf` | Gold leaf | Score multiplier for the rest of the level | Awarded for a part gilded completely, or hidden on side platforms |
| `quill_nib` | Quill nib | Permanent upgrade: extra heart, slower cloud, or wider smudge tolerance | Behind flashback rooms |
| `wax_seal` | Wax seal | Unlocks routes and cosmetics | Awarded for a perfect chapter |

### Defeating a monster must read as an action

The owner, on the first combat build: *"a little weak as you just stand on top of them
for a bit. It'd be cool if you fireballed them or jumped on their head or something."*

Two separate faults.

**No gap.** A monster's position is derived from the word it is anchored to plus the
scribe's screen x, which puts it exactly where he arrives — so he ends up standing *in*
it and the blow has no distance to cross. Monsters are placed `strike_reach` further on,
so there is space for something to happen in.

**A pose is not an action.** The scribe held a strike frame; nothing travelled, nothing
was struck. Each enemy now has its own verb, which is what a platformer does:

| Enemy | Verb | Reads as |
|---|---|---|
| Skeleton (ground) | **Stomp** | The scribe hops, lands on the skull, bounces off. Mario. |
| Bat (flying) | **Ink** | He flings a nib that arcs up and bursts on it. A Castlevania sub-weapon, and the right thing for a scribe to throw. |

Different verbs per enemy are worth the extra art: they make the enemies read as different
things rather than as two sprites that both evaporate.

**It stays feedback, never a skill check.** Both verbs resolve on word completion. There
is no aim, no timing window, and no way to miss — ADR 0004 rules out anything that
punishes a slow player, and an attack that can miss is exactly that in disguise.

**Strikes must overlap.** A fluent typist finishes a word roughly every 430 ms; a hop plus
a burst runs longer than that. So strikes are a list, not a single slot — a second one
begins while the first is still playing, and the scribe's own pose takes the most recent.
Getting this wrong shows up only at speed, which is precisely where it would look broken
to the person most able to notice.

**How it is put together.** `core/entities.ts` holds a `Strike`: a verb, the world
position of the thing being struck, and the milliseconds since it began — four fields, and
deliberately no fifth in which a miss, an aim or a timing window could be written. A strike
is created by `beginStrike` from the monster `strikeWord` just felled, so the only thing
that can start one is a completed word. `stepStrikes` runs the list and drops each entry
when its verb's row (`stomp_ms`, `ink_ms`) is spent. `scribeStrike` returns the pose of the
*last* strike in the list — the most recent — and `strikeMissiles` returns one visual per
live strike, so an earlier nib keeps flying while a later hop plays over it.

Both are returned as a position *along the path* from the scribe to the monster — a travel
fraction and a lift, never pixels — because only `core/draw.ts` knows where the camera has
put the monster this frame. That is what makes the nib land on the bat rather than on the
place the bat was standing when it was thrown.

The art is in `core/sprites.ts`: `scribe_hop` (rise, contact, bounce) for the stomp, and
`nib` plus `ink_burst` for the throw, which reuses the existing `scribe_strike` frames for
the wind-up and follow-through — the pose was always right; what was missing was something
leaving his hand.

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

**That condition is now met, and the copy still says "part."** `core/draw.ts` draws a
candle at each end of the part the player is in: the one behind him is lit — it is the
checkpoint he is standing on — and the one ahead stands dim until he reaches it, when it
lights. So the metaphor is on screen and could carry the word.

Whether it *should* is the owner's call, not the implementer's, because the evidence that
started this was a real player and only he can retire it. Two things argue for waiting: the
candle ahead is only in shot for the last few words of a part, so a player who has not yet
finished one has still never seen the thing named; and "part 1/11" is legible to someone
who has seen neither. If the word comes back, it comes back everywhere at once — the HUD,
the report card footer, and the menu — or the interface is speaking two languages.

Candles matter more than they look: they make death cost a verse rather than a chapter.
A beginner needs 20+ minutes for a chapter, and losing that would end the session and
possibly the habit.

So a chapter is not a sitting. `core/corpus.ts` cuts one into `candle_interval` chunks,
and the progress record is written at every chunk boundary — a candle is a save point as
well as a respawn point, and closing the tab costs the same verse or two that dying does.

Hidden items are reached by typing an optional bonus word on a side platform, so
exploration is itself extra practice rather than a detour from it.
