# The route

**Implemented by:** `core/route.ts`, `core/warp.ts`, `platform/web/overlay.ts`

## A graph, not a reading plan

Typing through the whole Old Testament to reach Jesus would sink the game. Nobody starting
at 10 WPM survives Leviticus.

So the map is not a linear list of books. It is a **small graph of passages connected by
textual echo**, where every edge is a real link between what one passage says and what a
later one does with it. Typing them back to back makes the connection land in a way that
reading them years apart never does.

```
Genesis 1   creation ─────────┬──────▶ John 1        "In the beginning was the Word"
                              ├──────▶ Genesis 2     "every living creature", named by the man
                              └──────▶ John 20       "the first day", and it was still dark
Genesis 3   the fall ─────────┬──────▶ Revelation 22  the tree of life, returned
                              └──────▶ John 20        the garden, and the gardener
Exodus 3    I AM ────────────────────▶ John 8        "before Abraham came into being, I AM"
Psalm 23    the shepherd ────────────▶ John 10       "I am the good shepherd"
Psalm 22    "why have you ───────────▶ Matthew 27     quoted from the cross
             forsaken me"
```

Two of those threads were added late and for the same reason
([ADR 0012](../decisions/0012-the-route-must-not-skip-the-events.md)): the graph was
authored from its *echoes*, echoes cluster on famous verses, and the events those verses
are about had been left out. It reached the crucifixion and not the resurrection, and it
stepped from Genesis 1 straight over Genesis 2 to the fall. Neither hole was visible from
inside the route -- every edge in it was a real echo, and the check that verifies echoes
cannot notice a passage nobody wrote an edge to.

