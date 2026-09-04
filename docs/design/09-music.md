# Music

**Implemented by:** `core/tunes.js`, `core/sound.js`, `platform/web/web_audio.js`

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

For the darker themes — `tomb`, `storm`, `apocalypse` — the Castlevania flavour comes
from **harmonic minor** (the raised seventh) rather than natural minor, driving eighth-note
triangle bass, and duty-cycle switching mid-phrase so one square wave delivers two
timbres. Fast `[0,3,6]` arpeggios over a pedal bass carry most of the menace.

## Tune format

MIDI-style note events. `ppq` is pulses per quarter note; `t` and `dur` are in those
ticks; `midi` is a standard MIDI note number; `vel` is 0–127.

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
| `helmsley` | Helmsley ("Lo, He Comes with Clouds Descending") | Thomas Olivers, 1763 | `apocalypse` |

Tempo scales with the player's combo up to `combo_tempo_max` — the music itself rewards
accuracy, and a rising tempo under a clean run is worth more than any score popup.

Audio starts muted (`audio_default_on`). Browsers block autoplay, and a beginner
concentrating hard does not need a surprise fanfare.
