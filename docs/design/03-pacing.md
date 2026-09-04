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

**And the choice is remembered.** `cloudEnabled` is a field on the
[progress record](../architecture/data-schemas.md#progress), not a session variable. A
switch that comes back on at every reload is one the player has to find again every
evening, which is the same as not having it — and the player most likely to want it off is
the one least likely to enjoy hunting through a menu for it a second time.

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
  to the drop chance and rings the strike cue harder. Breaking the combo returns both to
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
| `ink_pot` | Ink pot | Restores one heart, or `ink_pot_points` when hearts are already full | Dropped for a clean verse streak, or hidden on side platforms |
| `candle` | Candle | Checkpoint — death returns here | Placed at verse boundaries through a level |
| `gold_leaf` | Gold leaf | Score multiplier for the rest of the level | Awarded for a stretch of verses gilded completely, or hidden on side platforms |
| `quill_nib` | Quill nib | Permanent upgrade: extra heart, slower cloud, or wider smudge tolerance | Behind flashback rooms |
| `wax_seal` | Wax seal | Unlocks routes and cosmetics | Awarded for a perfect chapter |

### An ink pot at full hearts must still be worth something

`restoreHeart` caps at the maximum, so a pot dropped while the player is on full hearts
used to do nothing whatever. That is most of the early game: a beginner who is typing
cleanly enough to earn drops is, by construction, a beginner who has not lost a heart. The
game showed him a reward and gave him nothing, which is a small lie — and the player it
lies to most often is the one it can least afford to lose.

**A pot at full hearts is worth `ink_pot_points` instead.** Score is the right currency
because gilding already established one, and because it is the only thing in the game that
can absorb a reward without changing the difficulty: hearts, smudge tolerance and the cloud
all move what the game asks of the player, and a lucky drop must never do that.

Two consequences follow, and both matter more than the rule itself:

- **Gold leaf multiplies it**, like everything else earned in the level, because a pot is
  earned in the level. The multiplier applies at the moment of pickup, so leaf taken later
  does not retroactively enrich pots collected before it.
- **The HUD carries the score whenever there is one**, not only while gilding is on.
  Awarding points into a counter the player cannot see would be the same lie in a new
  place. The total is still absent at zero: a number nobody can move is not worth the room.

The alternative was to make drops rarer, so that a pot always lands on a player who can use
it. That is worse. It reduces feedback for the beginner who needs feedback most, and it
solves an honesty problem by making the game quieter rather than truer.

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

**And different sounds, for the same reason.** Both verbs rang one `defeat` cue at first,
so the ear was told they were the same event while the eye was being shown they were not.
Each has its own cue now — `stomp` is weight landing, `ink` is something thrown and
bursting — in the same family as the checkpoint's, because they are the same kind of news
at different weights. The cue id *is* the verb, so no lookup stands between the blow and
the noise it makes. See [music](09-music.md#the-two-strikes).

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

**How big the blow is, is a row and not a literal.** How long a verb runs was always
tuning (`stomp_ms`, `ink_ms`); how *large* it draws was five constants marked
`tuning-exempt` in `core/entities.ts`, which is the trap [tuning](07-tuning.md) exists to
prevent — the owner could not change the way his own game felt without editing
TypeScript. The height of the leap (`strike_hop_px`), where he stands at the moment of
contact (`strike_contact_px`), how hard he rebounds (`strike_bounce_ratio`), the arc of
the thrown nib (`strike_nib_arc_px`) and how far across the gap the leap carries him
(`strike_rise_travel`) are rows now, read on every frame, so a bigger leap is a table edit
and a reload.

What stays exempt is three fractions and only three: `riseTo`, `contactTo` and `flightTo`,
which say where one *drawing* gives way to the next. Each is a fact about the art in
`core/sprites.ts` rather than about the feel — turning `riseTo` alone does not make the
blow bigger, it puts the wrong frame on the screen at the moment of impact — so they
belong beside the sprite sheet and not in a table an owner is invited to turn.

For the record, at the shipped values: the scribe stands with his feet on the ground line
at y 96 of the 360px frame and his head at y 80, and the HUD ends at y 22 — so he has 58
virtual pixels of room above him. The stomp lifts him **12 px** and carries him the
**36 px** of `strike_reach` to the skeleton; the thrown nib rises **14 px** off the line
from his hand to the bat, which with the bat's own height puts it 24 px above his head at
its highest. Nothing either verb draws comes within 33 px of the HUD or reaches the rail.

The art is in `core/sprites.ts`: `scribe_hop` (rise, contact, bounce) for the stomp, and
`nib` plus `ink_burst` for the throw, which reuses the existing `scribe_strike` frames for
the wind-up and follow-through — the pose was always right; what was missing was something
leaving his hand.

### A monster is felled by a clean word, not by any word

Completing the word a monster stands on fells it, whatever happened along the way. So a
word fumbled twice and repaired still kills, and accuracy — the thing the game is
actually teaching — has no visible consequence anywhere except a meter and a table.

**A word typed clean fells the monster. A word with a mistake in it does not.** The
monster survives and the scribe walks past it.

The crucial half is what *does not* happen. It is not a punishment and it must never read
as one:

- **Nothing blocks.** A surviving monster does not stop the player, chase him, or cost
  him anything. He simply passes it. What he loses is a reward he did not earn, which is
  not the same as a penalty, and the difference is the whole of ADR 0004.
- **No second chance mechanic**, no retry prompt, no "you missed one" line. The monster
  standing there is the entire feedback.
- Damage is unchanged: mistakes still feed the smudge meter and nothing else
  (ADR 0005). This adds no new way to lose hearts.

**In every mode, not only gilding.** A beginner erring on roughly one keystroke in ten
fells about three words in five, which is often enough to feel good and rare enough to
mean something. Making it fluent-typists-only would say that accuracy matters more once
you are already good, which is exactly backwards.

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

### The game says verses and chapters, and invents nothing

**The interface names the text, not our machinery.** A chapter is cut into chunks of
`candle_interval` verses so that death and a closed tab cost a verse or two rather than an
evening. That chunk needed a name on screen, and it got two bad ones in a row.

First `candle`, which named the checkpoint, the chunk boundary and the item all at once.
Excellent internal vocabulary, and it reached the HUD as `candle 1/11` in front of a
player who had never been told what a candle was -- *"I don't know what candles are?"*

Then `part`, which was the same mistake in a plainer coat: `part 4/9` is a number about
our chunking, and the player has no way to check it against anything. The owner, reading
it: *"Why not verses and chapters or something?"*

**So the game says the reference.** Wherever a chunk was named, the citation stands in its
place -- `Genesis 1:12-14` in the HUD, the same on the report card's title, in the menu, in
the history and on the map. It is shorter than what it replaced, it is a fact the player
can read straight off the page in front of him, and it retires the argument: there is no
private unit left to name, so there is nothing to introduce, explain or defend.

Three consequences, and all three are the point:

- **Nothing is invented.** Verse and chapter are the text's own units, older than this
  game and known to anyone who has opened a Bible. A word we coined is a word we would
  have to teach.
- **The internal names stay.** `candle_interval`, chunk and checkpoint are what the code
  and these documents call them, and they are good names for what they do. This section is
  about what a player *reads*, and nothing else.
- **Both words are on the jargon list.** `core/copy.test.ts` and `tools/smoke.mjs` keep
  `candle` and `part` out of player-facing copy, together, so neither can drift back in
  one surface at a time.

The candle stays on the platform. `core/draw.ts` draws one at each end of the stretch the
player is in -- the one behind him lit, the one ahead dim until he reaches it -- and it is
a good picture of a checkpoint. It simply does not need a caption.

Candles matter more than they look: they make death cost a verse rather than a chapter.
A beginner needs 20+ minutes for a chapter, and losing that would end the session and
possibly the habit.

So a chapter is not a sitting. `core/corpus.ts` cuts one into `candle_interval` chunks,
and the progress record is written at every chunk boundary — a candle is a save point as
well as a respawn point, and closing the tab costs the same verse or two that dying does.

Hidden items are reached by typing an optional bonus word on a side platform, so
exploration is itself extra practice rather than a detour from it.
