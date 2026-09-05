# Outstanding

Decisions waiting on Shammah, and work not yet done. Kept here rather than in a
session, because a backlog that lives in a conversation is a backlog nobody can
find. Design *decisions* live in `docs/decisions/`; this is what is still open.

## Decisions waiting on you

Each is a judgement about the player, not about the code, so none were decided
alone.

1. ~~**Where you take a thread.**~~ *Decided, specified and now built.* See
   *finishing a passage offers the thread it leads to* below.
2. **The doorway key is Tab, and so is taking a thread.** Nothing in the docs named
   one. Tab was free and is not a curriculum key -- and the offer at the end of a
   passage now shares it, because both are "step through the thing the strip is
   naming" and only ever one of them is named at a time. Two keys for one gesture
   would be worse, and a second key nobody has met would be worse still. Worth a look
   on the screen: it is the first time Tab means two things.
   → `docs/design/04-route.md#finishing-a-passage-offers-the-thread-it-leads-to`
3. ~~**Reading mode cannot slow down**~~ *Fixed.* Down and up set the pace from inside
   the mode, named under the rail beside the way out. The old behaviour was defended as
   "coming down is a decision you make", and a decision the player has no way to express
   is not one. See *reading mode is RSVP* below.
4. **The report card leads with your worst key**, so for a beginner with any key
   above 12% error that dominates for weeks and the deeper "you are reaching for
   that key" finding only ever appears in the note beneath. Swapping the order is
   two lines.
5. **The music does not follow the scenery inside a chapter.** Genesis 1 now changes
   world six times as you type it, and the hymn does not change with it: a theme owns
   a tune and a tune restarts when the theme does, so following the picture would cut
   the hymn off mid-phrase six times in one chapter. So the picture resolves per verse
   and the music per chapter. Written down in
   `docs/design/05-scenery-warps.md#verse-ranges`; it is a judgement about what the
   room should sound like while it changes, and worth hearing before it is settled.
6. **How fast the world should turn.** `scene_blend_verses` is 2 — the colour eases
   across a window one verse either side of the boundary. At 0 the world changes
   between one verse and the next; much above 3 and Genesis 1 is one long crossfade
   with no places in it. Two was chosen on the argument, not on the screen.
7. **Who joins after John 8.** *Genesis is settled* — Genesis 2 hands over both, Adam
   at 2:7 and Eve at 2:24, after the owner's "Adam was created first"; Genesis 1 and
   Genesis 3 hand over nobody at all. The reasoning is beside the table in
   `docs/design/11-followers.md#who-genesis-hands-over`. Still open: *John 8* hands over
   **the woman he did not condemn**, carrying the stone that was put down. It is the
   memorable image of the chapter and it is faithful, but it is the only figure in the
   line whose passage is about her rather than about what she carried. One row in a
   table.
8. **Genesis 1 keeps its chapter row.** `Genesis 1 | daybreak | light_from_dark` still
   sits under the seven verse rows as the default, so a *warp* into Genesis 1 arrives on
   the daybreak rather than on the void, and only the level itself resolves finely. It
   is the documented behaviour — a chapter citation is a question about the chapter —
   but the first frame of a crossing into verse 1 is arguably the void's.
9. **The epistles are open country too.** The Bible's default is `hills`, which is right
   for the narrative books, the histories, the psalms and Acts and was judged against all
   of them. Romans and Hebrews are not places at all — they are letters, read indoors —
   and they now stand in a field like everything else. One default cannot be right for
   both, and the alternative is a second row keyed to a span of books, which is a
   mechanism this table does not have. Left as it is deliberately; say if the letters
   want the cloister back.
   → `docs/design/05-scenery-warps.md#the-default-is-a-property-of-the-text-and-the-bibles-is-open-country`
