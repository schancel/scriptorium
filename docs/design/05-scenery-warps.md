# Scenery, set pieces and warps

**Implemented by:** `core/scenes.ts`, `core/setpieces.ts`, `core/motion.ts`, `core/worlds.ts`, `core/sprites.ts`, `core/warp.ts`, `core/draw.ts`

## Scenery is authored, not inferred

A hand-written scene map assigns a theme to passage ranges, so the platformer looks like
what is being described: desert dunes and heat shimmer while the Israelites wander, a
garden for Eden, water for the flood and for Jonah, mountain and storm-cloud for Sinai.

This is a data layer *over* the text, never derived from it. A user-loaded Gutenberg book
gets the generic abbey theme throughout, and that is the correct outcome — better a
neutral library than a keyword heuristic confidently rendering a desert because a novel
mentioned sand.

## Themes

A **theme** is the reusable bundle: palette, tileset, parallax layers, and tune.

<!-- generates: data/themes.json -->

| id | palette | mood | tune |
|---|---|---|---|
| `abbey` | stone greys, candle amber | cloister and library; indoors, when the text says so | `veni-creator` |
| `hills` | dry grass and olive, wide pale sky | open country: fields, flocks, the road between towns | `kingsfold` |
| `garden` | deep greens, gold light | Eden, before the fall | `wondrous-love` |
| `desert` | ochre, bleached sky | wilderness and wandering | `cwm-rhondda` |
| `sea` | blues, foam white | flood, parted waters, deep | `melita` |
| `mountain` | slate, smoke, fire | Sinai, Moriah, high places | `nicaea` |
| `storm` | bruised purple, lightning | Jonah, tempest, dread | `dies-irae` |
| `city` | sandstone, banners | Jerusalem, walls and gates | `ewing` |
| `temple` | gold, deep red, incense | sanctuary and altar | `nun-danket` |
| `tomb` | near-black, cold blue | the grave, catacombs | `passion-chorale` |
| `daybreak` | white-gold, void black | light gathering out of the dark | `helmsley` |
| `void` | black on black, one shade of deep | before the first day: no ground, no horizon | `conditor-alme` |
| `firmament` | night blue, star white | the expanse, lights set in it | `addisons` |

### `daybreak` was called `apocalypse`, and that named the wrong thing

It was written for Revelation 22 and then reused for Genesis 1's first morning, so it was
named after a genre: *apocalypse*, unveiling. The owner, on meeting it: *"why was it an
apocalypse to begin with and do you mean armageddon or a vision/revelation?"* -- which is
the whole problem in one sentence. Colloquially the word means the end of the world, that
is not what the theme looks like, and a player has no way to discover which of the two
senses was intended.

**A theme is named for what it looks like.** Every other id in the table is: `abbey`,
`tomb`, `firmament`, `void` are all places or pictures, and none of them is a genre or a
mood. This one is white-gold on void black, with light gathering out of the dark, and it
carries the first day of Genesis 1, John 1's light in the darkness and the new creation
equally well -- because all three *look* like a dawn. So it is `daybreak`, which says what
is on the screen and settles the question the old name raised.

## The default is a property of the text, and the Bible's is open country

A scene map covers the passages somebody has authored. Everything else falls back, and
until now the fallback was `abbey` for every text alike. Measured over the shipped canon:
**1,159 of the Bible's 1,189 chapters — 97.5% — resolved to a stone cloister**, and 57 of
its 66 books had no authored row at all. The owner found it by reading onward out of
Genesis 1 and asking why Genesis 4 was *"a dungeon instead of a barren land"*.

Genesis 4 was not an oversight. It was the rule everywhere the route does not go, and the
route is the 2.5% that every test walks. A default nobody sees is a default nobody checks.

**An abbey is the right neutral for an imported novel and the wrong one for Scripture.**
For a Gutenberg book it is indoor, bookish and claims nothing — better a neutral library
than a keyword heuristic confidently rendering a desert because a novel mentioned sand.
But the Bible is overwhelmingly outdoors: fields, hills, wilderness, road, sea. Ruth is a
barley field, Kings is hill country, the Psalms are pasture and enemies on the road, Acts
is the road itself. Rendering all of that as a cloister is the same class of untruth the
map screen was fixed for — asserting a place the text does not support.

