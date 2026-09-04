# Scenery, set pieces and warps

**Implemented by:** `core/scenes.ts`, `core/setpieces.ts`, `core/worlds.ts`

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

## Set pieces

A **set piece** is a one-off scripted flourish for a specific passage — optional per
scene, so most passages need only a theme and the memorable ones can be special.

<!-- generates: data/scenes/bible.json -->

| range | theme | setpiece |
|---|---|---|
| Genesis 1 | `apocalypse` | `light_from_dark` |
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
| Matthew 12 | `city` | — |
| Matthew 27 | `tomb` | `darkness_at_noon` |
| John 1 | `apocalypse` | `light_from_dark` |
| John 3 | `city` | — |
| John 6 | `desert` | — |
| John 8 | `temple` | — |
| John 10 | `garden` | — |
| John 19 | `mountain` | `darkness_at_noon` |
| Revelation 22 | `garden` | `tree_of_life` |

`rising_water` physically raises the level as the flood does. `parted_walls` stands the
sea up on either side of the rail. `darkness_at_noon` drains the palette to greyscale
over the passage. Set pieces are scripted, not procedural — there are few enough that
hand-authoring each is cheaper than a system.

Any passage on a route with no row here resolves to `abbey`. `make check` asserts every
routed passage resolves to a theme and that no ranges overlap.

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
