# Followers

**Implemented by:** `core/followers.ts`, `core/draw.ts`, `core/sprites.ts`, `platform/web/main.ts`

## The hole this fills

Nothing accumulates. The player finishes parts, the score ticks, the history grows a
row — and the screen never shows that he has been anywhere. A route made of threads
between passages is a pilgrimage, and a pilgrimage that gathers company is the obvious
thing the game is missing.

## What they are

Finish a passage the route names and its figure joins a line walking behind the scribe.
Adam after Genesis 3. Abraham after Moriah. Moses after the bush. The shepherd after
Psalm 23. They walk when he walks, idle when he idles, and do nothing else at all.

Finding a flashback room adds its figure too — currently a secret room leaves no visible
trace once you have left it, and this is the natural one.

### Who Genesis hands over

Genesis 1 gives **Adam** and Genesis 3 gives **Eve**, in that order. The first draft had
them the other way around: Genesis 1:27 says *male and female he created them*, so Eve is
textually present there, and Adam was left to arrive from Genesis 3.

The owner's correction: *"Adam was created first."* Genesis 2 forms the man and then the
woman from him, so a party that gathers Eve before Adam gets the order of the story
backwards even where a single verse names them together. Genesis 3 is the route's node
for the garden, which is where she belongs.

## They have no abilities, deliberately

Tempting, and wrong twice over.