So the fallback is a **per-text** row rather than one constant:

<!-- generates: data/scenes/defaults.json -->

| text | theme | why |
|---|---|---|
| `bible` | `hills` | dry hills and wide sky: the ground most of the book actually happens on |

A text with no row here keeps `abbey`, and so does a text with no scene file at all —
which is exactly what an imported Gutenberg book has, so nothing about that case changes.

**And the abbey becomes what it should always have been.** Not the world by accident, but
a place the scribe is *in* when the text puts him there: a room with the doors shut, a
psalm read indoors. It is still the theme of the cloister he is writing in. It is no
longer the theme of Sinai, Jericho, Nod and the road to Emmaus by default.

### Why `hills` and not a fourth kind of desert

`desert` already exists and is not this. It is ochre under a bleached sky, and it is
*wilderness* — the forty years, the place with nobody in it. Most of the Bible is not
that. It is worked, inhabited country: a field with two brothers bringing offerings out
of it, a threshing floor, a hillside with sheep on it, a road with towns at both ends.
That is a different palette (dry grass and olive against a wide pale sky, not ochre
against bleached white) and a different middle distance (scattered scrub, not more dunes).

The two shared a tune, and that stopped being deliberate the moment `hills` became the
Bible's default. Borrowing `cwm-rhondda` from the wilderness was a fair argument while
`hills` was one theme among twelve — country and wilderness are the same road under
different weather, so walking out of Judah did not restart the music. But `hills` now
resolves for 1,158 of the Bible's 1,189 chapters, so the borrowed tune had become *the*
tune, and the wilderness was lending its music to almost the whole book. `hills` has its
own now, `kingsfold`, and `desert` keeps `cwm-rhondda`; walking from one into the other
changes the music because it is the one theme change in this game the player will make
over and over, and it should be audible. What the borrowing argument was actually
protecting — that the music not restart every few verses — is now held by
[the crossfade](#verse-ranges) rather than by the borrowing, which is a better place for
it: walking out of the country into the wilderness changes the hymn without cutting one.

Two new tiles, and the ground reused. `tile_ridge` is the far band: two crests of
*unequal* height with a saddle between them, because this file already says of the wave
that *"a slow single swell reads as a hill however blue you paint it"* — and the converse
holds, so a horizon of identical humps reads as a desert whatever colour it is given.
`tile_scrub` is the middle: low bushes standing apart with sky between them, which is what
separates grazed country from the closed canopy of the garden. The floor is `tile_grass`,
recoloured — dry grass and green grass are the same grass under a different light, which
is the recolour argument this whole table is built on, and it is why the abbey, the temple
and the tomb all stand on one slab of cut stone.

## A chapter is not one place

The scene map resolves at chapter granularity, and some chapters move faster than that.

Genesis 1 is the clearest case: one row, one theme, thirty-one verses. But the chapter is
a transformation — formless void, then light, then the sky parting the waters, then dry
land, then stars, then living things, then a garden and a man in it. Rendered as a single
static room it reads, in the owner's words, as *"a cavern or something, rather than like
moving through space, to earth, to eden."*

That is not a theme chosen badly. It is a resolution problem, and it has three faces:

- **Genesis 1** needs the world to change under the player as he types it.
- **Jerusalem** needs landmarks — a city is a place you arrive at, not a texture that
  repeats. Better brick will not fix it; the gate and the wall and the temple have to
  appear.
- **The Gospels** have almost no set pieces at all, while Exodus has four. The New
  Testament passages carry the least visual weight in the game and should carry the most.

All three are the same fix.

### Verse ranges

`range` accepts `Book C:V-V` as well as `Book C` and `Book C-C`. A verse range wins over
a chapter range covering the same ground, so a chapter row stays a useful default and a
chapter that moves can be authored finely without rewriting the ones that do not.

Genesis 1, authored as the six days it is. The rows themselves are in
[the set-piece table](#set-pieces) with the rest; this is what each was chosen to read as,
and which theme and flourish carry it:

| range | theme | setpiece | reads as |
|---|---|---|---|
| `Genesis 1:1-2` | `void` | — | the void — no ground, no horizon, only dark |
| `Genesis 1:3-5` | `daybreak` | `light_from_dark` | light breaking over it |
| `Genesis 1:6-8` | `sea` | `waters_divided` | the sky parting the waters |
| `Genesis 1:9-13` | `garden` | `land_from_water` | dry land, and green on it |
| `Genesis 1:14-19` | `firmament` | — | stars in the expanse |
| `Genesis 1:20-25` | `sea` | `swarming` | living things |
| `Genesis 1:26-31` | `garden` | — | a garden, and it is very good |

Two of the seven are places the game had never had to draw before, so they are new themes
rather than an existing one dimmed: `void` has no horizon at all — its ground is the same
shade as its sky, which is what "formless" looks like when the parallax is still moving —
and `firmament` is a night sky with the land already under it, which no other theme is.
The sea returns on day five because the text does: the waters swarm before the land does.

**The tune follows the scenery too, and crossfades rather than restarting.** It followed
the *chapter* row for a while, and the argument for that was real: a theme owns a tune, a
tune restarted when the theme changed, and at verse granularity that is six restarts
inside Genesis 1, each one cutting a hymn off mid-phrase. The cost of the compromise was
two tunes nobody could ever hear -- `conditor-alme` and `addisons` were composed for
`void` and `firmament`, and both themes exist *only* as verse rows inside a chapter whose
row is `daybreak`.

So the objection is answered rather than accepted: **a tune change crossfades**, one
sequencer falling and one rising, across the same window the palette eases over. Nothing
is cut off mid-phrase because nothing is cut off at all, and Genesis 1 becomes plainsong
over the deep, opening into light, then water, then a garden -- which is what the chapter
is. A chapter row still keys the tune wherever there are no verse rows, which is 1,158 of
the Bible's 1,189 chapters, so nothing about the rest of the book changes.
See [the music follows the scenery](09-music.md#the-music-follows-the-scenery).

### Between two scenes, the palette moves and the tiles cut

Interpolating tile art is not worth attempting and would look like neither thing.
Interpolating a **palette** is trivial and carries almost all of the effect, because the
palette is what the eye reads as *time of day, place, mood*.

So: colour eases from one scene's palette to the next across the boundary, and tiles
change at the boundary itself. Land does not fade into water; the light over both moves
continuously. That is also how the warp already works, and for the same reason.

The transition is driven by **position in the passage, not by elapsed time** — the world
must not change while the player is thinking. Same rule as everything else here.

Concretely: the boundary is a verse number, the ease is a window of
`scene_blend_verses` verses centred on it, and the position inside that window is the
verse under the cursor plus how far through it the player has typed. Stop typing and the
colour stops moving. At the boundary itself the two palettes are mixed half and half, so
the tiles cut on the frame where the colour is furthest from both and least likely to be
read as a change of light — and the palette carries on moving out the other side.

The mix is **quantised into a fixed number of steps** rather than left continuous. Every
sprite in the game is baked once per palette, so a continuum of palettes is a cache with
no bound; a fixed number of steps is a fixed number of bakes. The step count is art, not
tuning — it lives with the parallax depths in `core/worlds.ts` — and the window is
`scene_blend_verses` in [the tuning table](07-tuning.md), because how fast the world turns
under you is something the owner may want to turn.

## Held scenes: not every passage is a journey

The world scrolls because finishing a word carries the scribe forward. That is right for
narrative -- Exodus is a journey and reads as one -- and wrong for a passage where nobody
is going anywhere. The serpent and the woman are talking. Nothing about that conversation
travels, and sliding a landscape past it is the game insisting on movement the text does
not have.

**A scene may be held.** The camera does not translate; word progress advances the
*tableau* instead. The serpent leans in, the fruit is taken, the garden closes. Still
entirely player-paced, still nothing on a clock, still driven by the same completed words
-- what changes is what those words move.

It is one column on the scene rows, `held`, and it changes exactly one thing: a word
finished inside a held range does not advance the camera. Everything else is already
built. A [set piece](#set-pieces) is a pure function of progress through the range it
decorates, so the tableau it draws is *already* moved by completed words and by nothing
else -- which is why a held scene needs a flag rather than a mechanism.

Three consequences, and all three are worth having in writing.

**The world does not lurch when the hold ends.** The camera is a function of *travelled*
words rather than of all words: a word typed while the scene is held is not travelled, and
the count of them is subtracted for the rest of the passage. So the scribe resumes from
where he was standing rather than jumping forward by everything that happened while the
serpent was talking. `core/motion.ts` holds that arithmetic, and it is the same module
that holds reduced motion, because they are the same question asked twice.

**No monsters stand in a held scene.** A monster's world position is derived from the
position the camera will have reached when its word is finished, and in a held range the
camera never reaches it -- so it would be felled off the right-hand edge of the screen,
which is a reward the player never sees. There are none placed there instead. That is also
the right picture: a skeleton in Eden during the temptation is the platformer talking over
the passage.

**It is the natural rest.** A held scene has no lateral scroll at all, and lateral scroll
is the largest contributor to the motion aftereffect described in
[motion and comfort](12-motion-and-comfort.md). So the passages that most want to stand
still are also the ones that give the eyes a break, and a long session acquires a rhythm
of travelling and stopping rather than one unbroken slide. Held scenes and
[reduced motion](12-motion-and-comfort.md#what-reduced-motion-changes) are the same
mechanism seen twice: one is authored per passage because of what the text is doing, the
other is chosen by the player because of what his eyes are doing, and both end in the same
line of arithmetic.

### Genesis 3, authored as the chapter it is

Genesis 1 needed [verse ranges](#verse-ranges) because it moves through seven places.
Genesis 3 needs them for the opposite reason: it is a conversation, a decision and its
consequence, and only the last verse of it goes anywhere at all. Five beats, four of them
held:

| range | held | reads as |
|---|---|---|
| `Genesis 3:1-5` | yes | the serpent, above in the branches, leaning further down the bough as it talks |
| `Genesis 3:6` | yes | the tree, and one fruit leaving the bough |
| `Genesis 3:7` | yes | fig leaves closing along the ground, one after another |
| `Genesis 3:8-23` | yes | the light cooling toward evening and something moving among the trees |
| `Genesis 3:24` | — | driven out: the way behind them closes, and a flaming sword turns |

**The serpent is in the branches, and stays there.** Above the rail and behind the scribe,
where the whole of the scenery band is -- a serpent near the words is not atmosphere, it
is a distraction from the one thing on screen the player is meant to be reading. It is not
on the ground because the ground is where the scribe is walking, and because the curse in
verse 14 is the first time the text puts it there; before that it is in the tree it is
talking about.

**Nothing draws a figure for the voice in verse 8.** The text says they *heard*, and what
the tableau moves is the light and the trees. A flourish that put a person in the garden
would be the scenery making a claim the passage does not.

**The last verse travels, and it is the only one that does.** Being driven out is the one
thing in the chapter that is movement, so it is the one row without the flag -- the world
starts scrolling again on the verse where they are put out of the garden, and the
gate closing and the sword turning happen behind the scribe as he goes.

**The scribe never becomes anyone.** He is a novice copying a manuscript, in every book,
including the Gospels -- the owner asked, and the answer matters. It is why followers
work: they join *him*, an outsider who copied their passage, rather than him becoming
them. And it is why a descent into the earth is something the **page** does while he
watches, not something he performs. He is illuminating it, which is what a scriptorium is
for.

### Genesis 4, which is where the default earns itself

Genesis 4 is the chapter that exposed the abbey, so it is also the fairest test of what
replaced it. Three beats, and the owner named all three: the field where they bring their
offerings, the ground that will not yield after it has opened its mouth for his brother's
blood, and Nod, east of Eden, where he settles as a fugitive and a wanderer.

| range | theme | held | reads as |
|---|---|---|---|
| `Genesis 4:1-10` | `hills` | — | worked country: a keeper of sheep, a tiller of the ground, the offerings carried out to it, and the field they go into |
| `Genesis 4:11-15` | `desert` | yes | cursed from the ground: it will not yield its strength to him, and the land bleaches while it is being said |
| `Genesis 4:16-26` | `desert` | — | Nod, east of Eden, and the world scrolls again as he goes |

**The boundary is verse 11, not verse 8.** The killing happens in the field and the field
is still country; what turns the ground is the sentence passed on it — *"now you are
cursed because of the ground, which has opened its mouth"*. So the palette eases from dry
grass to ochre across the verse where the curse is spoken, and the ground goes barren
under the player as he types the reason it does.

**The middle beat is [held](#held-scenes-not-every-passage-is-a-journey) and the last is
not**, which is exactly the shape Genesis 3 has: nobody travels while *"where is Abel your
brother?"* is being asked, and verse 16 — he leaves, and lives in the land of Nod — is the
one thing in the chapter that is movement. Genesis 3:24 and Genesis 4:16 are the same row
written twice, which is the argument for the flag rather than for a mechanism.

Nothing here has a set piece. Three themes and one flag carry the whole chapter, which is
the point of having a default that is already the right kind of place: an authored chapter
should mostly be saying *where*, and reach for a flourish only where the text does
something a palette cannot.

### John 20, a tomb that becomes a garden

The [route reaches the resurrection](../decisions/0012-the-route-must-not-skip-the-events.md)
now, and its chapter is the clearest case for verse resolution the game has after
Genesis 1: it opens in the dark outside a grave and ends in a room with the doors shut,
and in between a woman turns round and stops mistaking a garden for a graveyard.

| range | theme | setpiece | reads as |
|---|---|---|---|
| `John 20` | `daybreak` | `light_from_dark` | the chapter as a whole, which is what the *tune* is keyed on |
| `John 20:1-15` | `tomb` | `light_from_dark` | still dark, the stone gone, the linen lying — and light gathering along the ground as the verses are written |
| `John 20:16-18` | `garden` | — | *"Jesus said to her, 'Mary.'"* The place does not move; what she is standing in changes |
| `John 20:19-31` | `abbey` | — | evening, the same day, and the doors locked where the disciples were assembled |

**The cut is on verse 16 because that is where she recognises him**, not on verse 15 where
the word *gardener* appears. Verse 15 is the mistake — she takes him for the gardener and
asks where the body has been carried — and rendering the garden there would be the scenery
agreeing with the error. One verse later he says her name, and the palette has already been
easing toward green for half the window, so the world arrives at the same moment she does.

**The chapter row is `daybreak` and is never drawn**, exactly as Genesis 1's is. Three
verse rows cover all thirty-one verses, so the chapter row's only job is to answer *what is
John 20* -- on the map, and to a warp arriving on the chapter rather than inside it.
`daybreak` is the right answer to that: this file already says the theme "carries the first
day of Genesis 1, John 1's light in the darkness and the new creation equally well".

It used to choose the hymn as well, and the objection to keying that on `tomb` was that it
would open the resurrection with a passion chorale and hold it for thirty-one verses. That
is no longer the choice on offer. The tune follows the verse rows and crossfades between
them, so the chapter opens on the passion chorale *while it is still dark outside a grave*,
turns with her on verse 16, and is indoors by verse 19 -- three tunes over thirty-one
verses, none of them held past the place it belongs to and none of them cut off.

**The last third is the abbey, and this is the first row in the table that means it.**
Verses 19 to 31 are indoors: evening, a shut door, a room with people in it. That is what
the theme is a picture of, and it can be used for it now that it is not also the picture of
every chapter nobody has authored.

### Jerusalem: a place you arrive at

The third face of [the resolution problem](#a-chapter-is-not-one-place), and the one that
stayed open longest. The owner: *"Later on like moving through jerusalem and stuff might
be tricky."*

He is right, and the fix is not a better `tile_brick`. A landscape is texture that
repeats, and a parallax band is very good at that: one ridge is every ridge and nobody
minds, because one hill really is like the next one. A city is not like that. It is a
wall you walk along, a gate you go through, and a building you can see from anywhere in
it -- and what makes it a *place* rather than a pattern is that those things arrive in an
order and are left behind. No amount of brick does that, because brick is the part of a
city that repeats.

#### A landmark is a pass fraction

A set piece is [named scalars in 0..1](#set-pieces) and that does not change here. What is
added is one *reading* of a scalar. Every other parameter in the table is a thing rising
or falling -- `water`, `smoke`, `lift`, `cover`. A landmark's parameter is a **position
relative to the scribe**:

| the number | what it means |
|---|---|
| 0 | ahead of him, not in sight |
| 0.5 | abreast of him |
| 1 | behind him, gone |

`core/draw.ts` turns that into an x across the band -- off the right edge at 0, centred at
0.5, off the left edge at 1 -- and draws nothing at all at either end. So a gate comes up,
passes and goes, moved by the words the player types and by nothing else.

That is deliberately **not** a new mechanism. It needs no new command, no new field, no
per-frame script and no state: it is the same pure function of progress to fractions that
the flood and the fig leaves are, read as a position instead of as a level. The two things
it does need are small and both are art rather than tuning -- how much of a passage a
landmark takes to cross the band, and how wide it is drawn -- so they live beside the
flame periods in `core/setpieces.ts` and the band composition in `core/draw.ts`, for the
same reason the parallax depths live in `core/worlds.ts`.

Two rules it inherits, and both matter more here than anywhere else in this file:

- **Behind the scribe and above the rail.** Landmarks are drawn in the scenery band with
  everything else, before the scribe, and clamped into it by the same `bandRect` every
  other flourish is clamped by. A city gate is the largest thing this game draws; it is
  still scenery, and scenery serves the text.
- **Nothing is arrived *at* that the player has to do anything about.** A landmark is not
  a checkpoint, is not collected, cannot be missed and costs nothing. It is the world
  saying where he is, which is the register every set piece in this file is written in.

#### What was authored, and where

Three chapters, and only where the text itself moves through the city. Most passages need
nothing, which is why the table is still mostly one row a chapter.

| range | theme | setpiece | held | reads as |
|---|---|---|---|---|
| `John 8:1-11` | `city` | `up_to_the_temple` | — | early in the morning, up through the city: the gate comes on and passes, the wall runs alongside, and the temple front stands up ahead and stays |
| `John 8:12-59` | `temple` | `lamps_kindled` | yes | the treasury at the feast, and nobody travels while it is being said |
| `John 19:1-16` | `city` | — | yes | the Praetorium and the Pavement: a trial, and a trial does not go anywhere |
| `John 19:17-22` | `city` | `out_of_the_gate` | — | *"he went out"* -- the gate passes and the wall falls away small behind him |
| `John 19:23-42` | `mountain` | `darkness_at_noon` | — | the cross, and the garden and the new tomb at the end of it |
| `Matthew 27:1-26` | `city` | — | — | morning in the city: bound and led away, the potter's field, the judgment hall |
| `Matthew 27:27-33` | `city` | `out_of_the_gate` | — | out of the common hall to the place called Golgotha, the same way out |
| `Matthew 27:34-66` | `tomb` | `darkness_at_noon` | — | the cross, the darkness over all the land, and the sealed tomb at evening |

**Matthew 27 was a tomb from its first verse, and it is not one until verse 57.** The
chapter opens in the city at daybreak with a council, a betrayer and a governor in it, and
rendering that as a grave is the same class of untruth as
[an abbey for Genesis 4](#the-default-is-a-property-of-the-text-and-the-bibles-is-open-country):
a place asserted that the text does not support. The chapter row stays `tomb`, because
`tomb` is the honest one-word answer to *what is Matthew 27* on the map, and the two thirds
of it that happen before the hill now say so.

**The two crucifixion rows keep exactly the theme and the flourish their chapter rows
already had**, which is deliberate: Matthew 27 arrives at the passion chorale on the verse
the cross is raised, John 19 arrives at the mountain on the same verse, and neither is a
change to anything anyone has already heard. The only new claim either chapter makes is
about the part of it that is Jerusalem.

**John 19:1-16 is [held](#held-scenes-not-every-passage-is-a-journey) and John 8:12-59 is
too**, for the reason Genesis 3 is: a trial and a dispute are conversations, and sliding a
landscape past a conversation is the game insisting on movement the text does not have.
It also means the landmarks stand still while nobody is travelling, which is what a
landmark does.

**Exodus 12 is a `city` passage and gets none of this.** The theme is not only Jerusalem
-- it is sandstone, walls and doorways, and Exodus 12 is a street in Egypt on the night
the doorposts are marked. Putting a gate of Jerusalem into it would be the scenery making
a claim the passage does not, so it keeps `blood_on_doorposts` and nothing is added to it.

## Set pieces

A **set piece** is a one-off scripted flourish for a specific passage — optional per
scene, so most passages need only a theme and the memorable ones can be special.

<!-- generates: data/scenes/bible.json -->

| range | theme | setpiece | held |
|---|---|---|---|
| Genesis 1 | `daybreak` | `light_from_dark` | — |
| Genesis 1:1-2 | `void` | — | — |
| Genesis 1:3-5 | `daybreak` | `light_from_dark` | — |
| Genesis 1:6-8 | `sea` | `waters_divided` | — |
| Genesis 1:9-13 | `garden` | `land_from_water` | — |
| Genesis 1:14-19 | `firmament` | — | — |
| Genesis 1:20-25 | `sea` | `swarming` | — |
| Genesis 1:26-31 | `garden` | — | — |
| Genesis 2-3 | `garden` | — | — |
| Genesis 3:1-5 | `garden` | `serpent_in_the_branches` | yes |
| Genesis 3:6 | `garden` | `fruit_taken` | yes |
| Genesis 3:7 | `garden` | `fig_leaves` | yes |
| Genesis 3:8-23 | `garden` | `walking_in_the_garden` | yes |
| Genesis 3:24 | `garden` | `flaming_sword` | — |
| Genesis 4:1-10 | `hills` | — | — |
| Genesis 4:11-15 | `desert` | — | yes |
| Genesis 4:16-26 | `desert` | — | — |
| Genesis 6-9 | `sea` | `rising_water` | — |
| Genesis 22 | `mountain` | — | — |
| Exodus 3 | `desert` | `burning_bush` | — |
| Exodus 12 | `city` | `blood_on_doorposts` | — |
| Exodus 14 | `sea` | `parted_walls` | — |
| Exodus 16-17 | `desert` | `manna` | — |
| Exodus 19-20 | `mountain` | `smoke_and_fire` | — |
| Numbers 21 | `desert` | — | — |
| Psalm 22-23 | `abbey` | — | — |
| Isaiah 53 | `abbey` | — | — |
| Jonah 1-2 | `storm` | `swallowed` | — |
| Matthew 12 | `city` | `bruised_reed` | — |
| Matthew 27 | `tomb` | `darkness_at_noon` | — |
| Matthew 27:1-26 | `city` | — | — |
| Matthew 27:27-33 | `city` | `out_of_the_gate` | — |
| Matthew 27:34-66 | `tomb` | `darkness_at_noon` | — |
| John 1 | `daybreak` | `light_from_dark` | — |
| John 3 | `city` | `lifted_up` | — |
| John 6 | `desert` | `loaves_multiplied` | — |
| John 8 | `temple` | `lamps_kindled` | — |
| John 8:1-11 | `city` | `up_to_the_temple` | — |
| John 8:12-59 | `temple` | `lamps_kindled` | yes |
| John 10 | `garden` | `gate_of_the_fold` | — |
| John 19 | `mountain` | `darkness_at_noon` | — |
| John 19:1-16 | `city` | — | yes |
| John 19:17-22 | `city` | `out_of_the_gate` | — |
| John 19:23-42 | `mountain` | `darkness_at_noon` | — |
| John 20 | `daybreak` | `light_from_dark` | — |
| John 20:1-15 | `tomb` | `light_from_dark` | — |
| John 20:16-18 | `garden` | — | — |
| John 20:19-31 | `abbey` | — | — |
| Revelation 22 | `garden` | `tree_of_life` | — |

`held` marks a range in which the camera does not translate and the tableau carries the
passage instead -- one column, and the whole of
[held scenes](#held-scenes-not-every-passage-is-a-journey). Blank is the ordinary case and
means the world scrolls, which is what every row meant before the column existed.

A set piece produces **named scalars in 0..1 and no draw commands**; `core/draw.ts` turns
those into rects inside the scenery band, and nowhere else. Ten little renderers, each
with its own idea of the palette and the bands, is ten ways for the picture to disagree
with itself — and a flourish that could reach below the band would be scenery competing
with the rail it exists to serve.

A set piece is **not something the player gains**. Nothing here is picked up, scored,
counted or lost; every one of them is the world responding to what is being written, which
is why they can be scripted from progress alone and why missing one costs nothing.

**The Gospels want set pieces more than anything else does.** They had almost none
while Exodus had four, so the passages the route is built to reach carried the least
weight on screen. Every Gospel passage the route names now has one, and each is the world
answering rather than the player collecting:

| passage | setpiece | what the world does |
|---|---|---|
| Matthew 12 | `bruised_reed` | a bent reed lifts and a guttering wick keeps its ember — the world declines to finish off what is nearly out |
| John 3 | `lifted_up` | a standard rises in the middle of the band and the sky behind it lightens, as the serpent was lifted in the wilderness |
| John 6 | `loaves_multiplied` | baskets fill along the ground, and there is more at the end than there was at the start |
| John 8 | `lamps_kindled` | the temple lamps light one after another down the colonnade until the whole band is lit |
| John 10 | `gate_of_the_fold` | the gate of the sheepfold opens across the band and stays open |
| Matthew 27, John 19 | `darkness_at_noon` | the palette drains to greyscale over the passage |
| John 1 | `light_from_dark` | the void takes light as the verses are written |
| John 20:1-15 | `light_from_dark` | the same flourish over a tomb: the dark drains off the band and light gathers along the ground, because she came while it was still dark |

The five flourishes Genesis 3 is made of are all
[held](#held-scenes-not-every-passage-is-a-journey) but the last, so in four of them the
tableau is the only thing moving on the screen:

| passage | setpiece | what the world does |
|---|---|---|
| Genesis 3:1-5 | `serpent_in_the_branches` | a bough stands across the top of the band and the serpent along it leans further down as the conversation runs -- never onto the ground, and never near the words |
| Genesis 3:6 | `fruit_taken` | the tree stands still and one fruit leaves the bough, down and out of the canopy |
| Genesis 3:7 | `fig_leaves` | leaves close along the ground one after another until the band's floor is covered |
| Genesis 3:8-23 | `walking_in_the_garden` | the light cools toward evening, the trees stir, and a shade gathers over them -- something moving in the garden, and nobody drawn |
| Genesis 3:24 | `flaming_sword` | the way behind them closes and a blade turns every way in front of it, while the world scrolls again for the first time in the chapter |

The two city flourishes are the same two verbs the
[landmark section](#jerusalem-a-place-you-arrive-at) describes, and they are the only
flourishes in the table whose parameters are *positions* rather than levels:

| passage | setpiece | what the world does |
|---|---|---|
| John 8:1-11 | `up_to_the_temple` | the gate comes on out of the right of the band, passes and is gone; the wall grows along the horizon as he goes up; the temple front rises at the end of it and stays |
| John 19:17-22, Matthew 27:27-33 | `out_of_the_gate` | the same gate, the other way round: it passes and is left behind, the wall falls away small, and the banners on it stir |

Between them they are the gate, the wall and the temple the owner asked for, and there are
two rather than one because *going up to* a city and *being taken out of* it are not the
same picture -- in one the wall grows and something arrives to stay, in the other
everything gets smaller behind you.

`rising_water` physically raises the level as the flood does. `parted_walls` stands the
sea up on either side of the rail. `darkness_at_noon` drains the palette to greyscale
over the passage. `waters_divided` opens water above from water below; `land_from_water`
drains the sea off and closes green over the ground; `swarming` fills the band with things
moving that were not there before. Set pieces are scripted, not procedural — there are few
enough that hand-authoring each is cheaper than a system.

Any passage with no row here resolves to its
[text's default](#the-default-is-a-property-of-the-text-and-the-bibles-is-open-country) --
`hills` for the Bible, `abbey` for a text with no default row and for a text with no
scene file at all. `make check` asserts every routed passage resolves to a theme, that
every default names a theme this game can draw, and that no ranges overlap. Overlap is checked *within*
a precision: two chapter rows may not claim one chapter and two verse rows may not claim
one verse, but a verse row is expected to sit inside a chapter row and wins where it does.

## Warps

Warps are how the route's echo edges are travelled. The scribe steps into a shimmering
doorway and phases into the connected passage.

The detail that makes them worth building: **during the phase, the echoed words are the
only thing on screen that does not change.** Genesis 1's void dissolves into John 1's
starfield while `In the beginning` stays lit exactly where it sits on the rail. The
connection *is* the transition — the player sees two passages sharing a phrase because
the phrase is what survives the cut.

Echo phrases are authored in [the route table](04-route.md#edges) and verified against
the text; they are never string-matched at runtime.

**Flashback warps** additionally push a return frame. Entering and leaving one must
restore the exact verse, cursor position, hearts, smudge level and combo — and skipping a
flashback entirely must leave the level completable. A secret room that eats progress or
gates the exit is worse than no secret room.