Nothing was invented to close them. `the first day` is Genesis 1:5 and John 20:1 verbatim
in both shipped translations; `garden` stands in Genesis 3 and inside *"supposing him to
be the gardener"* in John 20:15, which is where the word does its work; `every living
creature` is made in Genesis 1:21 and named by the man in Genesis 2:19.

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

| id | kind | from | to | echo | echo_kjv | note |
|---|---|---|---|---|---|---|
| `beginning` | progression | Genesis 1 | John 1 | `In the beginning` | — | John opens by quoting Genesis word for word |
| `i-am` | progression | Exodus 3 | John 8 | `I AM` | — | The name given at the bush, claimed at the temple |
| `shepherd` | progression | Psalm 23 | John 10 | `shepherd` | — | The psalm's image, claimed in the first person |
| `forsaken` | progression | Psalm 22 | Matthew 27 | `My God, my God` | — | Quoted from the cross, verbatim |
| `living-creature` | progression | Genesis 1 | Genesis 2 | `every living creature` | — | Made in the first telling, named by the man in the second |
| `tree-of-life` | progression | Genesis 3 | Revelation 22 | `tree of life` | — | The tree barred at the start, open at the end |
| `first-day` | progression | Genesis 1 | John 20 | `the first day` | — | The new creation opens on the first day, in the dark, where Genesis opened |
| `gardener` | progression | Genesis 3 | John 20 | `garden` | — | The garden where it went wrong, and the garden she took him for the gardener in |
| `only-son` | flashback | John 19 | Genesis 22 | `your son` | `thy son` | A father, an only son, a hill — seen from the cross |
| `serpent` | flashback | John 3 | Numbers 21 | `serpent` | — | John 3:14 cites the bronze serpent outright |
| `three-days` | flashback | Matthew 12 | Jonah 1 | `three days and three nights` | — | Jesus names Jonah as the sign |
| `passover` | flashback | John 19 | Exodus 12 | `bone` | — | John quotes the Passover rule about unbroken bones |
| `manna` | flashback | John 6 | Exodus 16 | `bread` | — | The bread-of-life discourse argues from the manna |

`echo_kjv` overrides `echo` when the King James wording differs. The `only-son` edge is
the case that forced the column: WEB reads "your son" in both Genesis 22 and John 19,
KJV reads "thy son" in both. The possessive pronoun is precisely what the translations
disagree about, so a single shared string would have to collapse to the bare noun `son` --
too common a word to read as a deliberate echo when it stays lit through a warp.

**These echo phrases are verified against the actual text.** `make check` asserts each
one occurs literally in *both* connected passages, under WEB and KJV both, because a
translation switch can silently break an echo. If a check fails, fix the phrase in this
table — never the check.

## How it is played

The graph is a screen. **The map** — from the menu — lists every passage the route
names, says which are open, which are finished and which secret rooms have been found,
and lists every thread with its note. The note is the point of the screen: a list of
passages in canonical order is a reading plan, and *"John opens by quoting Genesis word
for word"* is what makes it a route. Choosing a passage the player has earned travels the
thread that unlocks it, which runs the [warp](05-scenery-warps.md#warps).

A **doorway** stands open on the echoed phrase itself and stays open to the end of that
verse — the only place in the passage where stepping backwards means anything, and long
enough to be noticed in. It is named in one sentence in the strip under the rail -- the
key, the passage it opens onto, and the route's own note about the echo, in that order --
and **Tab** steps through it. Naming the destination is what makes that sentence an
invitation rather than a control: *tab: a doorway* says only that something is there.
Tab again, or finishing the short stretch inside, phases forward to the exact verse
left. Typing on is how you decline one, and declining costs nothing:
`requiredRefs` is built from the stops, a flashback destination is a secret by
construction, and the platform filters its doorways through that guarantee rather than
restating it.

A room the player has entered is recorded in the progress record as `discovered`, because
a player who steps in, turns round and walks straight back out has still found it, and a
reload must not be a cheaper way to lose a room than walking out of one.

## Standing off the route

A player can be in a chapter the graph does not name. The menu lets them jump anywhere,
and reading straight on from Genesis 3 reaches Genesis 4, which is not a node.

**The map must not claim they are somewhere they are not.** It previously fell back to the
route's first entry, so someone in Genesis 2 was told *you are here* at Genesis 1 — a small
untruth of exactly the kind the rest of this project refuses. The report card establishes
the rule: never assert what the data does not support.

So when the current passage is not a node:

- **No node is marked.** Nothing says *you are here*, because nothing on the map is where
  they are.
- The map says plainly where they actually are, and that it is not on this route:
  *You are reading Genesis 4, which is not on the Pilgrimage. Nothing is wrong — the
  route is a set of threads, not a fence.*
- The last route node they completed stays marked as finished, so they can see where they
  left the threads and get back to one.

Being off the route is a normal thing to do, not an error, and the wording carries that.
Someone who wandered should not be told off for it by a screen.

## Alternate routes

Routes are data, so alternates are cheap:

- **Pilgrimage** (default) — the graph above. Promise and fulfilment.
- **Canonical** — straight through, for a player who wants it.
- **Narrative** — story only; no law, no genealogy.
- **Wisdom** — Proverbs and Psalms. Short, self-contained lines where every verse is a
  complete thought. The gentlest possible first hour, and the best route for someone who
  finds Genesis daunting.

## Two texts, and the second act

[ADR 0002](../decisions/0002-web-and-kjv-not-net.md) ships two public-domain translations:
the **World English Bible**, which is the default, and the **King James Version**, which is
harder to type. Both loaded and the menu could switch between them long before anything
said *why* — the control was a dropdown of two proper nouns, which presents a difficulty
step as a preference about wording.

It is not a preference. Measured over both shipped texts:

| | WEB | KJV |
|---|---|---|
| Words carrying an archaic ending or pronoun (`-eth`, `-est`, thee, thou, thy, thine, ye) | 1 in 737 | **1 in 29** |
| Colons and semicolons per 100 words | 1.0 | **3.0** |
| Mean sentence length, in words | 19 | **29** |
| Commas per 100 words | 8.8 | 8.8 |

The last row is there because it is the one people expect to move, and it does not. The
archaic morphology is the real cost — a word in thirty is a spelling the player's fingers
have no habit for — and the sentences are half as long again, held together by colons and
semicolons rather than broken by full stops, so there is further to go before a rest.

**So the menu says that, in the player's own terms**, in a section of its own rather than
as a second item in the go-somewhere-else row. It names what changes, gives the two numbers
that matter, and says out loud what it does *not* do.

**It is not a stage, and it must never become one.** The curriculum, the illumination sets
and the [mastery gate](06-curriculum.md#the-mastery-gate) are identical in either text: the
same keys are lit, and the same accuracy and latency are demanded of them. A player who
switches has changed the prose, not the standard. Nothing about the translation may be
allowed to reach the gate — the gate measures whether a key has been learned, and typing
`knowest` does not teach a different `k`.

What it *is* is the honest answer to "I have finished the curriculum, what now" — a second
pass over the same keys in harder prose. The menu says so when the player reaches the last
stage, and offers it before then to anyone who wants it early. It is offered, not gated:
locking it would make it invisible again, which is the problem this section exists to fix.

## Genealogies

Skipped by default on every route. Genesis 5 is forty lines of *"and Mahalalel lived
eight hundred and thirty years"* — miserable typing and unreadable prose for a beginner.

They remain available as optional **Chronicle** bonus levels for anyone wanting
completeness. Skipping is the default, not the only option.