10. **How still "frozen" should be.** `reduced_parallax` is 0, so in reduced motion the
    scenery layers do not move at all and only the monsters, candles and the scribe's own
    walk say the world is going anywhere. The ADR allows "frozen or near-frozen" and the
    near-frozen version is one number: raise it to about 0.1 and the far layer creeps.
    Frozen was chosen because the layers are the strongest half of the stimulus, but it is
    a judgement about how the world reads, and it should be looked at rather than argued.
    → `docs/design/07-tuning.md`, `docs/design/12-motion-and-comfort.md#what-reduced-motion-changes`
11. **The reduced ribbon steps a cell, not a word.** The instruction was "a word at a
    time"; the fixed reading column makes that impossible for the *ribbon*, because there
    is exactly one offset per cursor index and a word-sized step would leave the caret over
    the wrong character for the keystrokes in between. So the ribbon steps a cell and the
    *world* steps a word, which is where the word was always the unit. Written up in
    `docs/design/12-motion-and-comfort.md#a-word-at-a-time-and-what-the-fixed-column-does-to-that`.
    Worth a look on the screen: it is discrete either way, and the only question is whether
    a 12px jump per keystroke reads as calm or as busy.
12. ~~**Reading mode in reduced motion is a stutter.**~~ *Gone, along with the scroll it
    was a stutter of.* Reading is RSVP now: one word at a time, held still. There is no
    motion in it to reduce, so there is no reduced-motion branch in it and there must not
    be one — a special case that does nothing reads as a decision somebody made. The mode
    went from the strongest motion stimulus in the game to the weakest thing in it.
    → `docs/design/12-motion-and-comfort.md#reading-mode-has-nothing-left-to-reduce`
13. **Genesis 3:24 keeps the garden theme.** Being driven out is the one verse of the
    chapter that travels, and it could equally have cut to `desert` for its last verse --
    the ground he was taken from, and the palette easing out of the green over the final
    two verses. It stays `garden` because a theme change on a single closing verse is a
    bigger claim than the staging licence covers, and because the flourish already says it.
    One cell in a table if you want the other reading.
    → `docs/design/05-scenery-warps.md#genesis-3-authored-as-the-chapter-it-is`
14. **`hills` and `desert` share a hymn.** `cwm-rhondda` is *"pilgrim through this barren
    land"*, this route is a pilgrimage, and country and wilderness are the same road under
    different weather — so walking out of Judah into the wilderness does not restart the
    music. It also means the tune the player hears most has no tune of its own. The fix is
    a new hand-authored tune file, not a table edit.
    → `docs/design/05-scenery-warps.md#why-hills-and-not-a-fourth-kind-of-desert`
15. **Eve keeps the fruit, one chapter early.** She joins at Genesis 2:24 now and the fruit is
    Genesis 3's image. It stays because a mark names the *person* rather than the verse
    they arrived on, because it is the one round shape in a set of uprights, and because
    Genesis 3 hands over nobody — so a mark tied to the chapter would have left the game
    altogether. One cell if you disagree.
    → `docs/design/11-followers.md#who-joins-after-what`
16. **John 20:19-31 is the abbey.** The chapter is authored `tomb → garden → abbey`: the
    last third is evening, indoors, with the doors shut, and the abbey is what that theme
    is a picture of. It is also the first row in the table that has ever *meant* the abbey
    rather than fallen back to it, so it is worth looking at once on the screen.
    → `docs/design/05-scenery-warps.md#john-20-a-tomb-that-becomes-a-garden`
17. **Should letting mistakes stand be marked on the curve too?** Gilding is marked now,
    because it changes what the page *asks for* and the step across it is nearly a
    doubling. Letting mistakes stand changes how a stretch is *typed* -- a repair costs
    the seconds it takes -- and the effect on WPM is much smaller. A second mark for a
    much smaller effect would make the first one quieter, so it is not marked. Worth
    revisiting the first time the curve shows a step across one.
    → `docs/design/08-stats.md#the-mode-is-marked-on-the-curve-because-a-mode-change-is-not-progress`
