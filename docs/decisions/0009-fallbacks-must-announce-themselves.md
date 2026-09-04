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
sources that actually failed, with the command that fixes it. It is pushed last in the
display list so nothing can cover it, and there is a test asserting it is the final
command. Healthy data draws nothing: a frame with no notice is byte-identical to one that
never had the mechanism.

The deploy also now resolves data URLs the way `main.js` does — parsing the script src out
of the served index and walking `../../../` from it — rather than checking paths a human
picked.

## Consequences

- Degraded operation stays possible, which is the point of a fallback, but it can no
  longer masquerade as normal operation.
- The banner is ugly on purpose. A tasteful one gets ignored.
- Every future loader must register its fallback in the same list. A loader that quietly
  substitutes a default is a regression even when the default is correct.

## Alternatives rejected

**Log to the console.** Done as well, not instead. Nobody playing a game has a console
open, and the owner did not.

**Fail hard on missing data.** A blank screen for a first-time player who has not run
`make fetch` is worse than a stub with a warning, and it would make a transient network
error fatal.

**Trust the deploy check.** It had already passed on a completely broken deploy, because
it verified an assumption back to itself. A check you have not tried to defeat is a guess.
