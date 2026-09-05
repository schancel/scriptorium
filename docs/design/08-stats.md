# Stats and progress

**Implemented by:** `core/typing.ts`, `core/progress.ts`, `core/draw.ts`

Someone starting at 10 WPM needs to see that number move. The progress curve is most of
the motivation in the first month, and it is the part a beginner cannot feel from the
inside — day to day it all feels equally slow.

## Definitions

Standard, so the numbers are comparable with every other typing tool:

- **WPM** = (correct characters ÷ 5) ÷ minutes elapsed. The divisor is `wpm_chars_per_word`
  in [tuning](07-tuning.md) and must not be changed.
- **Accuracy** = correct keystrokes ÷ total keystrokes, counting every keypress including
  corrections.
- **Latency** = milliseconds between a character becoming current and the correct key
  being struck. The first keystroke after any pause longer than the idle threshold is
  discarded, so thinking time does not pollute the muscle-memory signal.

A character can cost more than one key — a capital is shift and a letter, struck by two
hands; see [illumination: strokes](01-illumination.md#strokes). **Every** key it costs is
credited with a hit, because every one of them was struck, and that is what gives
`<shift>` any statistics at all. The three numbers above still count *characters*: one
keypress is one keystroke and one latency sample, and the sample is attributed to the
printing key alone. Giving the modifier a copy of it would enter every capital into the
median twice and flatter the median latency of a player who shifts.

An error is recorded against the printing key, unchanged: what failed is the production
of the character, and the platform delivers a composed character or nothing — the player
cannot get the modifier wrong on its own.

### Which characters count depends on the mode

With **gilding off** — the default, and the beginner's game — only live characters count
toward any of these. Greyed characters are not typed and must never inflate WPM: an easy
and tempting bug, since it would make the early stages look flattering and the progress
curve a lie.

With **[gilding](01-illumination.md#gilding-a-mode-for-people-who-already-type) on**,
every producible character is asked for and every one of them is typed, so every one of
them counts. There is nothing left to inflate — the player really did strike those keys —
and *excluding* them would be the dishonest number, reporting a fluent typist as slower
than a beginner for typing more of the page.

The two are not comparable with each other, and nothing in the game pretends they are: the
mode is a property of the session, and a session's WPM is measured against what that
session asked for.

One thing does **not** change with the mode. A gilded character contributes **no key
statistics at all** — no hit, no error, no latency, no confusion. It is a character
*typed* rather than a character the curriculum *asked for*, and `keyStats` is the table
the [mastery gate](06-curriculum.md#the-mastery-gate) is computed from. Gilded keys are
untaught by definition, so keeping them out of that table is what makes "the gate counts
only the current stage's keys" true by construction rather than by an argument about
pruning further downstream. See
[ADR 0008](../decisions/0008-gilding-permissive-input.md#why-gilding-must-not-open-the-gate).

The cost is real and is accepted: in gilding mode at an early stage, the report card and
the earned fade-out see only the taught half of what the player typed. That is the right
trade — the card is a reading of progress through *the curriculum*, and a gilded `z` at
stage 1 is not progress through it.

## Live HUD

Always visible during play: hearts, chapter, verse and part, **WPM**, **accuracy** and the
smudge meter, plus the **score** whenever there is one to show — see
[illumination](01-illumination.md#how-it-reads-on-screen). Deliberately small and in the
top bar — the eye belongs on the rail, and a WPM counter next to the text would pull
attention off it.

The combo is **not** on it, and that is deliberate rather than missing. It is
"acknowledged, modestly" through the drop chance and the strike cue
([pacing](03-pacing.md#a-monster-is-a-word)); a multiplier in the corner would be a second
number that moves on every keystroke, competing with the rail for the one thing this
layout exists to hold still.

## The report card

Shown at the end of every part, and reachable from the menu at any time. This is
the primary teaching surface in the game, not a score screen, and the per-finger
table is the part that does the teaching:

- WPM, accuracy and median latency for the part, **against the running average**
- **Per-finger breakdown** — keystrokes, share of the work, accuracy and mean latency
  for every finger the game asks for
- **Worst five keys** by error rate, with what was struck instead
- New keys' progress toward the mastery gate, and what is still missing
- **The curve**: one bar per finished part, with the stage openings marked
- **One sentence** saying what to work on next

It flashed past and vanished for its first few months, which wasted the most
valuable screen in the program. It has to land.

### What the table can honestly say, and what it cannot

A key is credited to the finger that *should* strike it, because that is the only
finger the game knows: the browser delivers a character, never a hand. So the
table is not a record of which fingers moved, and it must never be written as
though it were. "Your right index is doing your left pinky's work" is almost
certainly true of this player and is not something this data shows; printing it
would be an invention dressed as a diagnosis, on the one screen whose whole
authority is that its numbers are his.

What the data *does* show, and shows sharply, is **mean latency per finger**. A
finger resting on its home key answers in a fraction of the time a finger being
travelled to does. A hand that never leaves home row produces nine means inside a
narrow band; a two-finger typist produces a spread, and the slowest columns are
the pinkies and ring fingers his hands never rest over. That is the same signal
the mastery gate's latency condition is built on — see
[the mastery gate](06-curriculum.md#the-mastery-gate), *slow-but-accurate is the
hunt-and-peck signature* — read per finger instead of per stage.

So the latency column is the diagnosis. A finger at or above `report_reach_ratio`
times the quickest finger's mean is marked as one being **reached for**, and it is
marked there and nowhere else, because that is the number that says so.

Two guards on the measurement, both of which only ever suppress a finding:

- A finger needs `report_finger_min_hits` keystrokes before its mean is believed.
  One slow reach for a rare key must not be allowed to libel a finger.
- **The thumb is excluded from the comparison, on both sides.** It strikes one key,
  that key is the widest target on the board, and no hand travels to it — so it is
  always the quickest column, and measuring a pinky against it would make every
  hand in the world look like it was reaching.

One skew is worth naming and is in the safe direction. A hit whose latency was
discarded for following a pause still counts as a hit, so `meanMs` is pulled
*down* for exactly the keys a player hesitates over. That can hide a slow finger.
It cannot invent one.

### An empty row says which kind of empty it is

Eight fingers with no data is the diagnosis, and it has to read as one rather than
as a table that happens to have gaps. But there are two entirely different reasons
a row can be empty, and collapsing them into the same dash is what makes a blank
table read as an accusation instead of a state of play:

- **no keys at this stage** — the curriculum has not given this finger a key yet.
  A fact about the stage. It fills itself in and nothing is being asked of him.
- **not used yet** — the stage teaches keys for this finger and not one of them has
  been struck. A fact about the player, and the only one of the two he can act on.

Those two phrases are printed in the row itself, where the numbers would be. The
first recedes; the second stays at full brightness, because it is the one row on
the card that is a finding.

The share column is a bar rather than a number, scaled to the busiest finger. No
single finger ever approaches a large fraction of all keystrokes, so a bar drawn
against the whole hand is nine short stubs that say nothing; against the busiest
one, the row lengths *are* the shape of the hand. The numbers are in the columns
beside it.

### What to work on next

One sentence, at the foot of the card, derived from the data. **One** — a card
that says four things says none of them, and he has a part to get back to. The
order is what a man can act on this evening:

1. a key he misses at or above `report_worst_key_rate`, over at least
   `report_key_min_attempts` attempts, named with what he strikes instead
2. a finger the stage has taught and he has not used
3. a finger he is reaching for, against the quickest one
4. the gate's accuracy, quoted against the standard it opens at
5. the gate's speed, likewise
6. how many more keystrokes on the new keys before the gate can be read at all
7. nothing outstanding

The key comes first because a single key is the most actionable thing on the
screen. The spread comes third rather than first because the sentence under the
table is already saying it, and the two lines should not say the same thing twice.

The gate lines quote the standard: *91%, and the stage opens at 95%*. "Not yet" is
not something a player can act on, and the card must never be reduced to it. Before
a single keystroke has landed on a new stage's keys — which is exactly where he
stands on the card following a promotion — the accuracy and speed rows are omitted
rather than printed as zeroes. Inventing a failure out of an empty table, on the
one screen whose job is to stop a promotion looking like a regression, would be
precisely backwards.

### Tone, and leaving

The reader is an adult who has typed with two fingers for years and is quietly
embarrassed about it. [The first run](10-first-run.md#tone) sets the voice and it
applies here in full: plain, adult, specific. No exclamation marks anywhere on the
card, no praise for trivia, and never a verdict where a fact will do — *you miss it
34% of the time* is something he can work with, *you are struggling with `;`* is
not.

**Enter continues, from the first frame.** Nothing on the card animates and nothing
waits. A fluent typist finishing a part a minute must be able to leave in one
keystroke; a beginner must be able to sit with it for as long as he likes. Those
are the same requirement, and a ceremony breaks both.

### Reachable on purpose

The card is also in the menu, as **Your hands**, over everything he has typed
rather than the last few verses. A history of his hands that can only be seen by
finishing something is one he cannot consult on the evening he wants to look at
it — and that is the evening the curve is worth most.

Both readings call the same functions in `core/draw.ts` over the same record, so
the card at the end of a part and the card in the menu cannot drift into
disagreeing about the same hands. The canvas one is the display list; the menu one
is DOM, for the same reason the menu is — it is prose in a window that is not
640x360.

The per-finger table is read over the **lifetime** key table, not the part just
typed. A part is a few verses — a hundred and fifty keystrokes spread across nine
fingers — and nine means built from sixteen samples each is noise presented as a
diagnosis. The header line still reports the part.

### Gilding names its own blind spot

With [gilding](01-illumination.md#gilding-a-mode-for-people-who-already-type) on the
player types more than this table can count, because a gilded character records no
key statistics at all. So the table's heading says so — *the keys your stage
teaches* — rather than reporting the taught half as though it were the whole.

There is deliberately **no second table** of gilded keystrokes to fill the gap. The
mastery gate's guarantee today is that the data the gate would need does not
exist: a gilded character reaches `keyStats` with nothing at all, so there is
nothing downstream to prune, forget to prune, or prune wrongly. A parallel
`gildStats` table would move that guarantee from *the numbers were never recorded*
to *three call sites each remembered to keep them apart* — the session result, the
merge into the record, and the trailing window — and that is a strictly weaker
guarantee than the one it replaces. Showing a fluent typist a fuller table is not
worth trading it for. See
[ADR 0008](../decisions/0008-gilding-permissive-input.md#why-gilding-must-not-open-the-gate).

### Nine rows, not ten

The table has **nine** rows: eight fingers, plus the one thumb that strikes the space
bar.

Both thumbs rest on space and either will do, so no table keyed on the *key* can name the
finger — it is a fact about the player, not about the keyboard. Attributing space to the
right thumb regardless had two costs, and both of them attacked the one thing this table
is for. The right-thumb row was inflated by a fifth of every keystroke in the game, so it
looked like a well-drilled finger when it was really just the space bar. And the
left-thumb row was permanently empty — a row of zeroes that says *you never use this
finger*, printed about a finger the game never asks for.

An empty row here is supposed to mean "you are not using this finger and you should be".
A row that can never fill teaches the player to distrust the empty rows that matter,
which is precisely the diagnosis the card exists to deliver.

So it is a **preference**, `spaceThumb`, defaulting to the right, and the card renders the
eight fingers plus the thumb actually in use. Right is the default because that is the
thumb already resting over the centre of the bar for most right-handed typists, and what
most touch-typing courses teach; a left-thumb typist changes the preference and their card
is correct rather than half empty. The preference changes the finger for `<space>` and
nothing else — not the key set, not the classification, not any other key.

## History

Every session is recorded locally: date, stage, passage, WPM, accuracy, per-key stats.
Rendered as a curve over weeks with the stage transitions marked.

The report card carries the last `report_trend_parts` of it as a small chart — one
bar per finished part, promotions in gold — with the running average beside the
part's own numbers on the line above. That is what makes the card answer the
question a beginner cannot answer from the inside: *is any of this working?* Day
to day it all feels equally slow, and twenty bars answer in a glance what no
single number can.

A "session" is one **candle** — a few verses, not a chapter. See
[pacing](03-pacing.md#items). Recording at every candle is what makes the curve dense
enough to read within the first week, and it is also when the record is written to disk,
so a closed tab costs a verse or two rather than a chapter.

Expect the curve to *dip* when a new stage unlocks — more live characters means slower
typing — and every view of the curve says so explicitly. An unexplained drop looks
like regression and is the single most likely reason a beginner concludes the game is not
working.

Saying it once is not enough on its own: the dip arrives minutes after the
promotion and the chart is not where the player is looking. So it is said **three
times**, in the three places he will actually be looking — at the promotion itself,
before the drop is felt; on the report card of the part that opened the stage,
which is the very next screen he sees; and beside the marked session in the
history whenever he goes back to it. The promotion notice names the coverage change that causes it
(*live characters: 46% of the text before, 61% from here*) so the number the player is
about to watch fall has a cause attached to it.

The session that opened the gate is flagged in the record (`promoted`), which is what
lets the chart mark the transition rather than infer it from a stage number changing.

### The mode is marked on the curve, because a mode change is not progress

Gilded and ungilded stretches shared one line with nothing separating them, and they are
not comparable. With the mode off a stage asks for the characters it has taught — 46% of
the page at stage 1 — and with it on the same verse asks for every character in it. The
WPM either side of that switch is measured over two different jobs.

The owner found out by doing it. **22 wpm to 75 in one sitting, and later 102.** On the
curve that draws a cliff, and a cliff reads as a breakthrough. It is not one: what changed
is the question, and a chart that says otherwise is lying to the one player whose whole
motivation for the first month is the shape of that line.

So **every history entry carries the mode it was typed in** (`gilding`), and the chart
draws a **rule at the boundary** — between the last bar of one run and the first bar of
the next. Three things about the mark, and each of them is a decision:

- **It is a rule, not a colour.** Gold already means *a stage opened on this bar*.
  Giving it a second meaning would make one bar say two things, and the two events are
  not alike: a promotion happens *on* a stretch, and a mode is a property of every
  stretch on one side of the line.
- **It marks the boundary, not the run.** Recolouring every gilded bar would be a second
  encoding of the same fact and would swamp the promotions. One rule says everything the
  player needs: *from here, a different question*.
- **It is never drawn at the left edge of the window.** A boundary is a disagreement
  between two neighbours, and the first bar shown has nothing to its left to disagree
  with. Marking it would claim a switch that may have happened weeks ago, or never.

And it is **said, not left to be inferred**, in the same register and the same three
places as the promotion dip: on the report card of the stretch that follows the switch,
beside the marked row in the history, and under the chart in the menu. The wording says
what changed — *the question moved, rather than your hands* — because "these numbers are
not comparable" is a fact about the chart and not something a player can act on.

**The mode is the only thing marked this way, for now.** Letting mistakes stand
([ADR 0010](../decisions/0010-mistakes-may-stand-and-be-deleted.md)) also moves WPM a
little — a repair costs the seconds it takes — but it changes how a stretch is *typed*
rather than what the stretch *asks for*, and the effect is nothing like the near-doubling
gilding produces. A second mark for a much smaller effect would make the first one
quieter. Worth revisiting if the curve ever shows a step across one.

## Resuming

The record holds a **bookmark**: translation, book, chapter and the verse to resume on.
Reopening the tab returns the player to that verse, in that passage, at that stage.

This is not a convenience. A tutor that reopens at Genesis 1:1 every time teaches the
first five verses of Genesis and nothing else, because the first five verses are the only
ones a beginner reaches in a sitting.

The bookmark comes with an exit — a menu offering another book and chapter, another
translation, this passage again, and starting over — because a saved position with no way
out is a trap, and the player who wants to leave Leviticus must not have to clear their
browser storage to do it.

History is stored in browser local storage, capped at `history_max_sessions`, and can be
exported to a file and reimported. Local storage is cleared by accident more often than
people expect, and losing three months of progress would be unrecoverable.