18. **The earned fade-out reads a lifetime, not the stretch in front of you.** The
   key-removal half of this is fixed — the owner asked why keys were missing from the
   keyboard, and a board with holes violated the layout invariant in
   `docs/design/06-curriculum.md`. Every key is drawn now and the board recedes instead.
   What remains open is the other half: mastery is judged over the lifetime table rather
   than the current stretch, because judged over a stretch almost nothing ever retired and
   what did came back at the top of the next one. That is the right reading of "the crutch
   removes itself as it is earned", but it means a returning player's board looks
   different from how he left it. Worth one look.


19. **The lectern has not been seen.** Every rule about it is asserted -- below the rail,
    never gold, nothing said, nothing moving without a keystroke, the page filling as the
    stretch is copied -- and none of that is a claim that it *looks* like a man at a desk.
    It is drawn from rects at band scale rather than from the 16px sprite, which is the
    only way to fill 130 px of band, and the composition is a guess made without a screen.
    → `docs/design/02-rail.md#how-it-arrives-and-how-it-is-drawn`

## Agreed, specified, not yet built

Nothing. Both items that stood here came out of the owner playing it, and both are in
the section below. The heading stays because it is where the next one goes.

## Built since the last pass

- **Finishing a passage offers the thread it leads to.** Taking a thread required
  opening a screen a player has to go looking for, so the best idea in the game was
  optional in the worst way: finish Genesis 1, read straight on into Genesis 2, and never
  learn that the route or the threads existed. One sentence in the strip under the rail
  names it now, in the doorway's own shape -- the key, where it goes, and the route's own
  note about the echo:
  *tab: a thread to John 1 · John opens by quoting Genesis word for word · or read on*.
  **It is an offer and not a fork.** Reading onward is the default, the next stretch of
  verses is already on the rail underneath the sentence, and typing is the declining --
  nothing to dismiss, nothing recorded, nothing taken, and the thread still on the route
  screen afterwards. **Genesis 1 has three threads leaving it and exactly one is named**,
  because three in one line is a menu: the thread that lands where reading on already
  lands is skipped outright (Genesis 1 → Genesis 2 is a description of the default, not an
  offer), the route table's order picks between what is left, and the rest are counted --
  *· 2 more on the route*. **It is silent on a passage already travelled from**: if any
  passage a thread out of here leads to is finished, nothing is said, because a signpost
  to somewhere you have been is not a signpost. All of it is derived from `completed`, so
  there is no field, no schema bump and nothing that can disagree with the route screen.
  **Tab takes it**, and only while it is the sentence on screen, so the key always does
  the thing the player can read.
  → `docs/design/04-route.md#finishing-a-passage-offers-the-thread-it-leads-to`
- **Followers join at an authored verse, and Genesis 1 hands over nobody.** The scenery
  went verse-precise and the roster did not: Adam used to arrive for finishing Genesis 1,
  four hundred keystrokes and a report card away from Genesis 2:7, where the man is
  actually formed. The table has a `verse` column now, blank for the eighteen rows that
  are about a whole chapter and filled for the two that are about a moment -- **Adam at
  2:7 and Eve at 2:24**, *"they will be one flesh"*, which is where a wife is acquired and
  why her line does not use a name she is not given until 3:20. **Genesis 1 hands over
  nobody**, which is the honest reading of it: it says *male and female he created them*
  about mankind, and the man is formed in the next chapter. It joins Genesis 3, and *at
  most one figure per node* became *at most one per arrival* -- Genesis 2 holds two rows,
  and what the check refuses is two figures arriving on the same keystroke, because there
  is one strip under the rail and one sentence fits in it. **The party is still derived**
  and the record is untouched: a row with a verse joins when the passage is finished *or*
  when the player is standing in it at or past that verse, and where he is standing is a
  fact the scenery has read every frame since it went verse-precise. The price is written
  down rather than worked around -- walk out of Genesis 2 before finishing it and the pair
  walk out with you, exactly as the route screen leaves the chapter unfinished.
  → `docs/design/11-followers.md#they-join-at-a-verse-not-at-the-end-of-a-chapter`
