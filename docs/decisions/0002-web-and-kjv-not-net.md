# 0002 — WEB and KJV, not the NET Bible

**Status:** accepted, 2026-09-03

## Context

The game ships a Bible text and is a public repository. The NET Bible was the initial
suggestion.

## Decision

Ship the **World English Bible** (WEB) as the default and the **King James Version** (KJV)
as an unlockable hard mode. Both are public domain.

## Consequences

- No attribution requirements, no usage conditions, no permission to seek, no risk to the
  repository's licensing.
- WEB is modern English with contemporary spelling and punctuation, which suits the
  curriculum — a beginner does not need `-eth` endings while learning home row.
- KJV becomes a genuine difficulty axis rather than a gimmick: archaic morphology and
  heavier comma density make it measurably harder to type.
- Shipping two translations means [warp echo phrases](../design/04-route.md#edges) must be
  verified against both, since wording differs. This is checked.

## Alternatives rejected

**NET Bible.** Copyrighted by Biblical Studies Press. Its free-use policy is generous but
conditional — attribution requirements and limits on commercial and derivative use — and
it is not public domain. For a public repository shipping the full text inside a
distributed application, conditional permission is the wrong foundation.

**ASV 1901.** Public domain and perfectly usable, but sits stylistically between WEB and
KJV without being clearly better than either at what they are for. Available to add later
at no architectural cost.
