# Stats and progress

**Implemented by:** `core/typing.ts`, `core/progress.ts`

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
- **Per-finger breakdown** — accuracy and mean latency for all ten fingers
- **Worst five keys** by error rate, with what was struck instead
- New keys' progress toward the mastery gate, and what is still missing

The per-finger table is the point. A two-finger typist's card shows two columns of data
and eight empty ones, which makes the problem visible in a way no amount of instruction
does. As the curriculum advances, filling in those columns becomes the visible goal.

## History

Every session is recorded locally: date, stage, passage, WPM, accuracy, per-key stats.
Rendered as a curve over weeks with the stage transitions marked.

Expect the curve to *dip* when a new stage unlocks — more live characters means slower
typing — and the history view says so explicitly on the chart. An unexplained drop looks
like regression and is the single most likely reason a beginner concludes the game is not
working.

History is stored in browser local storage, capped at `history_max_sessions`, and can be
exported to a file and reimported. Local storage is cleared by accident more often than
people expect, and losing three months of progress would be unrecoverable.
