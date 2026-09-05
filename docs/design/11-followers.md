# Followers

**Implemented by:** `core/followers.ts`, `core/draw.ts`, `core/sprites.ts`, `platform/web/main.ts`

## The hole this fills

Nothing accumulates. The player finishes parts, the score ticks, the history grows a
row — and the screen never shows that he has been anywhere. A route made of threads
between passages is a pilgrimage, and a pilgrimage that gathers company is the obvious
thing the game is missing.

## What they are

Reach the verse a passage puts somebody in and their figure joins a line walking behind
the scribe. Adam where he is formed. Abraham after Moriah. Moses after the bush. The
shepherd after Psalm 23. They walk when he walks, idle when he idles, and do nothing else
at all.

Finding a flashback room adds its figure too — currently a secret room leaves no visible
trace once you have left it, and this is the natural one.

### Who Genesis hands over

**Genesis 2 gives both of them: Adam at 2:7 and Eve at 2:24. Genesis 1 hands over
nobody.**

The first draft had Genesis 1 giving Eve and Genesis 3 giving Adam: Genesis 1:27 says
*male and female he created them*, so Eve is textually present there. The owner's
correction was *"Adam was created first."* Genesis 2 forms the man and then the woman
from him, so a party that gathers Eve before Adam gets the order of the story backwards
even where a single verse names them together.

Fixing the order moved Eve to Genesis 2, and then the same argument took Adam there too.
He is not in Genesis 1. Genesis 1 says *male and female he created them* about mankind;
the man is **formed** in Genesis 2:7, out of the dust, and that is the verse a figure of
Adam can honestly appear on. Handing him over for finishing Genesis 1 was the roster
doing what [the route](04-route.md) had done before ADR 0012 -- attaching a person to the
famous chapter rather than to the verse that makes him.

