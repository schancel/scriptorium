# The route

**Implemented by:** `core/route.ts`, `core/warp.ts`, `platform/web/overlay.ts`, `platform/web/main.ts`

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

## Finishing a passage offers the thread it leads to

The map was the *only* way onto a thread, and the map is a screen a player has to go
looking for. So the whole of this document was optional in the worst way: finish
Genesis 1, read straight on into Genesis 2, and never learn that the route or the threads
exist at all. The best idea in the game was invisible.
[ADR 0012](../decisions/0012-the-route-must-not-skip-the-events.md) closed it.

**Finish a passage a thread leaves, and the thread is offered** — one sentence in the
strip under the rail, in the same place, the same manner and the same register as a
[doorway](#how-it-is-played): the key, where it goes, and the route's own note about the
echo.

> `tab: a thread to John 1 · John opens by quoting Genesis word for word · or read on`

**It is an offer and not a fork.** Reading onward is the default and stays the default:
the next stretch of verses is already on the rail underneath the sentence, and typing is
what makes the sentence go. Declining costs nothing, is not recorded, and is not
mentioned again. Nothing about it moves the player, which is the whole difference between
this and travelling a thread — *"an offer that moves you is a fork, and the player did not
ask to leave."*

### One thread is offered, not three

Genesis 1 has three progression edges leaving it, and three of anything in the strip is a
menu rather than an invitation. Exactly one is named, and the others are **counted**:
the sentence ends `· 2 more on the route`, which is a signpost to the screen built for the
job rather than a second list in a place that holds one line.

Which one is decided by two rules and no taste:

- **A thread that lands where reading on lands is not an offer.** It is a description of
  the default. `living-creature` goes Genesis 1 → Genesis 2, and the player's very next
  keystroke after Genesis 1 is Genesis 2:1 — so offering it says nothing he is not already
  doing. It is skipped, and it is the reason this rule exists at all.
- **Otherwise the route's own table order.** `beginning` is first out of Genesis 1, and it
  is the strongest echo in the graph: John 1 opens by quoting Genesis word for word.
  `first-day` stays on the route screen with the rest.

### It is silent on a passage already travelled from

An offer that came back every time a chapter was finished would be nagging, and the
project has [a rule about a tip that returns](10-first-run.md#once-only-and-gone) after you
have understood it.

So: **if any passage a thread out of here leads to is already finished, nothing is
offered.** He has been where the signpost points, whether he travelled the thread or read
his way there, and a signpost to somewhere you have been is not a signpost. It is derived
from `completed` and needs no field on the record — which also means it survives a reload
without one, and cannot disagree with the route screen about what has been finished.

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

Routes are data, so alternates are cheap. Four ship:

- **Pilgrimage** (default) — the graph above. Promise and fulfilment.
- **Canonical** — straight through, for a player who wants it.
- **Narrative** — story only; no law, no genealogy, no epistle.
- **Wisdom** — Proverbs and Psalms. Short, self-contained lines where every verse is a
  complete thought. The gentlest possible first hour, and the best route for someone who
  finds Genesis daunting.

<!-- generates: data/routes/routes.json -->

| id | name | what it is |
|---|---|---|
| `pilgrimage` | Pilgrimage | Nineteen passages joined by phrases they share, from the first day to the new creation. The threads are the whole idea. |
| `canonical` | Canonical | All sixty-six books, first chapter to last. Nothing chosen for you, and nothing left out. |
| `narrative` | Narrative | The Bible as a sequence of events. The books that tell a story, and the chapters of the others that do; no law, no lists, no letters. |
| `wisdom` | Wisdom | The Psalms and the Proverbs. Short lines, one thought to a verse, and the shortest way into typing whole sentences. |

`name` and `what it is` are **player-facing copy**: they are what the menu says beside
each route, so they follow [the tone](10-first-run.md#tone) and describe the reading
rather than the data structure. `id` is what the progress record stores and what
`data/routes/<id>.json` is named after.

### Three of the four are lists, and that is not an omission

A thread is Pilgrimage's idea. Every edge in [the table above](#edges) is a phrase two
passages genuinely share, verified in both translations, and the map's whole argument is
the note beside it — *John opens by quoting Genesis word for word*. That argument is not
available anywhere else, because it is not true anywhere else. Canonical's reason for
putting Exodus after Genesis is that Exodus comes after Genesis; Wisdom is a **collection**,
and nothing claims Psalm 24 is about Psalm 23.

So the other three carry no edges at all. Inventing one to make them look consistent with
Pilgrimage would be the same failure
[ADR 0012](../decisions/0012-the-route-must-not-skip-the-events.md) records, pointed the
other way: that route was authored *from* its echoes and lost the events, and a route
given echoes it does not have would be asserting a link the text does not make. **A thread
that is not a real link is worse than no thread.**

What that costs is four sentences of copy and no mechanism, because everything downstream
was already reading the graph rather than assuming it:

- **The offer at the end of a passage never fires.** `threadOffer` looks for progression
  edges leaving the finished passage and finds none, so nothing is said and reading onward
  — which was always the default — is the whole of the route.
- **There are no secret rooms**, so the map's counter must not say secrets are not
  counted. On a threadless route it says how many passages are finished and stops there.
- **The thread list is replaced rather than left blank.** An empty heading reads as a
  screen that failed to load. The map says what this route is instead: *Canonical has no
  threads. It is the books in the order they are printed, first chapter to last.*
- **Standing off the route loses the word.** The sentence on the map is
  *"the route is a set of threads, not a fence"*, and on a route with no threads it is
  *"a list of passages, not a fence"*. The claim is the same and the noun is true.

### A stop may be a span of chapters

Pilgrimage names nineteen chapters and the map lists nineteen rows. Canonical names
**1,189**, and a screen with 1,189 rows on it is a phone book. So a stop may name a range
— `Genesis 1-50` — and the two readings of a range are kept apart rather than confused:

- **The map draws the span.** Sixty-six rows for Canonical, one per book, each marked
  finished when every chapter in it is finished. That is the screen a completionist
  wants: which books are behind him.
- **The route requires the chapters.** `requiredRefs` expands every span, so the counter
  reads *412 of 1,173 passages finished*, `routeComplete` means every chapter, and the
  genealogy default below has something to take out.

A span is not a new kind of citation: `Genesis 2-3` has parsed since the scene map needed
it, and `core/corpus.ts` has always returned a first and a last chapter. What is new is
that a route may use one.

### Canonical

The whole canon, in the order it is printed. It is the only route with nothing to say —
no threads, no notes, no selection — and saying nothing is exactly what is being asked
for. A player who wants the Bible front to back does not want a curator.

It is also the route the [Chronicle passages](#chronicle-the-genealogies-are-opt-in) are
taken out of. Every other route either avoids the genealogies by what it is about, or
names one book that contains them; Canonical names all sixteen chapters of them, so it is
where the default earns its keep.

<!-- generates: data/routes/canonical.json -->

| passage |
|---|
| `Genesis 1-50` |
| `Exodus 1-40` |
| `Leviticus 1-27` |
| `Numbers 1-36` |
| `Deuteronomy 1-34` |
| `Joshua 1-24` |
| `Judges 1-21` |
| `Ruth 1-4` |
| `1 Samuel 1-31` |
| `2 Samuel 1-24` |
| `1 Kings 1-22` |
| `2 Kings 1-25` |
| `1 Chronicles 1-29` |
| `2 Chronicles 1-36` |
| `Ezra 1-10` |
| `Nehemiah 1-13` |
| `Esther 1-10` |
| `Job 1-42` |
| `Psalms 1-150` |
| `Proverbs 1-31` |
| `Ecclesiastes 1-12` |
| `Song of Songs 1-8` |
| `Isaiah 1-66` |
| `Jeremiah 1-52` |
| `Lamentations 1-5` |
| `Ezekiel 1-48` |
| `Daniel 1-12` |
| `Hosea 1-14` |
| `Joel 1-3` |
| `Amos 1-9` |
| `Obadiah 1` |
| `Jonah 1-4` |
| `Micah 1-7` |
| `Nahum 1-3` |
| `Habakkuk 1-3` |
| `Zephaniah 1-3` |
| `Haggai 1-2` |
| `Zechariah 1-14` |
| `Malachi 1-4` |
| `Matthew 1-28` |
| `Mark 1-16` |
| `Luke 1-24` |
| `John 1-21` |
| `Acts 1-28` |
| `Romans 1-16` |
| `1 Corinthians 1-16` |
| `2 Corinthians 1-13` |
| `Galatians 1-6` |
| `Ephesians 1-6` |
| `Philippians 1-4` |
| `Colossians 1-4` |
| `1 Thessalonians 1-5` |
| `2 Thessalonians 1-3` |
| `1 Timothy 1-6` |
| `2 Timothy 1-4` |
| `Titus 1-3` |
| `Philemon 1` |
| `Hebrews 1-13` |
| `James 1-5` |
| `1 Peter 1-5` |
| `2 Peter 1-3` |
| `1 John 1-5` |
| `2 John 1` |
| `3 John 1` |
| `Jude 1` |
| `Revelation 1-22` |

### Narrative

**Story only. No law, no genealogy, no epistle.** Those are the three exclusions, and
they are the only three: a chapter is on this route when something happens in it.

The rule is applied as written, which matters most where it is inconvenient. Chronicles
retells Samuel and Kings, and the four Gospels tell one life four times — but *"a repeat"*
is not one of the three exclusions, and adding it would be this document deciding which
telling of an event is the real one. It has no business doing that. So Chronicles is here
and so are all four Gospels, and the route says nothing about the overlap because there is
nothing it can honestly say.

A whole book is named where the whole book is narrative, and a range where it is not.

<!-- generates: data/routes/narrative.json -->

| passage | note |
|---|---|
| `Genesis 1-50` | from the first day to a coffin in Egypt |
| `Exodus 1-20` | slavery, the plagues, the sea, and the mountain |
| `Exodus 24` | the covenant sealed, and Moses goes up into the cloud |
| `Exodus 32-34` | the calf, the broken tablets, and the second pair |
| `Numbers 11-14` | the quail, Miriam, and the spies who came back afraid |
| `Numbers 16-17` | Korah, and the rod that budded |
| `Numbers 20-25` | Meribah, the bronze serpent, and Balaam's donkey |
| `Numbers 27` | the daughters of Zelophehad, and Joshua commissioned |
| `Numbers 31-32` | Midian, and the tribes who asked to stay east of the river |
| `Deuteronomy 34` | Moses dies within sight of it |
| `Joshua 1-12` | the river, the walls, and the long day |
| `Joshua 22-24` | the altar by the Jordan, and Joshua's last words |
| `Judges 1-21` | the cycle, twelve times, and no king in Israel |
| `Ruth 1-4` | a famine, a field, and a redeemer |
| `1 Samuel 1-31` | Samuel, Saul, and the shepherd who was anointed |
| `2 Samuel 1-24` | the kingdom, the roof, and the son in the oak |
| `1 Kings 1-22` | the temple, the divided kingdom, and Elijah |
| `2 Kings 1-25` | Elisha to the exile |
| `1 Chronicles 1-29` | the same reign, told again for people coming home |
| `2 Chronicles 1-36` | the temple, and the kings measured against it |
| `Ezra 1-10` | the return, and the second foundation |
| `Nehemiah 1-13` | the wall, in fifty-two days |
| `Esther 1-10` | a banquet, an edict, and a queen who went in unasked |
| `Job 1-2` | the wager, and everything taken in one afternoon |
| `Job 42` | the frame closes: he sees, and it is given back |
| `Daniel 1-6` | the court stories: the furnace, the writing, the lions |
| `Jonah 1-4` | a man running the other way |
| `Matthew 1-28` | — |
| `Mark 1-16` | — |
| `Luke 1-24` | — |
| `John 1-21` | — |
| `Acts 1-28` | from the upper room to a rented house in Rome |

Four judgements in that table are worth the sentence they cost:

- **Exodus keeps chapter 20.** The Decalogue is law, and it is the one piece of law on
  this route, because stopping at 19 arrives at the mountain and leaves before anything is
  said on it. The *giving* of it is an event.
- **Leviticus is absent entirely and Deuteronomy keeps one chapter.** Deuteronomy is
  Moses preaching the law he has already been given; the one thing that happens in it is
  his death, and that is chapter 34.
- **Job keeps its frame and not its argument.** Chapters 1-2 and 42 are the story; the
  thirty-nine chapters between them are a poem, and a very good one, and not a sequence of
  events.
- **The genealogies inside these books are not cut out of the table.** `1 Chronicles 1-29`
  names the whole book and the default steps over 1-9, which is the same fact stated once
  instead of twice. The route says which books it is made of; the
  [Chronicle default](#chronicle-the-genealogies-are-opt-in) says which chapters everybody
  skips.

### Wisdom

The Psalms and the Proverbs, in the divisions the two books already have — the five books
of the Psalter, and the three collections Proverbs is assembled from. Nothing is
rearranged and nothing is left out, so a psalm that is neither short nor gentle is still
here; what the route is choosing is the **book**, not the mood.

<!-- generates: data/routes/wisdom.json -->

| passage | note |
|---|---|
| `Psalms 1-41` | Book I — mostly David, and the shortest psalms in the Psalter |
| `Psalms 42-72` | Book II — Korah and David, ending *the prayers of David are ended* |
| `Psalms 73-89` | Book III — Asaph, and the darkest of the five |
| `Psalms 90-106` | Book IV — *Lord, you have been our dwelling place in all generations* |
| `Psalms 107-150` | Book V — the songs of ascents, the long acrostic, and the last hallelujahs |
| `Proverbs 1-9` | the long instruction: wisdom addressed to a son, in paragraphs |
| `Proverbs 10-29` | the sentence proverbs: one verse, one thought, nine times in ten a full stop at the end of it |
| `Proverbs 30-31` | Agur, Lemuel, and the acrostic at the end |

**This is the easiest route to type, and it is measured rather than asserted.** Over the
shipped World English Bible:

| | mean verse | mean chapter | verses ending in a full stop |
|---|---|---|---|
| Proverbs 10-29 | **84** characters | 2,536 | **96%** |
| Psalms | 86 | **1,427** | 92% |
| Genesis | 121 | 3,735 | 92% |
| the whole Bible | 124 | — | — |

Two of those columns are the argument. A verse is a third shorter than the book the game
opens on, and a **chapter** is well under half the length — the median psalm is 1,133
characters against Genesis 1's 3,861, which at a beginner's speed is the difference
between a sitting that ends and a sitting that gets abandoned. The last column is why the
verse feels finished when it stops: in the sentence proverbs, nineteen verses in twenty
are a whole thought with a full stop after it, so the rail never breaks off mid-clause
and the player never has to hold half a sentence in his head while hunting for a `k`.

**It is not chosen for him.** [The first run](10-first-run.md) mentions no routes at all
and must not start; Wisdom is the first thing the menu names under
[choosing a route](#choosing-a-route), and the menu says why in the one sentence above.

### Choosing a route

Pilgrimage was simply *the* route, chosen for the player. With four, he picks — from the
**menu**, in a section of its own, exactly as [the second text](#two-texts-and-the-second-act)
is offered, and for the same reason: a choice that only exists as a dropdown of proper
nouns is a choice nobody can make, so the section says what each one is before it asks.

**Not on the first screen.** [The first run](10-first-run.md#the-shape-coach-inline-do-not-lecture)
deliberately mentions no stages, no map and no modes, and it is right about that: the man
this game is for has abandoned a typing tutor before, and four unfamiliar words and a
decision are how you lose him in the first fifteen seconds. He cannot choose between four
routes he has not seen, and a wrong choice would cost him the thing the screen exists to
give him, which is typing a real word inside a minute. So the game opens on Pilgrimage,
the menu holds the choice, and the choice is there the first time he goes looking.

**Switching moves nobody.** The route is a reading of the book, not a place in it, so
choosing another one leaves the player in the verse he was typing. If the new route does
not name his chapter the map says so plainly, which is
[the answer that already existed](#standing-off-the-route) — and it is the ordinary case
for a player who switches to Wisdom while standing in Genesis. Nothing is lost either way:
`completed` is a list of chapters and every route reads the same list, so a chapter typed
on one route is finished on all four.

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

## Chronicle: the genealogies are opt-in

Skipped by default on every route. Genesis 5 is forty lines of *"and Mahalalel lived
eight hundred and thirty years"* — miserable typing and unreadable prose for a beginner.

**Skipping is the default, not the only option.** Sixteen chapters are named, they are
genealogy end to end, and they are reachable on purpose from the menu as **Chronicle**
passages. `GENEALOGIES` in `core/route.ts` is the list; `isGenealogy` is the test every
route's itinerary is filtered through.

| | | |
|---|---|---|
| `Genesis 5` | `Genesis 10` | `Genesis 36` |
| `Numbers 1` | `Numbers 26` | `1 Chronicles 1-9` |
| `Ezra 2` | `Nehemiah 7` | |

Sixteen chapters, 776 verses, 74,497 characters — about 2% of the Bible and rather more
than 2% of the misery.

Only chapters that are genealogy **end to end** are on it. Genesis 11, Matthew 1 and
Luke 3 each open or close with something else — Babel, the nativity, the baptism — and
skipping a whole chapter to avoid the list of names inside it would cost the player the
part he came for. Partial-chapter skipping is a verse range rather than a chapter range,
and nothing in a route table speaks verses.

### Never on the way to anything

That is the whole shape of it, and it is arranged rather than promised:

- `requiredRefs` filters them out, so **no route can require one** and
  `routeComplete` is true with every one of them untyped.
- Nothing leads to one. No thread ends on a genealogy, no doorway opens into one, and no
  [follower](11-followers.md#who-joins-after-what) joins in one — there is nobody in a
  list of names who walks with you, and a figure invented for the slot is the thing that
  document refuses.
- **Finishing one offers nothing.** A genealogy is not a passage a thread leaves, so the
  strip under the rail says nothing when it ends, and the next stretch of verses is
  whatever reading onward reaches. Chronicle is a place you go, not a place you are led.
- It is **not** gated behind a wax seal or anything else. Locking it would make it
  invisible, which is exactly the failure
  [the second act](#two-texts-and-the-second-act) records about the King James.

### What you get for typing one

The same thing every other chapter gives: a **wax seal** for a perfect chapter, which
[already exists](03-pacing.md#items) and needs nothing added to it. Inventing a reward
peculiar to the genealogies would make them feel required, which is the one thing this
whole section is arranged to prevent, and it would be paying the player to do something
the game has just told him he does not have to do.

### It is not the digits, and the report card says nothing

The obvious claim about a genealogy is that it is where
[stage 9](06-curriculum.md#stages) — the numbers — finally has something to do. **It is
not, and the claim is measurable.** There are **zero digits** in either shipped
translation: 4.1 million characters of the World English Bible and 4.3 million of the
King James, and not one `0` through `9` in any of them. Every number in Scripture is
spelled out, so *"eight hundred thirty years"* is a lowercase-letter drill like anything
else. Stage 9 exists for the digits in a *citation*, which the player reads off the HUD
and never types.

What a Chronicle passage actually is, measured the same way:

| | words | begin with a capital | words per distinct word |
|---|---|---|---|
| the whole Bible | 790,697 | 13% | — |
| `Genesis 5` | 530 | 14% | **5.1** |
| `Genesis 10` | 441 | **35%** | 2.5 |
| `1 Chronicles 1` | 604 | **48%** | 2.4 |
| `Numbers 1` | 1,221 | 12% | **6.1** |

Two different miseries, and neither is arithmetic. **The name lists are a shift drill** —
in 1 Chronicles 1 nearly half of all words start with a capital, against one in eight
across the Bible, so the passage is almost entirely
[stage 8](06-curriculum.md#stages)'s two-handed shifting over letter sequences the fingers
have no habit for. **The age lists are repetition** — Genesis 5 says 530 words using 103
of them, and Numbers 1 says six words for every distinct one.

**The report card says nothing about any of this**, and that is the decision rather than
an omission. The card is a reading of [his hands](08-stats.md#the-report-card) over
everything he has ever typed, and a genealogy does not give him a different pair of hands:
the shift row will move because he shifted more, which is true, and annotating it with
*"but you were typing a genealogy"* would be the card explaining away its own numbers.
The place for the warning is **before** he types one, in the menu beside the list, where
it is a fact about the passage rather than a verdict on him.
