# Music

**Implemented by:** `core/synth.ts`, `core/sequencer.ts`, `core/tunes.ts`, `core/sound.ts`,
`platform/web/web_audio.ts`

Each theme gets a chiptune arrangement of a public-domain melody. The synthesis model
deliberately mirrors the NES 2A03, because the constraints are what produce the sound.

## The channel budget

Four voices, and no more:

| Channel | Role | Notes |
|---|---|---|
| `pulse1` | Melody | Duty cycle switchable: 12.5% (thin, nasal), 25%, 50% (full, hollow) |
| `pulse2` | Harmony or arpeggio | Same duty options |
| `triangle` | Bass | Fixed amplitude, as on hardware — no velocity |
| `noise` | Percussion | Pitched noise for snare, short bursts for hats |

## How chords work

**You cannot play a chord.** Two melodic voices plus a bass is three notes, and one of
them is carrying the tune. Every chord in this game is an illusion, produced three ways —
all of them authentic period technique, not workarounds.

**1. Arpeggio.** Rather than sounding C-E-G together, cycle through them one at a time at
roughly 60 Hz. Far too fast to resolve as separate notes, so the ear fuses them into a
single buzzing chord. This is the defining texture of NES music — the shimmer under the
melody in Mario and Castlevania is a chord being played one note at a time.

It is a first-class field in the note format:

```json
{ "t": 0, "dur": 24, "midi": 60, "vel": 90, "arp": [0, 4, 7], "arpHz": 60 }
```

`arp` is semitone offsets from `midi`, cycled at `arpHz`. `[0,4,7]` is major, `[0,3,7]`
minor, `[0,3,6]` diminished — that last one, cycled fast, is the sound of impending doom
in roughly every 8-bit game ever made.

**2. Two-part harmony.** `pulse1` takes the melody, `pulse2` runs a third or sixth below.
Real counterpoint, and it spends both melodic voices — so a tune uses either harmony or
arpeggio at any moment, rarely both.

**3. Implied roots.** The triangle bass states the root; the ear reconstructs a full
chord that was never actually sounded. Chiptune relies on the listener finishing the job,
which is why sparse arrangements still sound full.

## The gothic sound

For the dark-grounded themes — `tomb`, `storm`, and `daybreak`, whose black is still
the void the light is breaking over — the Castlevania flavour comes
from **harmonic minor** (the raised seventh) rather than natural minor, driving eighth-note
triangle bass, and duty-cycle switching mid-phrase so one square wave delivers two
timbres. Fast `[0,3,6]` arpeggios over a pedal bass carry most of the menace.

Mid-phrase switching needs a duty on the *note*, not just the track, because a channel
may appear only once in a tune and so the part cannot be split across two tracks. A
note's `duty` overrides its track's; absent, the track's stands.

## Tune format

MIDI-style note events. `ppq` is pulses per quarter note; `t` and `dur` are in those
ticks; `midi` is a standard MIDI note number; `vel` is 0–127.

Three fields are normalised at load rather than demanded of the author. A triangle note's
`vel` is ignored and set full, because the 2A03 triangle has no volume register. A noise
note may name a `timbre` — `kick`, `snare`, `hat`, `crash` — instead of a `midi`, and it
becomes the General MIDI percussion key for that drum; the noise channel has no pitch, so
its note number *is* which drum. And `arpHz` defaults to 60 when `arp` is given without it.

`loop` is authoritative: playback wraps there, not at the last note, and a note starting
at or after it is a load error rather than a note nobody will ever hear.

## The arpeggio ceiling

An arpeggiated note is expanded into one scheduled pitch change per rung, and
`MAX_ARP_STEPS` in `core/synth.ts` caps how many rungs one note may have. **A note that
wants more is not refused by the synth, it is clamped by it** — the arpeggio stops moving
partway through and holds its last pitch to the end of the note.

That is the worst possible failure mode, because it sounds almost right. It is not
silence, it is not a wrong note, and nobody finds it by listening: it is a drone going
flat in the middle. It sat in `veni-creator` — the abbey's tune, which `void` borrows, so
the most-heard music in the game — with a ceiling of 512 and a chant over a pedal drone
whose longest note runs 384 ticks. At 96 bpm that is ten seconds, which at the house 60 Hz
arpeggio is 600 rungs, so the drone froze about two thirds of the way through each of them.

Two things changed, and both were needed.

**The ceiling was mis-sized.** 512 rungs is a couple of hundred past a held whole note, and
plainsong does not hold whole notes. A guard that catches real music is not a guard; it is
4096 now, which is over a minute of the house arpeggio against a longest loop in the whole
library of under a minute. A typo — an `arpHz` in the thousands, a duration authored in
milliseconds — is still orders of magnitude past it and still refused.

