# 0009 — A fallback must announce itself

**Status:** accepted, 2026-09-04

## Context

Every data loader has a fallback: a hardcoded five-verse Genesis, a built-in tuning table,
an empty theme list. They exist so a first run, or a broken fetch, still yields something
playable rather than a blank screen. That is right.

They were silent, and that was not.

A deploy change moved the build under a directory one level deeper than `main.js`'s fixed
`../../../` expected. Every data fetch 404'd. The game came up, rendered, accepted typing,
and looked entirely correct — on a five-verse stub, with fallback tuning and no themes,
which meant no tunes and therefore no audio. It stayed that way for hours.

It was not caught by tests, which do not run against a deployment. It was not caught by
the deploy check, which fetched assets by paths chosen by hand rather than the paths the
application asks for. It was reported by the owner, and only as *"no sounds btw even with
it on"* — the one symptom visible from outside.

**A silent fallback is indistinguishable from working software.** That is the whole
problem: the failure mode of the safety net is that nobody learns the net was needed.

## Decision

Any fallback must be visible while it is in use.

The game paints `NOT THE REAL DATA` across the frame in the error colour, naming only the
sources that actually failed. It is pushed last in the display list so nothing can cover
it, and there is a test asserting it is the final command. Healthy data draws nothing: a
frame with no notice is byte-identical to one that never had the mechanism.

**The banner names the failure and does not prescribe a fix.** It used to carry a second
line reading ``run `make build` and `make fetch`, and serve over http (`make serve`)``,
which this ADR endorsed. That was wrong about who reads it. The owner, on finding shell
commands in the game: *"make fetch and all that build deploy stuff shouldn't be in the
game. User need not be able to do it."* He is right — the person looking at the banner is
almost always someone who has a URL and no checkout, and telling him to run a command he
cannot run converts a clear report into a puzzle about his own inadequacy. Worse, it makes
the banner read as *your installation is broken* when the far commoner cause is that ours
is.

So the second line says what is true for everybody: the game is running on built-in
substitutes, what is on the screen is not the real thing, and the data named on the first
line did not load. Whoever can act on that — us — learns exactly as much as before, because
the *names of the failed sources* were always the load-bearing half. The console warning
beside it is where a developer's detail goes, and it is unchanged. The fix belongs in
`README.md`, where someone with a checkout is already looking.

The deploy also now resolves data URLs the way `main.js` does — parsing the script src out
of the served index and walking `../../../` from it — rather than checking paths a human
picked.

## Consequences

- Degraded operation stays possible, which is the point of a fallback, but it can no
  longer masquerade as normal operation.
- The banner is ugly on purpose. A tasteful one gets ignored.
- Every future loader must register its fallback in the same list. A loader that quietly
  substitutes a default is a regression even when the default is correct.
- **The rule is not only about loaders.** It reappeared in a third costume as a *control*:
  the sound toggle reported `audio.on`, the setting, and never asked whether the browser had
  started an `AudioContext`. The owner found it the only way it can be found -- *"it says
  'on' for sound, but no sound."* The smoke harness could not have caught it, because it
  drives a stubbed `AudioContext` and a stub cannot prove a browser made a noise; so the
  control was asserting a state nobody had verified, which is this ADR's failure exactly.
  Any indicator must report the **device**, not the intent, and must say so where the player
  is already looking when the two disagree. See
  [music](../design/09-music.md#the-control-reports-the-device-not-the-setting) for the
  three states it can show and the diagnostic that goes with them.

## Alternatives rejected

**Log to the console.** Done as well, not instead. Nobody playing a game has a console
open, and the owner did not.

**Fail hard on missing data.** A blank screen for a first-time player whose text did not
download is worse than a stub with a warning, and it would make a transient network error
fatal.

**Trust the deploy check.** It had already passed on a completely broken deploy, because
it verified an assumption back to itself. A check you have not tried to defeat is a guess.
