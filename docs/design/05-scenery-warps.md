# Scenery, set pieces and warps

**Implemented by:** `core/scenes.ts`, `core/setpieces.ts`, `core/worlds.ts`, `core/sprites.ts`, `core/warp.ts`, `core/draw.ts`

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
| `abbey` | stone greys, candle amber | the default; cloister and library | `veni-creator` |
| `garden` | deep greens, gold light | Eden, before the fall | `wondrous-love` |
| `desert` | ochre, bleached sky | wilderness and wandering | `cwm-rhondda` |
| `sea` | blues, foam white | flood, parted waters, deep | `melita` |
| `mountain` | slate, smoke, fire | Sinai, Moriah, high places | `nicaea` |
| `storm` | bruised purple, lightning | Jonah, tempest, dread | `dies-irae` |
| `city` | sandstone, banners | Jerusalem, walls and gates | `ewing` |
| `temple` | gold, deep red, incense | sanctuary and altar | `nun-danket` |
| `tomb` | near-black, cold blue | the grave, catacombs | `passion-chorale` |
| `apocalypse` | white-gold, void black | new creation, the end | `helmsley` |
| `void` | black on black, one shade of deep | before the first day: no ground, no horizon | `veni-creator` |
| `firmament` | night blue, star white | the expanse, lights set in it | `nicaea` |

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
| `Genesis 1:3-5` | `apocalypse` | `light_from_dark` | light breaking over it |
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

**The tune follows the chapter's row, not the verse's.** A theme owns a tune, and a tune
restarts when the theme changes; at verse granularity that is six restarts inside Genesis 1,
each one cutting a hymn off mid-phrase. So the picture resolves per verse and the music
per chapter. The scenery serves the rail, and a hymn beginning again every five verses is
the scenery asking to be noticed.

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

## Set pieces

A **set piece** is a one-off scripted flourish for a specific passage — optional per
scene, so most passages need only a theme and the memorable ones can be special.

<!-- generates: data/scenes/bible.json -->

| range | theme | setpiece |
|---|---|---|
| Genesis 1 | `apocalypse` | `light_from_dark` |
| Genesis 1:1-2 | `void` | — |
| Genesis 1:3-5 | `apocalypse` | `light_from_dark` |
| Genesis 1:6-8 | `sea` | `waters_divided` |
| Genesis 1:9-13 | `garden` | `land_from_water` |
| Genesis 1:14-19 | `firmament` | — |
| Genesis 1:20-25 | `sea` | `swarming` |
| Genesis 1:26-31 | `garden` | — |
| Genesis 2-3 | `garden` | — |
| Genesis 6-9 | `sea` | `rising_water` |
| Genesis 22 | `mountain` | — |
| Exodus 3 | `desert` | `burning_bush` |
| Exodus 12 | `city` | `blood_on_doorposts` |
| Exodus 14 | `sea` | `parted_walls` |
| Exodus 16-17 | `desert` | `manna` |
| Exodus 19-20 | `mountain` | `smoke_and_fire` |
| Numbers 21 | `desert` | — |
| Psalm 22-23 | `abbey` | — |
| Isaiah 53 | `abbey` | — |
| Jonah 1-2 | `storm` | `swallowed` |
| Matthew 12 | `city` | `bruised_reed` |
| Matthew 27 | `tomb` | `darkness_at_noon` |
| John 1 | `apocalypse` | `light_from_dark` |
| John 3 | `city` | `lifted_up` |
| John 6 | `desert` | `loaves_multiplied` |
| John 8 | `temple` | `lamps_kindled` |
| John 10 | `garden` | `gate_of_the_fold` |
| John 19 | `mountain` | `darkness_at_noon` |
| Revelation 22 | `garden` | `tree_of_life` |

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

`rising_water` physically raises the level as the flood does. `parted_walls` stands the
sea up on either side of the rail. `darkness_at_noon` drains the palette to greyscale
over the passage. `waters_divided` opens water above from water below; `land_from_water`
drains the sea off and closes green over the ground; `swarming` fills the band with things
moving that were not there before. Set pieces are scripted, not procedural — there are few
enough that hand-authoring each is cheaper than a system.

Any passage on a route with no row here resolves to `abbey`. `make check` asserts every
routed passage resolves to a theme and that no ranges overlap. Overlap is checked *within*
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
