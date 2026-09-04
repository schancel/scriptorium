# 0008 — Gilding: an explicit mode, not inferred intent

**Status:** accepted, 2026-09-03

## Context

[Illumination](../design/01-illumination.md) withholds untaught letters so a beginner has
nothing to hunt for. That is right for the player this game is built for.

It is wrong for a fluent typist, and the owner — who types around 140 WPM — reported why:

> "it's somewhat more difficult to omit letters of words for me"

At that speed you do not type letters, you type words. The motor program for a familiar
word fires as a single unit. Being asked to omit a letter mid-word does not remove work,
it *adds* work: you must suppress an automatic action and re-plan the word. Illumination
is a scaffold for a beginner and an obstacle for someone who has already arrived.

The original model treated greyed characters as the game's business, not the player's —
auto-advanced, untypeable, invisible to scoring. That made the fluent case unplayable at
any stage below the last.

## The design that did not survive

The first version made greyed characters *optionally* typeable: type the next live
character and the greyed run skips as usual, or type the greyed character under the
cursor and gild it. Both accepted, neither required, and a wrong guess at a greyed
character would cost nothing.

The owner asked the question that kills it:

> "How will you know it's a guess rather than the wrong letter for the actual next
> home row key?"

You cannot. The cursor sits before a greyed `e`; the next live character is `a`; the
player types `w`. That is either a fumbled gild of the `e` or a fumbled attempt at the
`a`, and the keystroke is identical either way.

Both escapes are worse than the problem:

- **Charge nothing** whenever a greyed run is pending, and a beginner gets a free pass on
  errors across most of the text — 54% of it at stage 1 — which destroys the accuracy
  signal precisely where the game is trying to build it.
- **Charge everything**, and attempting to gild an untaught key is dangerous, which
  discourages the exact behaviour the feature exists to reward.

Inferring intent from *which* key was struck — free if that key is itself untaught — fails
too: typing errors land on adjacent keys, and at stage 1 home row's neighbours (`q w e`,
`z x c`) are mostly untaught, so most genuine beginner typos would go uncharged.

## Decision

**Gilding is an explicit mode**, off by default and remembered per player.

- **Off** (the default): exactly today's behaviour. Greyed characters auto-advance and
  cannot be typed.
- **On**: every character is required. Nothing auto-advances, so there is no ambiguity
  left to resolve — a wrong key is unambiguously an error against a known target and is
  charged normally.

Characters outside the current stage that are typed correctly in this mode are *gilded*:
they score, and a part completed with every character earns a fully illuminated page and
gold leaf.

**The mastery gate counts only taught keys, in both modes.** See below.

The game may *offer* the mode on sustained high WPM. Offer, never impose: a player
choosing their own difficulty is the point, and silently switching a scaffold off under
someone having a good day is exactly the failure to avoid.

## Consequences

- The beginner is unaffected. The mode is off, greyed runs skip as they always did, and
  no new rule needs explaining.
- The fluent typist turns it on once and types normally at any stage.
- No keystroke's meaning depends on guessing what the player intended, which is the
  property that makes the error accounting honest.
- There is now a reason for a strong typist to play an early stage at all — gilding a page
  completely is a harder and more interesting target than typing 46% of it.
- Scoring separates two quantities that used to be one: characters *asked for* (which
  drive WPM and the gate) and characters *typed* (which drive gilding). Both are reported.
- Two code paths through the same passage, which is real cost -- but the alternative was
  a single path whose error accounting could not be defended.

## Why gilding must not open the gate

Tempting, and wrong. The gate certifies that a player has learned *the keys of that
stage*. Gilded keys are by definition keys the curriculum has not taught yet, so counting
them would promote someone through a curriculum they never did and make the stage numbers
mean nothing — including for the beginner the game exists for, who would then be compared
against a scale that no longer measures what it claims.

A fluent typist who wants to skip ahead should say so directly: the menu sets the stage.
That is honest, and it is one control rather than a hidden side effect.

## Alternatives rejected

**Just play stage 9, where everything is live.** Loses the curriculum's structure and
gives a strong typist no reason to see the early stages at all. Gilding keeps the stage's
teaching intact -- the gate still measures only that stage's keys -- while letting the
page be typed in full.

**Switching automatically once the player proves they can type it.** Adaptive, and it
would turn the scaffold off under someone having a good day. Offer; do not impose.

**Inferring intent per keystroke.** The design this ADR replaces. Unimplementable, for
the reason above.