So Genesis 1 joins Genesis 3 in handing over nobody, and for a related reason: **there is
nobody in it yet.** Genesis 3 is the chapter everyone present is driven out of, and there
is no one in it who joins you. An honest absence beats an invented companion, twice.
See [at most one arrival at a time](#who-joins-after-what).

Eve is *built* in 2:22 and becomes a wife in 2:24 -- *"they will be one flesh"* -- which
is the verse her line is about. She is not named Eve until 3:20, which is why
*"Wife acquired!"* does not use the name: it was written before anybody knew it.

### They join at a verse, not at the end of a chapter

The scenery went verse-precise and the roster did not, and the mismatch showed. Genesis 1
changes world six times as it is typed; a follower still waited for the chapter to end.
So a row may name a **verse**, and its figure joins the moment the cursor reaches it --
mid-passage, with the report card nowhere in sight.
[ADR 0012](../decisions/0012-the-route-must-not-skip-the-events.md) is where that was
decided, and Adam is why: the man is formed in one verse of a chapter that is fifteen
hundred characters long, and arriving four hundred keystrokes later is arriving somewhere
else.

**A row with no verse keeps the old behaviour** and joins on the passage being finished.
That is the right default for most of them: Abraham is not *made* anywhere in Genesis 22,
and Moriah is about the whole chapter rather than one line of it. The verse is there for
the passages that name a moment, and blank for the passages that are one.

Reaching the verse is enough; **finishing the chapter is not required.** The one case
this was built for is the case where the player is standing in the middle of the passage,
and a figure that waited for the end of it would arrive after the thing it is about.

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

Priority in the strip, highest first: **a first-run note**, then
**[the thread a finished passage offers](04-route.md#finishing-a-passage-offers-the-thread-it-leads-to)**,
then **an arrival**, then **a doorway**. A note is spent three times in a player's life,
an offer five times, an arrival twenty times, and a doorway stands open for the rest of
its verse; the rarer thing wins.

And the two that are spent by typing are spent **while they are on screen** and not
before. An arrival standing behind an offer is not quietly counted down under it and
lost: it takes the strip when the offer goes, a dozen keystrokes later. That is not the
tutorial wall arriving late -- the three coaching notes are queued behind nothing because
each of their occasions comes round again within a line or two, and neither of these ever
does. A passage is finished once.

### What they say

Deadpan, and formed from the roster: *"Moses walks with you."* The person is the row's
`who` with its first letter raised, so *"The shepherd walks with you."* and *"The woman he
did not condemn walks with you."* fall out of the same rule and no second column is needed
for nineteen of the twenty.

**Eve's is a joke.** *"Wife acquired!"* -- the owner asked for it twice and finds it funny,
and it is his game. It is also the right joke: it lands *because* the other nineteen are
flat, and one gag among twenty deadpan lines is funnier than a gag every time. It is the
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

**It is a fourth body in a shared set, not the first of twenty bespoke sprites.** Any
woman in the line takes it — Eve, the woman of John 8, and now Mary Magdalene. Four bodies
in three cloths is twelve sprites for twenty figures, which is the same economy as before.

`core/sprites.test.ts` commits the picture, as it does for every other sprite, and asserts
that `gowned` differs from each of the other bodies by a counted number of pixels rather
than by eye. That assertion exists because a four-pixel "variant" is exactly what was
already here, and nothing but a count would have caught it.

## Who joins after what

At most one figure per *arrival*, and each is a person the passage itself puts
there — not a mascot invented for the slot. A **stop** hands over its figure at
the `verse` named, or when the passage is finished if the cell is blank; a
**secret** hands over its figure when the room is found, because finding it is the
achievement and walking back out of it is not a way to lose one.

`verse` is where in the passage the person arrives, and blank means the end of it.
`body` is which of the four shared silhouettes it is drawn from, `cloth` which
pair of art roles the garment takes, and `mark` the one thing it carries. None of
the last three is unique to a row: that is the entire economy of it. `mark` may
also be blank; see [a figure may carry nothing](#a-figure-may-carry-nothing).

Eve's `mark` is the **fruit**, and it was a hoe. The hoe was wrong twice: it is a vertical
stick, and at four columns wide every upright object in this set — the staff, the crook,
the reed, the harp's shaft — is the same picture; and tilling the ground is *Adam's* curse
(Genesis 3:23) rather than hers. The fruit is the image she is remembered by, and it is
round, which is the one shape nothing else in the set can be confused with.

She now joins a chapter before she takes it, and that is not a contradiction: a **mark
names the person, not the verse they arrived on**. It has to, because the mark walks with
her for the rest of the route and there is only one of it. It is also the last thing the
fruit could be attached to — Genesis 3 hands over nobody now, so a mark tied to the
chapter rather than to her would simply have left the game.

<!-- generates: data/followers.json -->

| passage | verse | who | body | cloth | mark |
|---|---|---|---|---|---|
| Genesis 2 | 7 | Adam | bare | light | shoot |
| Genesis 2 | 24 | Eve | gowned | robe | fruit |
| Genesis 22 | — | Abraham | hooded | mid | horn |
| Exodus 3 | — | Moses | hooded | robe | staff |
| Exodus 12 | — | the firstborn | child | light | lamb |
| Exodus 16 | — | the gatherer | bare | mid | pot |
| Numbers 21 | — | the one who looked | hooded | light | serpent |
| Psalm 22 | — | the psalmist | hooded | robe | harp |
| Psalm 23 | — | the shepherd | bare | mid | crook |
| Jonah 1 | — | Jonah | hooded | robe | fish |
| Matthew 12 | — | the man with the withered hand | bare | light | reed |
| Matthew 27 | — | Simon of Cyrene | hooded | mid | beam |
| John 1 | — | John the Baptist | bare | robe | scroll |
| John 3 | — | Nicodemus | hooded | light | lamp |
| John 6 | — | the boy with the loaves | child | mid | basket |
| John 8 | — | the woman he did not condemn | gowned | light | stone |
| John 10 | — | the doorkeeper | hooded | mid | key |
| John 19 | — | Joseph of Arimathaea | hooded | robe | linen |
| John 20 | — | Mary Magdalene | gowned | light | — |
| Revelation 22 | — | the one who came to the water | bare | light | cup |

`make check` asserts every row here names a passage the route names, that no two
rows arrive at the same place, that any `verse` is a verse the chapter actually
has, and that every `body`, `cloth` and any `mark` names art that exists in
`core/sprites.ts`.

**At most one figure per node became at most one per arrival.** The rule was
*exactly one per node*, and it was right until Genesis 3 stopped having anybody. A
route node with no row was a passage that finished and left nothing behind, which
is the hole this whole document is about -- so the check was written to make that
impossible. But "impossible" and "must be filled" are different demands, and the
second one is a demand for an invented companion whenever the text does not supply
a real person. Genesis 3 is the case: it is the chapter where everyone is *driven
out*, and there is no one in it who joins you. A mascot for the slot would be worse
than the absence by exactly the amount this project cares about -- it asserts more
than the text supports, which is the rule the route screen and the report card are
both built on. So an empty node is a decision somebody made rather than a row
somebody forgot, and Genesis 1 is now the second one.

The *other* direction relaxed when the verse column arrived. Genesis 2 forms two
people and names the verse it forms each of them in, so it holds two rows, and
capping it at one would be the same untruth in the other direction. What the check
still refuses is two figures arriving at the same instant: **no two rows may name
the same passage and the same verse**, and a row with a blank verse claims the
whole passage, so it may not share one with a row that names a verse in it. There
is one strip under the rail and one sentence fits in it.

### A figure may carry nothing

**Mary Magdalene carries no mark, and the empty cell is the finding.** Every other row in
this table names an object the passage puts in somebody's hand: the staff at the bush, the
crook of the psalm, the linen Joseph of Arimathaea brought. John 20 puts nothing in hers.
She goes to the tomb before it is light, finds the stone moved, runs, comes back, and
*"stood outside at the tomb weeping"* — empty-handed in every verse she is in.

The obvious mark is a jar of spices, and the jar is not in this chapter. It is Luke's
women and Mark's, and in John the spices are Nicodemus's, seventy pounds of them, the
evening before. Drawing her with one would be the art quietly performing the same merge
[ADR 0012 declined](../decisions/0012-the-route-must-not-skip-the-events.md) when it kept
her separate from the woman of John 8 — a thing tradition supplies and the text does not.

So `mark` is optional, and a blank cell draws a body and no object. That costs one
`null` in the loader and one skipped draw command, and it buys the roster the ability to
say *nothing* — which, in a table where every other row is an assertion about what a
person was holding, is the difference between a record and a decoration. It is the same
answer as Genesis 3 having no figure, one level down: the honest absence beats the
invented prop.

She is `gowned` and `light` — the fourth silhouette, which
[exists for exactly this](#a-shared-set-is-not-one-body-with-a-switch-on-it), and the pale
cloth, because she is the one figure in the line who was first to a resurrection at dawn
and the palette she is drawn from is the tomb's.

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

**The verse did not change that.** A verse-precise join could have been stored --
one `joined` list, appended to as each figure arrives -- and that would have been a
third list free to disagree with the other two. It is instead one more thing the
game already knows: *where the player is standing*, which is a passage and a verse,
and which the scenery has read every frame since it went verse-precise. So a row
with a verse joins when the passage is finished **or** when the player is standing
in that passage at or past that verse, and neither of those is a fact anybody had
to write down.

The price is one honest consequence, and it is the same consequence the map has.
Reach Genesis 2:7, leave Genesis 2 without finishing it, and Adam is not in the
line — exactly as Genesis 2 is not marked finished on the route screen. The party
and the map say the same thing about the same chapter, which is the property this
section exists to keep. A stored party would have had him walking behind a player
who had abandoned the chapter he is formed in, and would have been the first
sentence in this game that the record could not support.

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
company is named. Under the passages, a short list: one line per figure, where
they joined on the left and the person on the right, in the same order the
passages themselves are in. **Where they joined** is the citation, with the verse
when the row names one — `Genesis 2:7  Adam`, `Genesis 2:24  Eve` — because the
chapter alone stopped being an answer the day one chapter handed over two people — the map's order, because two lists on one screen that
disagree about their order are two lists nobody can read across. A figure the
line is not currently showing is marked as walking on ahead rather than left out,
because the map is where a player goes to find out what he has and the screen is
where he goes to play.

The names appear **only** there. Nothing is ever written over a figure's head in
the world: they are silhouettes that walk, and a label is the beginning of a HUD.