- **Mistakes may stand, and be deleted.** A second setting, off by default, under
  *When you hit the wrong key*: the letter he actually typed stands in the cell the right
  one wanted, marked wrong, the cursor moves on, and **backspace takes it back and steps
  onto it again**. Backspace was reaching the input handler and being dropped on the
  floor; it is let through now, and `deleteBack` does nothing at all with the mode off,
  so the beginner's game and the first run's *"a wrong key doesn't move you along"* are
  untouched. Accuracy counts every keypress either way -- `keystrokes`, `correct` and
  `keyStats` never unwind -- and a new `deleted` keeps WPM a count of the *page* rather
  than of the attempts made on it, so backspacing over four letters and retyping them
  cannot credit eight. It is its own setting and not part of gilding; they sit next to
  each other in the menu and the gilding offer names the other one.
  → `docs/decisions/0010-mistakes-may-stand-and-be-deleted.md`
- **A monster is felled by a clean word, not by any word.** A word with a mistake standing
  in it leaves the monster where it is and the scribe walks past. There is no else branch:
  nothing blocks, nothing chases, nothing is charged and nothing is said, because what he
  loses is a reward he did not earn. Every mode. **And the owner's ruling is in the doc:**
  a word repaired with backspace *still fells it*, because the WPM lost while repairing is
  penalty enough. That makes one rule for both modes -- a monster falls when no mistake
  stands anywhere in its word -- since blocking has no way to take a mistake back and the
  standing mode does. The smoke harness types the same opening of the same chapter three
  times, clean, fumbled and repaired, and counts the blows.
  → `docs/design/03-pacing.md#a-monster-is-felled-by-a-clean-word-not-by-any-word`
- **The camera no longer eats the leap.** Measured off the running game at about 190 WPM:
  the blow crossed **29 px of its 36**, because the world takes a stride out from under a
  460 ms hop and the monster's column is the camera's to decide. It crosses **42 px** now
  -- the reach plus the few pixels the camera was behind its own target when the blow
  landed, held rather than spent. `core/motion.ts` gained `deferredWords`, which returns
  the *smaller* of the true travelled-word count and where the world stood when the strike
  began: so it can hold the camera still and has no way to move it, the target is still a
  pure function of completed words, and stopping mid-blow leaves the world exactly where
  the blow left it. The smoke harness asserts the parallax does not shift on any frame
  with a blow in the air. → `docs/design/03-pacing.md#the-camera-must-not-eat-the-leap`
- **The mode is marked on the progress curve.** Every history entry carries the mode it
  was typed in, and the chart draws a rule at the boundary between two stretches that
  disagree -- a rule and not a colour, because gold already means *a stage opened here*
  and the mode is a property of every bar on one side of the line, not an event. It is
  said as well as drawn, in the promotion dip's own register and in the same three places.
  The record is at version 8; every version 7 field is carried across and both new fields
  default to false, which is what an unmarked stretch honestly means. The owner went 22 →
  75 → 102 across those switches without typing any faster, and the curve said
  breakthrough. → `docs/design/08-stats.md#the-mode-is-marked-on-the-curve-because-a-mode-change-is-not-progress`
- **The scribe at his lectern.** The keyboard band is a scaffold, and a key that has
  earned its fade-out is no longer *drawn* rather than merely no longer highlighted --
  judged over the lifetime table, because a stretch of verses is fewer than
  `mastery_min_samples` on most fingers and a key retired months ago used to come back at
  the top of every stretch. What is behind the board is the scribe at his lectern, drawn
  first so the picture is uncovered a key at a time rather than introduced at a threshold:
  quill pivoting as he writes across the line, a line of the page inked per line of copy,
  and the page sized to the stretch so its last character is the part's. It is below the
  rail by construction, it is never gold, nothing announces it, and every shape in it is a
  function of the cursor -- an hour of frames with nobody typing leaves the quill on the
  pixel it was drawn on. He is built from rects rather than the 16px sprite because the
  band is 130 tall, and he is the same scribe because he is the same art roles, resolved
  through the world he is walking in.
  → `docs/design/02-rail.md#the-scribe-at-his-lectern`

