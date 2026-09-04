/**
 * @doc docs/design/09-music.md#tunes
 *
 * The tune files are the one part of the audio engine with no compiler and no
 * reviewer: a wrong tick or a fifth channel is invisible in a diff and silent
 * at runtime. So every file that ships is loaded, validated and measured here,
 * and every theme in the generated theme table is checked to have a tune that
 * actually exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { CHANNELS, isChannel } from './synth.js';
import { advanceSequencer, createSequencer, startSequencer } from './sequencer.js';
import { createLibrary, loadThemeTunes, loadTune, tuneForTheme } from './tunes.js';
import type { Tune } from './tunes.js';

/** Locate `data/`, whether the tests run from build/ or from source. */
function dataUrl(rel: string): URL {
  for (const prefix of ['../../data/', '../data/']) {
    const url = new URL(prefix + rel, import.meta.url);
    try {
      readdirSync(new URL(prefix, import.meta.url));
      return url;
    } catch {
      continue;
    }
  }
  throw new Error(`test: cannot locate data/${rel}`);
}

function loadDataFile(name: string): unknown {
  return JSON.parse(readFileSync(dataUrl(name), 'utf8')) as unknown;
}

const files: readonly string[] = readdirSync(dataUrl('tunes'))
  .filter((name) => name.endsWith('.json'))
  .sort();

const tunes: readonly Tune[] = files.map((name) => loadTune(loadDataFile(`tunes/${name}`)));

const MS_PER_MINUTE = 60000; // tuning-exempt: SI unit conversion

test('every tune file parses', () => {
  assert.ok(files.length > 0, 'no tune files found');
  assert.equal(tunes.length, files.length);
});

test('a tune is named by its filename, so a lookup cannot miss', () => {
  files.forEach((name, i) => {
    assert.equal(tunes[i]?.id, name.replace(/\.json$/, ''));
  });
});

test('every theme in the generated table has a tune that exists', () => {
  const themes = loadThemeTunes(loadDataFile('themes.json'));
  const library = createLibrary([...tunes]);
  assert.ok(themes.size > 0);
  for (const [theme] of themes) {
    const tune = tuneForTheme(library, themes, theme);
    assert.ok(tune !== null, `theme "${theme}" names a tune that does not exist`);
  }
});

test('no tune references a channel outside the four', () => {
  for (const tune of tunes) {
    const seen = new Set<string>();
    for (const track of tune.tracks) {
      assert.ok(isChannel(track.ch), `${tune.id}: "${track.ch}" is not a channel`);
      assert.ok(CHANNELS.includes(track.ch));
      assert.ok(!seen.has(track.ch), `${tune.id}: channel "${track.ch}" appears twice`);
      seen.add(track.ch);
    }
    assert.ok(tune.tracks.length <= CHANNELS.length);
    // The melody is not optional. A tune with no pulse1 is an accompaniment.
    assert.ok(seen.has('pulse1'), `${tune.id}: no melody`);
  }
});

test('every tune states its provenance and fits inside its loop', () => {
  for (const tune of tunes) {
    // The public-domain claim is the point of the field; an empty one would
    // quietly reintroduce exactly the licensing risk the design doc forbids.
    assert.ok(tune.source.length > 0, `${tune.id}: empty source`);
    assert.ok(/public domain/i.test(tune.source), `${tune.id}: source makes no PD claim`);
    assert.ok(tune.loop > 0);
    for (const track of tune.tracks) {
      for (const note of track.notes) {
        assert.ok(note.t >= 0 && note.t < tune.loop, `${tune.id}: note outside the loop`);
        assert.ok(note.dur > 0);
      }
    }
  }
});

test('chords are an illusion: no channel ever sounds two notes at once', () => {
  // The whole arrangement style rests on this. If a track overlaps itself the
  // hardware would drop a note, so a tune that does it is not the tune anyone
  // will hear -- and the fix is an arpeggio, not a second voice.
  for (const tune of tunes) {
    for (const track of tune.tracks) {
      track.notes.forEach((note, i) => {
        const next = track.notes[i + 1];
        if (next === undefined) return;
        assert.ok(
          note.t + note.dur <= next.t,
          `${tune.id}/${track.ch}: notes at tick ${String(note.t)} and ${String(next.t)} overlap`,
        );
      });
    }
  }
});

test('every arpeggio is a chord shape, cycled fast enough to fuse', () => {
  // Below about 30 Hz the ear starts hearing separate notes rather than a
  // chord, which is the difference between a chord and a trill.
  const FUSION_HZ = 30; // tuning-exempt: the psychoacoustic floor, not a knob
  let arpeggiated = 0;
  for (const tune of tunes) {
    for (const track of tune.tracks) {
      for (const note of track.notes) {
        if (note.arp === null) continue;
        arpeggiated += 1;
        assert.ok(note.arpHz !== null && note.arpHz >= FUSION_HZ, `${tune.id}: slow arpeggio`);
        assert.ok(note.arp.length > 1, `${tune.id}: a one-note arpeggio is not a chord`);
        assert.equal(note.arp[0], 0, `${tune.id}: an arpeggio must start on its root`);
      }
    }
  }
  assert.ok(arpeggiated > 0, 'no tune uses an arpeggio at all');
});

