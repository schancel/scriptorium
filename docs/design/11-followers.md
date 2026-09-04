# Followers

**Implemented by:** `core/followers.ts`, `core/draw.ts`

## The hole this fills

Nothing accumulates. The player finishes parts, the score ticks, the history grows a
row — and the screen never shows that he has been anywhere. A route made of threads
between passages is a pilgrimage, and a pilgrimage that gathers company is the obvious
thing the game is missing.

## What they are

Finish a passage the route names and its figure joins a line walking behind the scribe.
Adam after Genesis 3. Abraham after Moriah. Moses after the bush. The shepherd after
Psalm 23. They walk when he walks, idle when he idles, and do nothing else at all.

Finding a flashback room adds its figure too — currently a secret room leaves no visible
trace once you have left it, and this is the natural one.

## They have no abilities, deliberately

Tempting, and wrong twice over.

Every mechanic here that touches difficulty is balanced against a beginner's error rate,
and getting the smudge ramp right took a measured argument and a test
([ADR 0005](../decisions/0005-smudge-meter-over-per-typo-damage.md), and the ramp
invariant in [pacing](03-pacing.md#the-ramp-must-not-outrun-the-gate)). A follower
granting an extra heart or a slower cloud reopens all of it.

Worse, it points the reward the wrong way: it would make the game *easier* the further
you get, so the player who needs help least receives it, and the beginner the game exists
for gets nothing. As a pure record it costs nothing, cannot unbalance anything, and still
does the job — the screen finally shows the journey.

## They must not compete with the rail

The rail is the point and everything else serves it
([the rail](02-rail.md)). Followers are the largest thing yet added next to it, so:

- They walk **behind** the scribe, never ahead, never above the ground line.
- The line is capped. Past the cap the earliest walk off and the count is shown instead —
  a screen filling with figures is scenery competing with text.
- No speech, no icons over heads, no numbers. They are silhouettes that walk.
- They never enter the reading band or the keyboard overlay.

## Art without ten bespoke sprites

Ten hand-drawn figures is a lot of art for something deliberately in the background, and
detail at 16×16 reads as noise anyway. Followers are drawn from a small set of body
silhouettes, recoloured from the theme palette, each carrying one distinguishing mark —
a staff, a crown, a lamb, a scroll. The mark is what the eye reads; the body is shared.

That also keeps them coherent with the scribe, who is the same size and build. They
should look like people walking with him, not like a parade of mascots.