**And the loader now does the arithmetic.** `loadTune` rejects any note that would exceed
the ceiling, naming the channel and the tick, so a tune that outgrows it fails loudly at
load rather than quietly freezing. It is measured at `tempoRatio` 1, the slowest the
sequencer ever plays — the combo only ever speeds the music up, and a faster tempo shortens
every note — so a note that fits at rest fits at every tempo. `core/tunes.test.ts` runs it
over every file in `data/tunes/`, and `tools/smoke.mjs` runs it over the tunes the booted
game actually loaded.

```json
{
  "id": "cwm-rhondda",
  "name": "Cwm Rhondda",
  "source": "John Hughes, 1907. Public domain.",
  "bpm": 132,
  "ppq": 24,
  "loop": 1536,
  "tracks": [
    { "ch": "pulse1", "duty": 0.25, "notes": [ { "t": 0, "dur": 24, "midi": 72, "vel": 100 } ] },
    { "ch": "pulse2", "duty": 0.5,  "notes": [ { "t": 0, "dur": 96, "midi": 60, "vel": 70, "arp": [0,3,7], "arpHz": 60 } ] },
    { "ch": "triangle", "notes": [ { "t": 0, "dur": 48, "midi": 36 } ] },
    { "ch": "noise", "notes": [ { "t": 0, "dur": 6, "vel": 60, "timbre": "snare" } ] }
  ]
}
```

## Why not ship `.mid` files

Two reasons, both firm:

1. **Licensing.** A MIDI file of a public-domain hymn is a *new arrangement*, and carries
   its own copyright. Downloading `.mid` files would quietly poison an otherwise clean
   public-domain repository. Authoring our own note data from the public-domain melody
   avoids this entirely.
2. **Binary assets.** They are undiffable, unreviewable, and break the property that this
   whole repository is readable text.

**You can still compose in MIDI.** `tools/midi_to_tune.py` converts a `.mid` you authored
in any editor or DAW into the format above, mapping tracks onto the four channels. Author
however you like; the repository stores text.

## Tunes

All melodies below are public domain. Where a date is given it is first publication.

| id | melody | source | used by |
|---|---|---|---|
| `veni-creator` | Veni Creator Spiritus | Gregorian plainsong, 9th c. | `abbey` |
| `wondrous-love` | Wondrous Love | American folk hymn, 1811 | `garden` |
| `cwm-rhondda` | Cwm Rhondda | John Hughes, 1907 | `desert` |
| `melita` | Melita ("Eternal Father, Strong to Save") | John B. Dykes, 1861 | `sea` |
| `nicaea` | Nicaea ("Holy, Holy, Holy") | John B. Dykes, 1861 | `mountain` |
| `dies-irae` | Dies Irae | Gregorian sequence, 13th c. | `storm` |
| `ewing` | Ewing ("Jerusalem the Golden") | Alexander Ewing, 1853 | `city` |
| `nun-danket` | Nun danket alle Gott | Johann Crüger, 1647 | `temple` |
| `passion-chorale` | Passion Chorale ("O Sacred Head") | Hans Leo Hassler, 1601 | `tomb` |
| `helmsley` | Helmsley ("Lo, He Comes with Clouds Descending") | Thomas Olivers, 1763 | `daybreak` |
| `kingsfold` | Kingsfold | English traditional; English County Songs, 1893 | `hills` |
| `conditor-alme` | Conditor alme siderum | Gregorian plainsong, mode IV, 7th c. | `void` |
| `addisons` | Addison's ("The spacious firmament on high") | John Sheeles, c. 1720 | `firmament` |

Twelve themes and twelve tunes. For a while there were ten, and three themes borrowed:
`hills` took `cwm-rhondda` from `desert`, `void` took `veni-creator` from `abbey`, and
`firmament` took `nicaea` from `mountain`. Borrowing is a reasonable thing to do while a
theme is one of twelve. It stopped being reasonable when `hills` became the Bible's
default and started resolving for 1,158 of its 1,189 chapters, because the music the
player hears for nearly the whole book was then on loan from the wilderness.

### Choosing a tune that has to survive its fortieth repeat

`kingsfold` is not chosen the way the other eleven were. The rest each paint one place a
player passes through; this one plays under Ruth, Kings, the Psalms and Acts, for hours,
and the thing to optimise is not how good it sounds once but how little it wears.

Four decisions follow from that, and they are the arrangement rather than the melody:

- **A modal tune, not a major one.** Kingsfold is Aeolian on E, and the two cadences that
  are not the last fall on the flat seventh. A phrase that ends on the flat seventh reads
  as *continuing*; a major-key tune insists it has finished, four times a minute, for an
  hour.
