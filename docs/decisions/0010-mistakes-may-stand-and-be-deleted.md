# 0010 — Mistakes may stand, and be deleted

**Status:** accepted, 2026-09-04

## Context

A wrong key does not advance the cursor. The player must produce the correct letter
before anything moves. This is standard in typing tutors, it makes an error
unmissable, and it stops a beginner drifting out of sync with the text he is copying.
The first run says so plainly: *"A wrong key doesn't move you along. Try again; nothing
is lost."*

It also has no analogue in real typing, and the owner — who types around 140 WPM —
found that out by playing:

> "I found I was getting hung up trying to type the correct letter when I made a
> mistake because I was trying to correct the letter I had typed automatically."

Everywhere else a keyboard is used, a wrong letter *appears* and is removed with
backspace. For a fluent typist that repair is not a decision, it is a reflex: the hand
fires backspace before the mind has finished noticing. Blocking gives that reflex
nothing to act on. The player is not failing to correct the error — he is trying to
execute a correction the game has made impossible, and the game reads his repair
attempt as a second mistake.

This is the same shape as [ADR 0008](0008-gilding-permissive-input.md): a scaffold that
helps someone with no habits actively fights someone whose habits are already good.

## Decision

A second mode, **off by default**, in which a wrong key *stands*.

- The typed character is shown in the cell where the expected one was, marked wrong, so
  the page shows what he actually typed. That is what makes backspace meaningful — there
  is now something on screen to delete.
- The cursor advances, so typing continues at the pace the hands set.
- **Backspace removes the last typed character** and returns the cursor to it, exactly
  as it would in a text field.
- Accuracy counts every keypress as it already does, so nothing is hidden by letting the
  mistake stand.

Default remains blocking. For the player this game is built for, blocking is the right
behaviour and the first-run note stays true.

## It is its own setting, not part of gilding

The two serve the same population and are separate axes. Typing every letter and
correcting your own mistakes are different requests, and someone may reasonably want the
second without the first. They sit next to each other in the menu so whoever wants one
finds the other, and the gilding offer mentions it — but neither turns the other on.
**Offer, never impose**, as 0008 established.

## Dim letters are not a complication

With illumination on the cursor skips runs of untaught letters, which made "advance past
a wrong letter" sound ambiguous. It is not. The wrong character occupies the expected
character's cell; the cursor then advances and skips the dim run exactly as it always
does; backspace walks back over that run symmetrically. The behaviour is well defined in
both modes, which is why this does not need welding to gilding.

## Consequences

- A fluent typist's hands work. That is the entire point.
- The rail must not drift: a wrong character occupies one cell, like the character it
  replaced, so the reading column is unaffected.
- Backspace must be reachable — it is currently swallowed as a non-curriculum key.
- The mastery gate is untouched. It measures accuracy and latency on the stage's keys,
  and letting a mistake stand changes neither.

## Alternatives rejected

**Make it the default for everyone.** Rejected: a beginner who does not yet know where
keys are can type a whole wrong word without noticing and lose his place in the text.
Blocking is a real service to him, and the game is his first.

**Fold it into gilding.** Rejected above — same population, different axes.

**Detect fluency and switch automatically.** Rejected for the reason 0008 gives: silently
removing a scaffold from someone having a good day is worse than never offering it.