- **The Bible's default is open country, not a stone cloister.** Measured: **1,159 of
  1,189 chapters -- 97.5% -- resolved to `abbey`**, and 57 of the 66 books had no
  authored row at all. The owner found it by reading on out of Genesis 1 and asking why
  Genesis 4 was *"a dungeon instead of a barren land"*. It was not an oversight in
  Genesis 4; it was the rule everywhere the route does not go, and the route is the 2.5%
  every test walked. The fallback is now a **per-text row** in its own generated table:
  the Bible takes `hills` -- dry grass and olive under a wide sky, a ridge of two unequal
  crests behind and scattered scrub between -- and a text with no row, or no scene file at
  all, still takes `abbey`, so an imported Gutenberg book is untouched. 1,158 chapters
  moved; `abbey` is now three authored chapters and one authored stretch of John 20, which
  is what it should always have been: a place you are *in* when the text says so.
  → `docs/design/05-scenery-warps.md#the-default-is-a-property-of-the-text-and-the-bibles-is-open-country`
- **Genesis 4, authored as it moves.** Three beats, in the owner's own order: the field
  where the offerings are brought (`hills`), the ground that will not yield after it has
  opened its mouth for his brother's blood (`desert`, and *held* -- nobody travels while
  *"where is Abel your brother?"* is being asked), and Nod, east of Eden, where the world
  scrolls again. The boundary is verse 11 and not verse 8: the killing happens in a field
  and the field is still country, and what turns the ground is the sentence passed on it,
  so the land bleaches under the player as he types the reason it does.
  → `docs/design/05-scenery-warps.md#genesis-4-which-is-where-the-default-earns-itself`
- **The route reaches the resurrection, and stops stepping over Genesis 2.** Three new
  progression threads, every phrase verbatim in both shipped translations: `every living
  creature` (Genesis 1 → Genesis 2, made in the first telling and named by the man in the
  second), `the first day` (Genesis 1 → John 20, the new creation opening in the dark
  where Genesis opened) and `garden` (Genesis 3 → John 20, the garden where it went wrong
  and the garden she took him for the gardener in). John 20 is authored `tomb → garden →
  abbey`, cutting on verse 16 where she recognises him rather than verse 15 where she
  does not. → `docs/decisions/0012-the-route-must-not-skip-the-events.md`
- **Mary Magdalene joins, carrying nothing; Eve moves to Genesis 2; Genesis 3 hands over
  nobody.** `mark` is optional now, and hers is blank: John 20 puts nothing in her hands,
  and the jar tradition gives her is Luke's and Mark's -- in John the spices are
  Nicodemus's, the evening before. Eve arrives where she is built and becomes a wife,
  which is where *"Wife acquired!"* belongs. And the roster rule relaxed from *exactly*
  one figure per node to *at most* one, because Genesis 3 is the chapter everyone is
  driven out of and an invented companion for it would be worse than an honest absence.
  → `docs/design/11-followers.md#a-figure-may-carry-nothing`