- **Sixteen bars in rounded bar form.** Four four-bar groups, AABA, forty seconds at the
  authored tempo. The B section is the only place the melody goes above the stave, so
  there is one arrival per pass rather than one per phrase.
- **The percussion has a shape.** Silent through the first group, a soft backbeat through
  the second, kick and hat through the B section, one hat a bar in the fourth. The loop
  point therefore lands where the texture is emptiest, which is both how the seam is
  hidden and why forty passes do not feel like forty of the same thing.
- **Nothing is at full velocity.** Melody at 96, arpeggio at 56, hats at 34. The tune the
  player hears most should be the quietest thing in the songbook.
- **The harmonic rhythm is slow.** One chord a bar for most of it and never more than
  two. A chord change is an event, and a tune with an event every beat for an hour is
  exhausting whatever the notes are.

### `firmament` is Sheeles, not Haydn

Joseph Addison's *The spacious firmament on high* -- a paraphrase of Psalm 19, and the
nearest thing in English hymnody to a text about exactly what this theme paints -- carries
two tunes, and they are easily conflated because both are public domain and both are
named for the hymn rather than the composer:

| tune | composer | where it is sung |
|---|---|---|
| ADDISON'S, or LONDON (Sheeles) | John Sheeles, c. 1720 | English hymnals |
| CREATION | arranged from Haydn's *The Creation*, 1798 | American hymnals |

This game uses **ADDISON'S**, the Sheeles tune. It was asked for by that name, and it is
the tune the name belongs to. CREATION has the better provenance argument -- Haydn wrote
it for a setting of Genesis 1, which is the chapter this theme is painting -- and if the
owner would rather have it, that is a one-file change and a row in this table.

## Tempo, and the cues

Tempo scales with the player's combo up to `combo_tempo_max` — the music itself rewards
accuracy, and a rising tempo under a clean run is worth more than any score popup. The
scaling is linear and reaches the ceiling at a combo of `smudge_max / smudge_decay_per_key`
keystrokes. That number is derived rather than picked: it is exactly the run of clean
typing that scrubs a full smudge meter back to a clean page, so top tempo means something
the player can feel, and it moves on its own if either smudge row is ever retuned.

Besides the music there is a short vocabulary of cues — `error`, `smudge_full`,
`heart_lost`, `cloud`, `candle`, `stomp`, `ink`, `promotion`, `warp` — emitted as `sfx`
events for the platform to realise. There is deliberately **no per-keystroke click**. A
tutor that clatters on every key trains the player to listen for the sound instead of
watching the rail, and holding the eye still is the one thing the rail exists to do.

`core/sound.ts` names the cues and `platform/web/web_audio.ts` gives each one a voice, and
the two halves have to be edited together: the platform ignores a cue id it has no entry
for, so a cue named in core and unrealised in the platform is a field nobody keeps. It
would fire, silently, for ever.

### The two strikes

