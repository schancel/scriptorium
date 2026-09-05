# The first run

**Implemented by:** `core/onboarding.ts`, `platform/web/overlay.ts`

## Who is opening this

An adult who is good at his job and types with two fingers. He knows he types
badly. He has probably been quietly embarrassed about it for years, and has
probably abandoned a typing tutor before.

That is the whole brief. Everything below follows from not making him feel like a child
and not making him read anything before he gets to type.

## What he currently sees

Genesis 1, a keyboard overlay, and roughly half the letters dimmed, with no explanation of
any of it. Nothing says why the dim letters skip themselves, what the little bar under a
space is, that a wrong key simply will not advance, or where to put his hands. The game
assumes someone has already explained it. Nobody has.

## The shape: coach inline, do not lecture

**No tutorial wall.** Four modal screens of explanation before typing is how you lose
someone who is already unsure. He should be typing real words inside fifteen seconds.

One short opening screen, then **just-in-time notes** that appear the first time a thing
actually happens and never again.

### 1. The opening screen — one idea only

Find home row by feel.

> Your keyboard has two small bumps, on **F** and **J**.
> Find them without looking. That is how your hands know where they are —
> every other key is counted from those two.
>
> Rest your left fingers on **A S D F** and your right on **J K L ;**
>
> [ I've found them ]

The bumps are the single most useful thing nobody tells self-taught typists, it is true of
every keyboard he will ever touch, and it can be done in five seconds without reading a
paragraph. One button. No progress dots, no "step 1 of 4".

### 2. Then straight into typing, with three notes that fire once each

Each appears under the rail, the first time the thing occurs, and is dismissed by
continuing to type. Each is one sentence.

| Fires when | Says |
|---|---|
| The first dim letter is reached | *These dim letters aren't yours yet. The game types them for you — just keep going.* |
| The first wrong key is pressed | *A wrong key doesn't move you along. Try again; nothing is lost.* |
| The first space is reached | *The bar means a space. Either thumb.* |

Then it is quiet, permanently.

### 3. What is deliberately not said

Not on the first run: stages, the mastery gate, gilding, combos, score, the map, hearts,
the smudge meter, the blot-cloud. All of it is either discoverable or genuinely does not
matter in the first two minutes. **The cloud in particular explains itself** the first time
it drifts in, and a warning about it beforehand would read as a threat to someone who is
already braced for one.

## Tone

Plain, adult, and specific. It never praises him for typing a letter and never says "great
job". Overpraise for trivial things is what makes educational software feel like it is for
children, and he will notice immediately.

It also never mentions speed. He is slow, he knows he is slow, and the game's whole
argument is that slow is fine right now.

### The exclamation ban is about praise, and only covers copy that judges him

The rule above used to be enforced as *no exclamation mark anywhere*, on every string a
player could read. That was a proxy. "No praise" is hard to test and "no `!`" is trivial,
so the trivial one got written down and quietly grew into a house style it was never meant
to be.

It overreached, and the owner found the edge of it: he wanted a party member to arrive with
some energy. **A follower joining is the world doing something. It is not a verdict on
him**, and there is no way for it to condescend, because it is not about him at all.

So the copy splits in two, and the two halves are held to different rules.

| | What is in it | The rule |
|---|---|---|
| **Copy that evaluates the player** | the report card's note and its one piece of advice, the three coaching notes and the opening screen, the promotion panel and the stage descriptions it leads with | no exclamation mark, no praise for trivia, no verdict where a fact would do |
| **Copy about the world** | a follower arriving, the [thread a finished passage offers](04-route.md#finishing-a-passage-offers-the-thread-it-leads-to), the menu, the map, the doorway, the scenery, the error lines | ordinary punctuation; still no praise for trivia, still no private vocabulary |

Both halves keep the no-praise rule and the jargon rule. The only thing that narrows is the
punctuation, on the half where punctuation was never the point.

The line between them is *who the sentence is about*. "You miss the `j` key 34% of the time"
is about him and stays deadpan for ever. "Moses walks with you" is about Moses. If a
sentence in the world half ever starts congratulating him, it has moved to the other half
and the no-praise rule catches it there.

**And the evaluative half is tested with teeth.** `core/copy.test.ts` gathers the two
corpora separately and runs the exclamation ban over the evaluative one alone, so injecting
a congratulatory line into `reportNote` still fails the suite. A test that had been widened
until nothing could trip it would be worse than no test.

### The tone is the game's, not this screen's

Everything above governs every surface: the HUD, the report card and its one sentence, the
menu, the map, the promotion, the gilding offer, the doorway prompt and every error
message. [Stats](08-stats.md#tone-and-leaving) says as much of the card in its own words.

Two tests hold the whole of it to the rule rather than leaving it to a reading.

- `core/copy.test.ts` gathers the copy that can be gathered -- the opening screen and the
  three notes, every sentence `reportNote` and `reportAdvice` can produce, the stage
  descriptions from [the curriculum](06-curriculum.md#stages), the lines a
  [follower](11-followers.md#arriving-with-a-line) arrives with, every sentence the
  [thread offer](04-route.md#finishing-a-passage-offers-the-thread-it-leads-to) can
  produce over the whole graph, and `index.html` stripped to its visible prose. It sorts
  them into the two corpora above, bans the exclamation mark on the evaluative one, and
  asserts over *both* that there is no praise for trivia, no
  verdict where a fact would do, and no word that names a thing in the source tree and
  nothing on his screen. `candle` in the HUD is the precedent for that last rule, and
  `part` is the second one; see
  [pacing](03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing).
- `tools/smoke.mjs` sweeps the same rules over what a *running* game draws and renders,
  because the panels' copy is assembled in `platform/web/overlay.ts` at the moment of
  showing and exists nowhere a static reader can find it. It bans the exclamation mark on
  the evaluative panels by name, and elsewhere allows only the lines the roster itself
  produces -- so a stray `!` anywhere else is still a failure.

Neither test pins a sentence. A word count or a fixed vocabulary would make every future
edit a test edit, and the point is to keep the voice, not to freeze the wording.

## Once only, and gone

A `firstRun` field on the progress record, set false the moment the opening screen is
dismissed; each note carries its own seen-flag. They must never reappear — a tip that
returns after you have understood it is an insult. Both survive a reload, so this needs a
record migration rather than session state.

That is schema **version 4**: `firstRun` and `notesSeen`, and a migration that carries
every version 3 field across untouched. Both new fields default to *already done* for a
stored record, which is the only correct default — a record that exists is a record
somebody has been playing, and starting to explain the game to a player three weeks in
would be worse than never having explained it. See
[data schemas](../architecture/data-schemas.md#progress).

There must also be a way to see it again on purpose, from the menu, for someone who skipped
it or lends the game to a friend. It re-arms the notes as well as the screen: the friend
has not met a dim letter either.

## How it is wired

`core/onboarding.ts` holds the wording and one function. `stepCoach` takes an *occasion* —
three booleans read off the rail after a keystroke, saying whether the cursor was carried
over a dim character, whether the key was wrong, and whether the cursor is now resting on
a space that is still owed — and returns which note, if any, is on screen.

Three properties fall out of that shape and all three are asserted rather than intended:

- **The coach cannot touch the game.** It is handed no cursor and no key statistics and
  returns none, so a first run and a second run through the same verse produce identical
  numbers. A note is a sentence and nothing else.
- **A note is spent when it is shown**, not when it is dismissed, and the platform writes
  that to the record immediately. Reading a note and closing the tab counts as having
  been told.
- **Only one note is ever up.** The others are not queued behind it; they fire the next
  time their own occasion comes round, which for all three is within a line or two.
  Queueing them would be the tutorial wall arriving late.

Dismissal is `first_run_note_keys` correct keystrokes — [tuning](07-tuning.md). A count
of keystrokes rather than a duration, because "dismissed by continuing to type" is the
rule: a clock would take the sentence away from the one player who stopped to read it.

The note is drawn on the canvas, in a strip immediately under the rail, in the band's own
colour and the interface palette's ordinary text. Never gold — gold is how the game says
*press this key next*, and a remark that borrowed it would compete with the one thing on
screen the player has to act on. The strip's space is reserved in the layout whether a
note is present or not, so nothing jumps when the game speaks; a layout that moved would
pull the eye off the focal point, which is the one thing the rail exists to hold still.