- **Reduced motion, honoured automatically and reachable in the menu.** The rail is close
  to a laboratory stimulus for motion adaptation -- a held fixation, continuous
  unidirectional scroll, three parallax layers at differing rates, for as long as anyone
  will practise -- and nothing in the game consulted `prefers-reduced-motion`. It does
  now, and there is a **Movement** switch beside it with three states: follow the system
  (the default), full, reduced. In the reduced presentation the ribbon **steps** to the
  cursor's column instead of easing toward it, the parallax freezes outright, set-piece
  and crossing animation is eased down rather than removed, and reading mode advances a
  character at a time. The fixed reading column is untouched in both, and the cursor-x
  invariant is asserted in both, in `core/rail.test.ts` and again in the smoke harness.
  Detection is in `platform/web/`; `core/motion.ts` receives it as state.
  → `docs/design/12-motion-and-comfort.md`, `docs/decisions/0011-respect-reduced-motion.md`
- **Held scenes, and Genesis 3 authored as the chapter it is.** A scene row may be `held`:
  the camera does not translate and the same completed words advance the *tableau*
  instead. Genesis 3 is five beats -- the serpent in the branches, the fruit taken, fig
  leaves, something moving in the garden at the cool of the day, and being driven out with
  a flaming sword turning behind them -- and only the last one travels. The camera counts
  *travelled* words rather than typed ones, so the world does not lurch when a hold ends,
  and no monster is placed inside one. Every one of the five stays behind and above the
  rail, which the smoke harness checks on the real frames.
  → `docs/design/05-scenery-warps.md#held-scenes-not-every-passage-is-a-journey`
- **The sound comes back after a backgrounded tab.** *"Sound had been working when I
  turned it on. Now it's not at all."* A browser suspends an `AudioContext` when its tab
  goes to the background, and the open path was guarded on "have we opened one before" --
  so after one alt-tab nothing ever resumed it and the game was silent for the rest of the
  evening with the toggle still reading on. The guard is now "a context exists *and is
  running*", with no flag beside it that could latch, and `visibilitychange` resumes it
  without needing a keystroke. The smoke harness suspends the device and asserts the music
  comes back both ways.
  → `docs/design/09-music.md#a-suspended-context-is-a-backgrounded-tab-not-an-error`
- **The game says verses and chapters, and invents nothing.** `part 4/9` is gone from
  every surface: the HUD, the report card's title, the menu, the history and the map all
  name the stretch by its citation — `Genesis 1:12-14`. The owner: *"Why not verses and
  chapters or something?"* `part` joins `candle` on the jargon list in both the copy test
  and the smoke sweep, so neither can drift back in one surface at a time.
  → `docs/design/03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing`
- **Reading mode is RSVP, not a teleprompter.** It scrolled the ribbon at a rising pace,
  which is the thing speed reading exists to get away from: text that moves must be
  tracked, and tracking is the saccade cost the whole technique removes. The owner:
  *"Read without typing should snap words into place rather than moving them. Speed
  reading software only displays one word at a time as I recall. With the second letter
  of each word anchored to the same place or something like that."* So it does.
  **One word at a time**, replacing each other in place, with an **anchor letter on the
  focal column** that never moves — the RSVP convention, first letter for a one-letter
  word, second up to five, third up to nine, fourth beyond, measured over the letters so
  a trailing comma cannot shift it. The offset is a function of *which word* and of
  nothing else, so nothing slides, ever. **Pace is words per minute literally** rather
  than the characters-over-five the typing side uses, **punctuation and a verse boundary
  earn a beat**, and **the pace comes down from inside the mode** with the arrow keys,
  named under the rail. The tunables were renamed with the meaning:
  `lectio_start_words_per_min`, `lectio_ramp_words_per_min`, `lectio_max_words_per_min`,
  plus `lectio_pace_step`, `lectio_comma_hold` and `lectio_stop_hold`.
  → `docs/design/02-rail.md#reading-mode`
