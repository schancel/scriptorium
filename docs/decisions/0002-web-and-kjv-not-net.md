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
- KJV becomes a genuine difficulty axis rather than a gimmick: archaic morphology makes it
  measurably harder to type. Measured over both shipped texts, one KJV word in 29 carries an
  archaic ending or pronoun against one in 737 for WEB, it has three times the colons and
  semicolons, and its sentences run half as long again.

  This bullet originally also claimed *heavier comma density*, and that is not true of the
  texts we ship: both sit at 8.8 commas per 100 words. The claim was never measured. It is
  corrected rather than deleted because the surrounding decision rests on the difficulty
  being real, and it is — just not for that reason. The game must not assert something its
  own data does not support, and the menu copy quotes the measured figures.

- How the difficulty step is *presented* is
  [the route](../design/04-route.md#two-texts-and-the-second-act): a section of its own in
  the menu, with the reason. Two proper nouns in a dropdown present a difficulty step as a
  preference about wording.
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
