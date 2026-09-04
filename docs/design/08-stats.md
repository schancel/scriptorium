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

Only live characters count toward any of these. Greyed characters are not typed and must
never inflate WPM — an easy and tempting bug, since it would make early stages look
flattering.

## Live HUD

Always visible during play: hearts, chapter and verse, **WPM**, **accuracy**, combo
multiplier, and the smudge meter. Deliberately small and in the top bar — the eye belongs
on the rail, and a WPM counter next to the text would pull attention off it.

## The report card

Shown at the end of every level. This is the primary teaching surface, not a score
screen:

- WPM and accuracy for the level, against the running average
- **Per-finger breakdown** — accuracy and mean latency for every finger the game asks for
- **Worst five keys** by error rate, with what was struck instead
- New keys' progress toward the mastery gate, and what is still missing

The per-finger table is the point. A two-finger typist's card shows two rows of data and
the rest empty, which makes the problem visible in a way no amount of instruction does.
As the curriculum advances, filling in those rows becomes the visible goal.

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

A "session" is one **candle** — a few verses, not a chapter. See
[pacing](03-pacing.md#items). Recording at every candle is what makes the curve dense
enough to read within the first week, and it is also when the record is written to disk,
so a closed tab costs a verse or two rather than a chapter.

Expect the curve to *dip* when a new stage unlocks — more live characters means slower
typing — and the history view says so explicitly on the chart. An unexplained drop looks
like regression and is the single most likely reason a beginner concludes the game is not
working.

Saying it once, on the chart, is not enough on its own: the dip arrives minutes after the
promotion and the chart is not where the player is looking. So it is said **twice** —
once at the promotion itself, before the drop is felt, and again beside the marked
session in the history. The promotion notice names the coverage change that causes it
(*live characters: 46% of the text before, 61% from here*) so the number the player is
about to watch fall has a cause attached to it.

The session that opened the gate is flagged in the record (`promoted`), which is what
lets the chart mark the transition rather than infer it from a stage number changing.

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