Every mechanic here that touches difficulty is balanced against a beginner's error rate,
and getting the smudge ramp right took a measured argument and a test
([ADR 0005](../decisions/0005-smudge-meter-over-per-typo-damage.md), and the ramp
invariant in [pacing](03-pacing.md#the-ramp-must-not-outrun-the-gate)). A follower
granting an extra heart or a slower cloud reopens all of it.

Worse, it points the reward the wrong way: it would make the game *easier* the further
you get, so the player who needs help least receives it, and the beginner the game exists
for gets nothing. As a pure record it costs nothing, cannot unbalance anything, and still
does the job — the screen finally shows the journey.

## Arriving with a line

Finishing Moriah used to put Abraham behind the scribe and say nothing whatever. The
figure simply appeared, mid-stride, on a screen the player was not looking at -- he was
looking at the rail, which is where the game has spent every other decision keeping him.
An arrival nobody notices is an arrival that did not happen.

So a follower arrives with **one sentence in the strip under the rail**, in the same place
and the same manner as a [first-run note](10-first-run.md#how-it-is-wired): shown once when
they join, dismissed by typing on (`first_run_note_keys` correct keystrokes), and never
shown again. It costs no layout -- the strip's space is reserved whether anything is in it
or not -- and it costs no mechanic, because it is a sentence and nothing else.

Priority in the strip, highest first: **a first-run note**, then **an arrival**, then **a
doorway**. A note is spent three times in a player's life, an arrival nineteen times, and a
doorway stands open for the rest of its verse; the rarer thing wins.

### What they say

Deadpan, and formed from the roster: *"Moses walks with you."* The person is the row's
`who` with its first letter raised, so *"The shepherd walks with you."* and *"The woman he
did not condemn walks with you."* fall out of the same rule and no second column is needed
for eighteen of the nineteen.

**Eve's is a joke.** *"Wife acquired!"* -- the owner asked for it twice and finds it funny,
and it is his game. It is also the right joke: it lands *because* the other eighteen are
flat, and one gag among nineteen deadpan lines is funnier than a gag every time. It is the
game's one moment of a video game acknowledging itself, and one is the correct number.

That is the exception that made the exclamation ban narrow. A follower arriving is the
world doing something rather than a verdict on the player, so it is
[copy about the world](10-first-run.md#the-exclamation-ban-is-about-praise-and-only-covers-copy-that-judges-him)
and may use ordinary punctuation. Nothing on the report card moved an inch.

The wording lives in `core/followers.ts` beside the roster, the way the first run's wording
lives in `core/onboarding.ts` -- a string spelled in a DOM file is a string nothing tests.

## They must not compete with the rail

The rail is the point and everything else serves it
([the rail](02-rail.md)). Followers are the largest thing yet added next to it, so:

- They walk **behind** the scribe, never ahead, never above the ground line.
- The line is capped. Past the cap the earliest walk off and the count is shown instead —
  a screen filling with figures is scenery competing with text.
- No speech, no icons over heads, no numbers. They are silhouettes that walk.
- They never enter the reading band or the keyboard overlay.

## Art without ten bespoke sprites

Ten hand-drawn figures is a lot of art for something deliberately in the background, and
detail at 16×16 reads as noise anyway. Followers are drawn from a small set of body
silhouettes, recoloured from the theme palette, each carrying one distinguishing mark —
a staff, a crown, a lamb, a scroll. The mark is what the eye reads; the body is shared.

That also keeps them coherent with the scribe, who is the same size and build. They
should look like people walking with him, not like a parade of mascots.

### A shared set is not one body with a switch on it

The first three bodies were `hooded`, `bare` and `child`, and two of those three were the
same drawing. `bare` is `hooded` with the hood taken off by a rule, and the rule moves
**six pixels of ink and not one pixel of silhouette** — `robeShade` becomes skin at two
columns on three rows beside the face, and the two outlines are identical cell for cell.
Everything else is the same: same shoulders, same robe, same hem, same feet. So every adult
in the line was one robed figure, and the owner said what that looks like: *"Eve isn't very
feminine. Looks like a second wizard."*

He is reading the art correctly, and the fix is not a fourth colour. There is now a fourth
**silhouette**, `gowned`, and it differs in the only two things the eye resolves at this
size:

- **The head outline.** Hair falls past the jaw and flanks the shoulders, so the skull
  breaks outward to ten columns where the hooded head is eight. It is the first thing seen,
  before the mark and before the garment.
- **The line from waist to hem.** Six columns at the waist opening to twelve at the hem —
  a flare of two to one, against a robe that is twelve columns all the way down and reads
  as a cassock. The hem is closed rather than split into two feet, which is the other half
  of the same shape.

Neither of those is a colour, and that is deliberate: the palette belongs to the *theme*,
so a body told apart by colour would be told apart in the garden and lost in the void.
Shape survives the theme.

**It is a fourth body in a shared set, not the first of nineteen bespoke sprites.** Any
woman in the line takes it — Eve, and the woman of John 8 — and so would Mary Magdalene if
she is ever added. Four bodies in three cloths is twelve sprites for nineteen figures,
which is the same economy as before.

`core/sprites.test.ts` commits the picture, as it does for every other sprite, and asserts
that `gowned` differs from each of the other bodies by a counted number of pixels rather
than by eye. That assertion exists because a four-pixel "variant" is exactly what was
already here, and nothing but a count would have caught it.

## Who joins after what

One figure per passage the route names, and each is a person the passage itself
puts there — not a mascot invented for the slot. A **stop** hands over its figure
when the passage is finished; a **secret** hands over its figure when the room is
found, because finding it is the achievement and walking back out of it is not a
way to lose one.

`body` is which of the four shared silhouettes it is drawn from, `cloth` which
pair of art roles the garment takes, and `mark` the one thing it carries. None of
the three is unique to a row: that is the entire economy of it.

Eve's `mark` is the **fruit**, and it was a hoe. The hoe was wrong twice: it is a vertical
stick, and at four columns wide every upright object in this set — the staff, the crook,
the reed, the harp's shaft — is the same picture; and tilling the ground is *Adam's* curse
(Genesis 3:23) rather than hers. The fruit is the image the chapter is remembered by, and
it is round, which is the one shape nothing else in the set can be confused with.

<!-- generates: data/followers.json -->

| passage | who | body | cloth | mark |
|---|---|---|---|---|
| Genesis 1 | Adam | bare | light | shoot |
| Genesis 3 | Eve | gowned | robe | fruit |
| Genesis 22 | Abraham | hooded | mid | horn |
| Exodus 3 | Moses | hooded | robe | staff |
| Exodus 12 | the firstborn | child | light | lamb |
| Exodus 16 | the gatherer | bare | mid | pot |
| Numbers 21 | the one who looked | hooded | light | serpent |
| Psalm 22 | the psalmist | hooded | robe | harp |
| Psalm 23 | the shepherd | bare | mid | crook |
| Jonah 1 | Jonah | hooded | robe | fish |
| Matthew 12 | the man with the withered hand | bare | light | reed |
| Matthew 27 | Simon of Cyrene | hooded | mid | beam |
| John 1 | John the Baptist | bare | robe | scroll |
| John 3 | Nicodemus | hooded | light | lamp |
| John 6 | the boy with the loaves | child | mid | basket |
| John 8 | the woman he did not condemn | gowned | light | stone |
| John 10 | the doorkeeper | hooded | mid | key |
| John 19 | Joseph of Arimathaea | hooded | robe | linen |
| Revelation 22 | the one who came to the water | bare | light | cup |

`make check` asserts every passage the route names has exactly one row here, that
no two rows claim the same passage, and that every `body`, `cloth` and `mark`
names art that exists in `core/sprites.ts`. A route edge added without a figure
is a passage that finishes and leaves nothing behind, which is the hole this
whole document is about.

**The marks live in the four columns beside the figure** — the same corner of the
cell the scribe's quill occupies — so a mark never covers the body it identifies.
`core/sprites.test.ts` draws each one over its body and asserts the picture, the
way the rest of the art is checked: at 16×16 the only way to be wrong is to look
at it.

## Derived, never stored

The record already knows. `completed` has held finished passages since the first
version of it and `discovered` has held found rooms since version 5, so the party
is `completed ∪ discovered`, intersected with the passages the route names. There
is no `followers` field, no schema bump and no migration, because there is nothing
new to migrate: **a derived party cannot drift out of step with the map, and a
stored one eventually would.**

The price is the order. Nothing in the record says which passage was finished
first — `completed` is appended to, but `discovered` is a second list appended to
independently, and no single sequence can be recovered from two. So the line
walks in the **route's own order**, the same order the map lays its passages out
in, and the doc says so rather than the code pretending otherwise. It is the
right answer anyway: a pilgrimage's company is a fact about the route, and a
player who finished Revelation 22 early has not thereby put it at the front of
his own journey.

## The cap, and what is shown instead

`follower_line_max` figures walk. Past that the **earliest on the route** walk on
ahead and out of shot, and a small count stands at the tail of the line in their
place. The count sits on the ground line at the far end, in the interface colour,
never over a figure's head and never in the reading band — a number floating over
a walking man is an icon, and this document has already ruled those out.

Spacing, the cap and the walking cadence are rows in [tuning](07-tuning.md):
`follower_spacing_px`, `follower_line_max`, `follower_walk_ms`. The spacing is
wider than a sprite so no two figures overlap, and the line is drawn back to
front so that if it ever were narrowed, the nearer figure would be the one in
front.

## No abilities, made structural

The rule in the section above is not left to be observed. It is arranged so that
a follower has nothing to touch:

- **`core/followers.ts` cannot reach a mechanic.** It imports the route graph,
  the sprite sheet, the tuning lookup and one animation helper, and nothing else.
  `core/damage.ts`, `core/items.ts`, `core/progress.ts` and `core/typing.ts` are
  not in its import list, and `core/followers.test.ts` reads the file's own
  imports back and fails if they ever are.
- **The party is an argument to the display list and to nothing else.** It rides
  on `FrameState`, not on `SceneState`, so the level state the platform steps
  every frame has no followers field for anything to read. Hearts, smudge, the
  cloud, drops, the score and the gate are all computed before the party is even
  assembled, out of values it has no way to reach.
- **A pose has five fields**: two sprite ids, an x, a y and a frame. There is
  deliberately no sixth in which a bonus, a multiplier or a shield could be
  written — the same argument `Strike` makes in
  [pacing](03-pacing.md#defeating-a-monster-must-read-as-an-action).
- **And it is checked as a property of the frame.** `core/followers.test.ts`
  draws the same state twice, once with a full party and once with none, and
  asserts that the two display lists differ *only* by the follower sprites and
  the count: the HUD, the hearts, the meter, the rail, the caret, the monsters,
  the candles and the cloud come out identical, command for command.

## On the map

The map already lists every passage and what state it is in, so it is where the
company is named. Under the passages, a short list: one line per figure, the
passage on the left and the person on the right, in the same order the passages
themselves are in — the map's order, because two lists on one screen that
disagree about their order are two lists nobody can read across. A figure the
line is not currently showing is marked as walking on ahead rather than left out,
because the map is where a player goes to find out what he has and the screen is
where he goes to play.

The names appear **only** there. Nothing is ever written over a figure's head in
the world: they are silhouettes that walk, and a label is the beginning of a HUD.