test('the dark themes are in harmonic minor, with diminished arpeggios', () => {
  // docs/design/09-music.md#the-gothic-sound. The raised seventh and the
  // [0,3,6] arpeggio are the whole flavour, and losing them is the kind of
  // regression nobody notices until the tomb sounds cheerful.
  const themes = loadThemeTunes(loadDataFile('themes.json'));
  const library = createLibrary([...tunes]);
  const DIMINISHED = [0, 3, 6]; // tuning-exempt: the diminished triad, in semitones

  for (const theme of ['tomb', 'storm', 'apocalypse']) {
    const tune = tuneForTheme(library, themes, theme);
    assert.ok(tune !== null, `no tune for ${theme}`);
    const arps = tune.tracks.flatMap((t) => t.notes).filter((n) => n.arp !== null);
    assert.ok(
      arps.some((n) => JSON.stringify(n.arp) === JSON.stringify(DIMINISHED)),
      `${theme}: no diminished arpeggio`,
    );
    // Over a bass that keeps moving: the driving pedal is half the effect.
    const bass = tune.tracks.find((t) => t.ch === 'triangle');
    assert.ok(bass !== undefined && bass.notes.length >= tune.loop / tune.ppq / 2,
      `${theme}: the bass is not driving`);
  }
});

test('tunes are JSON all the way down', () => {
  for (const tune of tunes) {
    assert.deepEqual(JSON.parse(JSON.stringify(tune)) as unknown, tune);
  }
});

test('a tune outside the four channels is rejected, loudly', () => {
  const good = { id: 'x', name: 'X', source: 'public domain', bpm: 120, ppq: 24, loop: 24, // tuning-exempt: test fixture
    tracks: [{ ch: 'pulse1', notes: [{ t: 0, dur: 24, midi: 60, vel: 100 }] }] }; // tuning-exempt: test fixture
  assert.doesNotThrow(() => loadTune(good));

  assert.throws(() => loadTune({ ...good, tracks: [{ ch: 'saw', notes: [] }] }), /channel/);
  assert.throws(() => loadTune({ ...good, tracks: [{ ch: 'pulse3', notes: [] }] }), /channel/);
  assert.throws(() => loadTune({ ...good, source: '' }), /source/);
  assert.throws(() => loadTune({ ...good, loop: 0 }), /loop/);
  assert.throws(
    () => loadTune({ ...good, tracks: [
      { ch: 'pulse1', notes: [{ t: 0, dur: 24, midi: 60, vel: 100 }] }, // tuning-exempt: test fixture
      { ch: 'pulse1', notes: [] },
    ] }),
    /twice/,
  );
  // A note past the loop point would never sound.
  assert.throws(
    () => loadTune({ ...good, loop: 12, // tuning-exempt: test fixture
      tracks: [{ ch: 'pulse1', notes: [{ t: 20, dur: 4, midi: 60, vel: 100 }] }] }), // tuning-exempt: test fixture
    /loop point/,
  );
});

test('every shipped tune loops seamlessly, twice round', () => {
  // The fixture in sequencer.test.ts proves the seam arithmetic; this proves it
  // over the tunes that actually ship. Frames are deliberately ragged and out of
  // phase with every tick grid, with the last one trimmed so each lap covers the
  // loop exactly -- otherwise the two laps would start at different phases and
  // the comparison would be meaningless rather than strict.
  //
  // Pitches are compared as a sorted multiset: when one frame straddles the
  // seam the events inside it come out grouped by side rather than by track,
  // and which of two simultaneous notes on different channels is listed first
  // inside a 17 ms frame is not something anyone can hear.
  const FRAME_MS = 17; // tuning-exempt: test fixture -- ragged, coprime with the tick grids

  for (const tune of tunes) {
    const loopMs = (tune.loop / tune.ppq) * (MS_PER_MINUTE / tune.bpm);
    const authored = tune.tracks.reduce((sum, track) => sum + track.notes.length, 0);
    let state = startSequencer(createSequencer());

    const lap = (): string[] => {
      const heard: string[] = [];
      let elapsed = 0;
      while (elapsed < loopMs) {
        const dtMs = Math.min(FRAME_MS, loopMs - elapsed);
        const step = advanceSequencer(state, tune, dtMs, 1);
        state = step.state;
        elapsed += dtMs;
        for (const event of step.events) {
          if (event.type === 'note') heard.push(`${event.ch}:${String(event.midi)}`);
        }
      }
      return heard.sort();
    };

    const first = lap();
    const second = lap();
    // Nothing eaten at the seam and nothing played twice: one lap is the tune.
    assert.equal(first.length, authored, `${tune.id}: a lap is not the whole tune`);
    assert.deepEqual(second, first, `${tune.id}: the loop is not seamless`);
    // And the needle is back where it started, exactly.
    assert.equal(state.posTicks, 0, `${tune.id}: the needle drifted off the seam`);
  }
});