- **`veni-creator` was freezing its arpeggio.** Its longest pedal note wanted 600
  arpeggio rungs against a ceiling of 512, so the drone stopped moving two thirds of the
  way through each of them — in the abbey's tune, which `void` borrows, so the most-heard
  music in the game. The ceiling was mis-sized rather than the tune being wrong: 512 is a
  couple of hundred rungs past a held whole note, and plainsong does not hold whole notes.
  It is 4096 now, over a minute of the house arpeggio against a longest loop of under a
  minute. And `loadTune` now refuses any note past it, so a tune that outgrows the ceiling
  fails loudly at load instead of quietly going flat; `core/tunes.test.ts` and
  `tools/smoke.mjs` both assert it over every file in `data/tunes/`.
  → `docs/design/09-music.md#the-arpeggio-ceiling`
- **The reading mode is called Reading.** It was *Lectio*, from lectio divina, sitting in
  the menu with nothing to explain it — *"Lectio? Is that the character name?"* Internal
  identifiers keep the old name, as `candle_interval` does.
  → `docs/design/02-rail.md#reading-mode`
- **The `apocalypse` theme is `daybreak`.** It was named after a genre and colloquially
  means the end of the world, which is not what it looks like: white-gold on void black,
  light gathering out of dark. Every other theme id is a place or a picture, and this one
  is now too. → `docs/design/05-scenery-warps.md#daybreak-was-called-apocalypse-and-that-named-the-wrong-thing`
- **No shell commands in anything a player reads.** The fallback banner, the text-load
  failure and the route-missing line no longer say `make build`, `make fetch` or
  `make serve`. The banner is still loud, still names exactly which sources failed, and is
  still the last command in the display list; it just no longer tells someone holding a
  URL to run something he cannot run. ADR 0009 records the change.
  → `docs/decisions/0009-fallbacks-must-announce-themselves.md`
- **Music is on by default, and opens on the first keystroke.** *"Music should be on, I
  haven't yet heard anything."* `audio_default_on` is 1, and the `AudioContext` is
  constructed synchronously inside the input handler — a keystroke is a user gesture, so
  the autoplay block the mute was avoiding never applies. The toggle is now how the sound
  goes *off*. The smoke harness asserts the context started with nobody pressing anything.
  → `docs/design/09-music.md#audio-is-on-and-starts-on-the-first-keystroke`
- **A follower arrives with a line.** One sentence in the strip under the rail, shown once
  when they join, gone as you type on, never repeated. Deadpan and formed from the roster
  — *Moses walks with you.* — except Eve's, which is **Wife acquired!**
  → `docs/design/11-followers.md#arriving-with-a-line`
- **The exclamation ban is about praise, and now only covers copy that judges the
  player.** The report card's note and advice, the coaching notes and the promotion panel
  keep it absolutely; copy about the world may use ordinary punctuation. Both halves keep
  the no-praise and jargon rules, and `core/copy.test.ts` gathers the two corpora
  separately so the evaluative half still fails on a congratulatory line.
  → `docs/design/10-first-run.md#the-exclamation-ban-is-about-praise-and-only-covers-copy-that-judges-him`
- **Eve is not a wizard.** *"Eve isn't very feminine. Looks like a second wizard."* She
  was: `bare` and `hooded` differ by six pixels of ink and *no* silhouette at all, so every
  adult follower was the same robed figure. There is a fourth body now — `gowned`: hair
  past the shoulders breaking the head outline outward, and a gown flaring two to one from
  waist to hem — shared with the woman of John 8, and asserted against the other bodies by
  a counted pixel margin rather than by eye. Her mark is the **fruit** rather than a hoe,
  which was a vertical stick indistinguishable from Moses's staff and was Adam's curse
  besides. → `docs/design/11-followers.md#a-shared-set-is-not-one-body-with-a-switch-on-it`
- **Followers.** Finishing a passage the route names puts its figure in a line
  walking behind the scribe, and finding a flashback room puts its figure there too
  — which is the visible trace a secret room never used to leave. They walk when he
  walks, idle when he idles, and do nothing else: no hearts, no smudge, no cloud, no
  drops, no score, no gate. That is arranged rather than observed —
  `core/followers.ts` has no way to name a mechanic, a pose has five fields, and a
  test draws the frame twice and asserts the two display lists differ only by the
  figures. The party is *derived* from `completed` and `discovered`, so there is no
  new field on the progress record and nothing to migrate. The map names everyone.
  → `docs/design/11-followers.md`