The pacing doc gives each enemy [its own verb](03-pacing.md#defeating-a-monster-must-read-as-an-action)
— a skeleton is stomped, a bat is inked — and for a while both rang one `defeat` cue. Two
things the player can plainly see the difference between sounded identical, which is the
audio quietly contradicting the picture.

So there are two cues, named after the verbs, and `StrikeVerb` and the cue ids are the
same two words: the platform passes the verb straight through rather than looking it up,
and there is no table in which the two could come to disagree.

| cue | reads as | voice |
|---|---|---|
| `stomp` | weight landing | Low pulse at 50% duty — the full, hollow square, the heaviest timbre the chip has. The arp *descends* and makes exactly one pass before sitting on the root for the last third of the note; that held root is the landing. |
| `ink` | something thrown, bursting | High pulse at 12.5% duty — thin and nasal, which is what a small hard object sounds like here. The arp climbs in stacked fourths and then drops back on its last step: the arc, then the burst spreading rather than continuing to rise. |

Both stay in the family the `candle` and the old `defeat` cue established — an
arpeggiated pulse voice, short, over before the next word — because they are the same
kind of news at different weights, and the game has to keep sounding like one instrument.
The `stomp` keeps the melody channel the `defeat` cue used; the `ink` is on `pulse2`, so a
stomp and a throw landing on the same keystroke are both heard rather than one cutting the
other off a single voice.

Both are the only cues whose weight the combo moves, for the reason the `defeat` cue's did:
felling a monster on a long clean run should sound like it. Neither ever falls below its
own resting velocity, so breaking a combo quietens nothing.

### Audio is on, and starts on the first keystroke

It shipped muted, behind a small toggle at the corner of the screen, on the argument that
browsers block autoplay and a beginner does not need a surprise fanfare. The owner played
it and reported: *"Music should be on, I haven't yet heard anything."*

Both halves of the old argument were wrong. The toggle was the only door in, and a door
nobody finds is a door that is not there -- ten tunes were transcribed against real
notation and nobody had heard one of them. And the autoplay problem has an answer that
costs nothing: **a keystroke is a user gesture.** A browser will let an `AudioContext`
start inside one, and this is a typing game, so the player's first act is always a
keystroke. There is no frame in which he could be startled by music he had not just asked
for by typing.

So `audio_default_on` is 1, and `platform/web/main.ts` starts the context on the first key
the player presses -- synchronously, inside the input handler, which is the only moment the
browser will allow it. Nothing is constructed before that: a page sitting untouched makes
no sound and holds no audio device.

The toggle stays exactly where it was. It is how the sound goes *off*, which is the
direction it was always more likely to be wanted in, and the choice is remembered.

### A suspended context is a backgrounded tab, not an error

Opening the device once, on the first keystroke, introduced a bug that looked exactly like
the sound having stopped existing. The owner: *"Sound had been working when I turned it on.
Now it's not at all."*

A browser **suspends an `AudioContext` when its tab goes to the background**, and resumes
nothing on the way back. That is normal and expected behaviour, not a failure. But the
open path had a latch in it -- once the device had been opened, it returned early for ever
-- so nothing ever called `resume()` again, and `play()` drops every event on a context
that is not running. Alt-tab to a terminal and back, and the game was silent for the rest
of the evening with the toggle still reading *on*.

Two rules, and the second is the one that was missing:

- **Opening the device is idempotent, not once-only.** The guard is "a context exists
  *and is running*", never "we have opened one before". Resuming from inside the input
  handler is legitimate for the same reason opening it there was: a keystroke is a user
  gesture.
- **The tab coming back to the foreground resumes it**, so the sound returns without the
  player having to type. `platform/web/main.ts` listens for `visibilitychange`.

And a failed resume must leave the state able to try again rather than latching, which is
precisely the trap the first version fell into. The smoke test drives it: start the audio,
suspend the context the way a backgrounded tab does, type, and assert notes are scheduled
again. Every existing test passed while this was broken.

### The control reports the device, not the setting

Twice now the game has been silent on the owner's machine and said nothing about it. The
third time he said it for us: *"it says 'on' for sound, but no sound."*

The toggle, and the label on it, reported `audio.on` — the **setting** — and never asked
whether a browser had actually started an `AudioContext`. That is a claim about the world
made from a variable we set ourselves. The smoke harness could not catch it, and cannot:
it drives a stubbed `AudioContext`, and **a stub cannot prove a browser made a noise.** So
seven green audio assertions sat beside a control asserting a state nobody had verified,
which is [ADR 0009](../decisions/0009-fallbacks-must-announce-themselves.md) exactly —
degraded operation wearing the look of normal operation.

**The control says what is true of the device.** Three states, because there were always
three and one word was covering two of them:

| The device | The control says |
|---|---|
| Setting off | `♪ sound: off` |
| Setting on, context running | `♪ sound: on` |
| Setting on, no context or one the browser has not started | `♪ sound: on — press a key` |

The third is not an error. A browser holds audio shut until the page has been typed on or
clicked, and suspends it again whenever the tab is backgrounded; both are normal, both are
silent, and neither is *on*. So it is said plainly, and it carries the one thing that fixes
it, which costs the player a keystroke he was about to make anyway.

**And it is said beside the control, not only on it.** Sound on with a device that is not
running is degraded operation, so a quiet line under the toggle says so in the dim colour
the rest of the chrome uses — never in the error colour, because being told to type is not
an alarm. It is up only while the gap is open.

**It updates from the device, not from the click.** `platform/web/main.ts` refreshes the
label from the context's own `statechange` — the browser's own signal that it has suspended
or resumed, which is more reliable than any poll and arrives on the frame it happens — from
`visibilitychange`, from a resolved or refused `start()`, and from the frame loop
twice a second as a backstop (`AUDIO_POLL_MS`, a platform constant -- nothing about the
player's experience is tuned by it). The backstop earns its place because `statechange` can only
be attached to a context that exists, and "no context at all" is the silent case actually
met.

### The diagnostic, in the menu

We have twice had to guess at why one particular machine was quiet, and guessing is not a
diagnostic. The menu now carries the browser's own account of the device:

- the `AudioContext`'s **`state`**, verbatim, or `none` when none has been constructed;
- how many contexts this sitting has **opened** — zero means no gesture ever reached
  `start()`;
- how many **notes** have been handed to the device — a running context with no notes is a
  different fault from a device that never started, and it is the shape a missing songbook
  makes;
- the **sample rate**, and the message from the last refused `resume()` if there was one.

None of it decides anything; it is read out and nothing else. It exists so that the next
time the game is silent, the game can say why instead of us inferring it from one sentence
of the owner's.
