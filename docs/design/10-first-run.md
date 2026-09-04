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

Plain, adult, and specific. It never praises him for typing a letter, never uses an
exclamation mark, and never says "great job". Overpraise for trivial things is what makes
educational software feel like it is for children, and he will notice immediately.

It also never mentions speed. He is slow, he knows he is slow, and the game's whole
argument is that slow is fine right now.

## Once only, and gone

A `firstRun` field on the progress record, set false the moment the opening screen is
dismissed; each note carries its own seen-flag. They must never reappear — a tip that
returns after you have understood it is an insult. Both survive a reload, so this needs a
record migration rather than session state.

There must also be a way to see it again on purpose, from the menu, for someone who skipped
it or lends the game to a friend.