## Known problems

- A hop caught mid-air freezes under the report card at the end of a stretch of verses.
- Raw exception text can reach the menu's error line on corrupt data.
- The map says "not on the pilgrimage route" in lower case; the design doc
  capitalises it.

## Waiting to be looked at

- **Is the strike arc big enough?** Unverified, and the report that started it
  cannot settle it: *"you didn't change the kill animation"* came from a browser
  serving a cached page, so the stomp and the ink throw had shipped but had not
  been seen. The five numbers that decide how large the blow draws are rows in
  `docs/design/07-tuning.md` now — `strike_hop_px`, `strike_contact_px`,
  `strike_bounce_ratio`, `strike_nib_arc_px`, `strike_rise_travel` — so the feel
  can be turned without a code change. At the shipped values the scribe rises
  **12 px** above his standing line and crosses the **36 px** of `strike_reach`
  to the skeleton; the thrown nib arcs **14 px** off the line to the bat. He is
  16 px tall and has 58 px of room above him before the HUD, so there is a great
  deal of headroom if it wants to be bigger. Look at it once and say.

## Not done

- Sound polish. The ten tunes were transcribed against real notation and are
  correct, but they are only lightly heard in play. Three of the thirteen themes now
  share a tune with another (`void` with the abbey, `firmament` with the mountain,
  `hills` with the desert); none of the three has one of its own, and `hills` is the
  theme the player hears most.
- More sprite art. Seventeen tiles cover thirteen themes; monsters are still two kinds.
  The twenty followers are deliberately *not* twenty sprites — four body
  silhouettes, three cloths and one small mark apiece, and one of them carries no mark
  at all — and that is the shape any further background art should take rather than an
  omission to fix.
  → `docs/design/11-followers.md#art-without-ten-bespoke-sprites`
- **Jerusalem still has no landmarks.** `docs/design/05-scenery-warps.md#a-chapter-is-not-one-place`
  names three faces of the same problem and two are now fixed: Genesis 1 moves, and every
  Gospel passage the route names has a set piece. The third is the city — "a place you
  arrive at, not a texture that repeats" — and it wants a gate, a wall and a temple
  standing in the band rather than better brick. Nothing about it is built.
- Other routes. `Canonical`, `Narrative` and `Wisdom` are specified in
  `docs/design/04-route.md` and only `Pilgrimage` is authored.
- Chronicle levels — the genealogies, skipped by default, available as opt-in
  bonus passages. Specified, not built.

## How this repo works, and where everything is

Written for whoever picks this up next — a person, a different session, or a different
model. Nothing needed to continue this project lives in a conversation.

| You want | It is in |
|---|---|
| The rules you must follow | `AGENTS.md` — read first, it is short and binding |
| What is outstanding | this file |
| What the game is and why | `docs/design/` — twelve documents, canonical |
| Why a choice was made, and what was rejected | `docs/decisions/` — ten ADRs |
| What the numbers are | `docs/design/07-tuning.md`, compiled to `data/tuning.json` |
| Whether you have broken something | `./tools/check.sh` — every invariant, plus a smoke test that boots the actual built game |
| The reasoning behind a specific change | `git log` — the commit messages carry it |

**Documentation is canonical and code is a projection of it.** Tables in `docs/design/`
compile into `data/*.json`, and hand-editing the generated JSON fails the build. A design
change is a documentation change first, then `make build`, then code.

The ADRs matter more than they look. Several record decisions that are counter-intuitive
and will be "helpfully" reversed by anyone working from the code alone — there is no
speed timer (0004), damage is not per-typo (0005), gilding cannot open the mastery gate
(0008), a fallback must announce itself (0009). Each says what was rejected and why.
