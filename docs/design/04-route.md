# The route

**Implemented by:** `core/route.js`, `core/warp.js`

## A graph, not a reading plan

Typing through the whole Old Testament to reach Jesus would kill the game. Nobody starting
at 10 WPM survives Leviticus.

So the map is not a linear list of books. It is a **small graph of passages connected by
textual echo**, where every edge is a real link between what one passage says and what a
later one does with it. Typing them back to back makes the connection land in a way that
reading them years apart never does.

```
Genesis 1   creation ─────────────┐
Genesis 3   the fall ─────────┐   │
                              │   └──▶ John 1     "In the beginning was the Word"
Exodus 3    I AM ─────────────┼──────▶ John 8     "before Abraham came into being, I AM"
Psalm 23    the shepherd ─────┼──────▶ John 10    "I am the good shepherd"
Psalm 22    "why have you ────┼──────▶ Matthew 27  quoted from the cross
             forsaken me"     │
Isaiah 53   the servant ──────┘
                              └──────▶ Revelation 22   the tree of life, returned
```

Each edge appears on the map as a thread with a one-line note about the echo.

## Two kinds of edge

**Progression** edges move the player onward; they stay at the destination.

**Flashback** edges are round trips. Mid-level, at a specific verse, a doorway appears.
Step through and the player phases *backwards* into an older passage, types a short
stretch of it, and phases forward again to the exact verse they left.

Flashbacks are **optional secret rooms** — an altar you can walk straight past,
Castlevania-style — with the rarest items behind them. Finding one should feel like
finding a hidden room, because mechanically that is what it is. They must be short; a
flashback that outstays its welcome breaks the level it interrupts.

The strongest ones are those where the New Testament passage *explicitly quotes* the Old,
so the game is not editorialising, only showing what the text already does.

## Edges

<!-- generates: data/routes/pilgrimage.json -->

| id | kind | from | to | echo | note |
|---|---|---|---|---|---|
| `beginning` | progression | Genesis 1 | John 1 | `In the beginning` | John opens by quoting Genesis word for word |
| `i-am` | progression | Exodus 3 | John 8 | `I AM` | The name given at the bush, claimed at the temple |
| `shepherd` | progression | Psalm 23 | John 10 | `shepherd` | The psalm's image, claimed in the first person |
| `forsaken` | progression | Psalm 22 | Matthew 27 | `why have you forsaken me` | Quoted from the cross, verbatim |
| `tree-of-life` | progression | Genesis 3 | Revelation 22 | `tree of life` | The tree barred at the start, open at the end |
| `only-son` | flashback | John 19 | Genesis 22 | `your son` | A father, an only son, a hill — seen from the cross |
| `serpent` | flashback | John 3 | Numbers 21 | `serpent` | John 3:14 cites the bronze serpent outright |
| `three-days` | flashback | Matthew 12 | Jonah 1 | `three days and three nights` | Jesus names Jonah as the sign |
| `passover` | flashback | John 19 | Exodus 12 | `bone` | John quotes the Passover rule about unbroken bones |
| `manna` | flashback | John 6 | Exodus 16 | `bread` | The bread-of-life discourse argues from the manna |

**These echo phrases are verified against the actual text.** `make check` asserts each
one occurs literally in *both* connected passages, under WEB and KJV both, because a
translation switch can silently break an echo. If a check fails, fix the phrase in this
table — never the check.

## Alternate routes

Routes are data, so alternates are cheap:

- **Pilgrimage** (default) — the graph above. Promise and fulfilment.
- **Canonical** — straight through, for a player who wants it.
- **Narrative** — story only; no law, no genealogy.
- **Wisdom** — Proverbs and Psalms. Short, self-contained lines where every verse is a
  complete thought. The gentlest possible first hour, and the best route for someone who
  finds Genesis daunting.

## Genealogies

Skipped by default on every route. Genesis 5 is forty lines of *"and Mahalalel lived
eight hundred and thirty years"* — miserable typing and unreadable prose for a beginner.

They remain available as optional **Chronicle** bonus levels for anyone wanting
completeness. Skipping is the default, not the only option.
