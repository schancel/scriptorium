# 0012 — The route must not skip the events

**Status:** accepted, 2026-09-04

## Context

The Pilgrimage route is a graph of passages joined by textual echo, built to carry a
player from creation to the new creation without typing all sixty-six books. It has
nineteen nodes.

Two holes turned up within an hour of each other, both found by the owner simply playing
rather than by anything the tests could see.

**It skips the resurrection.** The route runs creation, fall, I AM, the shepherd,
forsaken, the crucifixion — and then Revelation 22. For a route built as promise and
fulfilment, the thing the whole argument turns on is absent.

**It skips Genesis 2.** It goes Genesis 1 → Genesis 3, so the garden being planted, the
man formed from the dust and the woman built are all passed over. The owner found this by
reading onward out of Genesis 1 and noticing the game had nothing for him there:
*"Weird. I'm in genesis 2 right now."*

The pattern is the same. The route was authored from its *echoes* — the places where one
passage quotes another — and echoes cluster on the famous verses. The events those verses
are about were left out.

## Decision

**John 20 joins the route**, reached by two threads from the two places the story began:

- `the first day` — Genesis 1:5 *"the first day"* → John 20:1 *"Now on the first day of
  the week, Mary Magdalene went early, while it was still dark, to the tomb."* The new
  creation opens on the first day, in the dark, exactly where Genesis opened.
- `garden` — Genesis 3, the garden where it went wrong → John 20:15, *"supposing him to
  be the gardener."*

Both phrases occur verbatim in both shipped translations, so both pass the echo check
every other edge passes. Neither was invented to justify the node.

Its follower is **Mary Magdalene**, named in the chapter's first line and the first
witness. Its scene is **tomb → garden**, changing under her as she recognises him, which
is what verse-resolution scenery was built for.

**Genesis 2 joins the route**, so the garden is a place the player can be sent rather than
somewhere he wanders into off-map.

**Followers join at an authored verse, not on finishing a chapter.** The scenery went
verse-precise; followers did not, and the mismatch shows. Adam joins at Genesis 2:7 where
he is formed, not on completing chapter 1. Eve joins at 2:24 — *"they will be one flesh"*
— which is where she becomes a wife, and where her line lands. She is not named Eve until
3:20, which is why her arrival line does not use the name.

**Finishing a passage offers the thread it leads to.** Taking a thread required opening
the map, so a player could finish Genesis 1, read onward, and never learn the map or the
threads existed. The offer names the echo — *John 1 opens by quoting this* — and is
declined by carrying on reading. It is an offer, not a fork: reading onward stays the
default and nothing is lost by ignoring it.

## Consequences

- The route reaches the resurrection, and the two threads into it come from the two
  passages the player is most likely to have already typed.
- Genesis 2 is authored scenery rather than fallback, and carries two followers.
- Follower joins become verse-precise, which is a small change to a derived party and no
  change to the progress record.
- The map stops being a screen a player might never find.

## Alternatives rejected

**Give John 19 to Mary Magdalene instead of adding a node.** She is at the cross in
John 19:25, so this is textually available and cheaper. Rejected: it puts her in the game
without putting the resurrection in it, which is fixing the smaller half of the problem
and hiding the larger.

**Fold her into the woman of John 8.** Rejected. Western tradition merged them from about
the sixth century and the text does not; John 8 names nobody and Mary Magdalene appears in
Luke 8 and John 20 as herself. A game whose whole discipline is not asserting more than the
text supports should not repeat a conflation it can simply decline.

**Offer the thread automatically, or travel it.** Rejected: reading onward is the default
and must stay the default. An offer that moves you is a fork, and the player did not ask
to leave.
