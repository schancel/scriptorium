#!/usr/bin/env python3
"""Convert a Standard MIDI File into a Scriptorium tune.

    python3 tools/midi_to_tune.py in.mid --id cwm-rhondda --name "Cwm Rhondda" \
        --source "John Hughes, 1907. Public domain." -o data/tunes/cwm-rhondda.json

Why this exists: a MIDI file of a public-domain hymn is a *new arrangement* and
carries its own copyright, so the repository stores note data it authored itself
rather than .mid files it downloaded. You may still compose in a DAW -- this
converts what comes out, and the .mid stays out of the tree.

Python 3 standard library only, and the MIDI binary is parsed here rather than
with `mido`, because a runtime or build dependency is a standing prohibition.
See docs/decisions/0001-web-app-not-game-engine.md.

Mapping onto the four channels
------------------------------
The 2A03 has two pulses, a triangle and a noise channel, and every one of them
is monophonic. A DAW file is neither, so the conversion is lossy by nature and
says so out loud:

  * MIDI channel 10 (percussion) becomes `noise`, its keys read as General MIDI
    drums.
  * The remaining voices are ranked by mean pitch: highest becomes `pulse1`
    (the melody), next `pulse2`, lowest `triangle`. `--map` overrides this.
  * Overlapping notes within one voice are reduced to the top note, and the
    note underneath is truncated at the new onset -- which is what the hardware
    would have done anyway.
  * Simultaneous notes on an `--arp` channel are collapsed into one note with
    `arp` offsets, which is how a chord is played on this machine at all.
    See docs/design/09-music.md#how-chords-work.

Everything it discards is reported on stderr. Read that output; it is the only
warning you get that a chord went missing.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CHANNELS = ("pulse1", "pulse2", "triangle", "noise")
PERCUSSION_CHANNEL = 9  # zero-based; "MIDI channel 10"
DEFAULT_PPQ = 24
DEFAULT_BPM = 120
DEFAULT_ARP_HZ = 60
MIDI_MAX = 127
US_PER_MINUTE = 60_000_000


# --- the binary -------------------------------------------------------------


class Reader:
    """A byte cursor with just enough of the SMF grammar."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def eof(self) -> bool:
        return self.pos >= len(self.data)

    def byte(self) -> int:
        if self.pos >= len(self.data):
            raise ValueError("midi: truncated file")
        value = self.data[self.pos]
        self.pos += 1
        return value

    def take(self, n: int) -> bytes:
        if self.pos + n > len(self.data):
            raise ValueError("midi: truncated chunk")
        out = self.data[self.pos : self.pos + n]
        self.pos += n
        return out

    def u16(self) -> int:
        return int.from_bytes(self.take(2), "big")

    def u32(self) -> int:
        return int.from_bytes(self.take(4), "big")

    def varlen(self) -> int:
        """The SMF variable-length quantity: 7 bits per byte, high bit continues."""
        value = 0
        for _ in range(4):
            b = self.byte()
            value = (value << 7) | (b & 0x7F)
            if not b & 0x80:
                return value
        raise ValueError("midi: variable-length quantity longer than four bytes")


class Note:
    __slots__ = ("t", "dur", "midi", "vel", "channel")

    def __init__(self, t: int, dur: int, midi: int, vel: int, channel: int) -> None:
        self.t, self.dur, self.midi, self.vel, self.channel = t, dur, midi, vel, channel


def parse_track(data: bytes) -> tuple[list[Note], int | None, str | None]:
    """Notes, the first tempo found, and the track name."""
    r = Reader(data)
    now = 0
    status = 0
    open_notes: dict[tuple[int, int], tuple[int, int]] = {}
    notes: list[Note] = []
    tempo: int | None = None
    name: str | None = None

    while not r.eof():
        now += r.varlen()
        first = r.byte()
        if first & 0x80:
            status = first
        else:
            # Running status: the byte we just read is the first data byte.
            r.pos -= 1
            if not status:
                raise ValueError("midi: data byte with no running status")

        if status == 0xFF:
            meta = r.byte()
            body = r.take(r.varlen())
            if meta == 0x51 and len(body) == 3 and tempo is None:
                tempo = int.from_bytes(body, "big")
            elif meta == 0x03 and name is None:
                name = body.decode("latin-1", "replace").strip()
            elif meta == 0x2F:
                break
            continue

        if status in (0xF0, 0xF7):
            r.take(r.varlen())
            continue

        kind = status & 0xF0
        channel = status & 0x0F

        if kind in (0x80, 0x90):
            key = r.byte()
            vel = r.byte()
            if kind == 0x90 and vel > 0:
                open_notes[(channel, key)] = (now, vel)
            else:
                started = open_notes.pop((channel, key), None)
                if started is not None:
                    at, on_vel = started
                    notes.append(Note(at, max(1, now - at), key, on_vel, channel))
        elif kind in (0xA0, 0xB0, 0xE0):
            r.take(2)
        elif kind in (0xC0, 0xD0):
            r.take(1)
        else:
            raise ValueError(f"midi: unknown status byte 0x{status:02X}")

    for (channel, key), (at, vel) in open_notes.items():
        # A note left hanging at the end of the track. Give it one beat rather
        # than dropping it silently.
        notes.append(Note(at, 1, key, vel, channel))
    notes.sort(key=lambda n: (n.t, n.midi))
    return notes, tempo, name


def parse_midi(raw: bytes) -> tuple[list[list[Note]], int, int]:
    """Returns (voices, ticks-per-quarter, microseconds-per-quarter)."""
    r = Reader(raw)
    if r.take(4) != b"MThd":
        raise ValueError("midi: not a Standard MIDI File (no MThd)")
    header_len = r.u32()
    fmt = r.u16()
    ntrks = r.u16()
    division = r.u16()
    r.take(max(0, header_len - 6))

    if division & 0x8000:
        raise ValueError("midi: SMPTE time division is not supported; use ticks per quarter")
    if fmt not in (0, 1):
        raise ValueError(f"midi: format {fmt} is not supported")

    tracks: list[list[Note]] = []
    tempo: int | None = None
    while not r.eof() and len(tracks) < max(ntrks, 1) + 1:
        tag = r.take(4)
        length = r.u32()
        body = r.take(length)
        if tag != b"MTrk":
            continue
        notes, track_tempo, _name = parse_track(body)
        if tempo is None and track_tempo is not None:
            tempo = track_tempo
        if notes:
            tracks.append(notes)

    # A format 0 file is one track holding every MIDI channel; split it, so the
    # voice mapping below has something to rank.
    if fmt == 0 and tracks:
        by_channel: dict[int, list[Note]] = {}
        for note in tracks[0]:
            by_channel.setdefault(note.channel, []).append(note)
        tracks = [by_channel[c] for c in sorted(by_channel)]

    if not tracks:
        raise ValueError("midi: file holds no notes")
    return tracks, division, tempo or (US_PER_MINUTE // DEFAULT_BPM)


# --- reduction --------------------------------------------------------------


def mono(notes: list[Note], where: str) -> list[Note]:
    """One voice, one note. Top-note priority; the note underneath is truncated."""
    notes = sorted(notes, key=lambda n: (n.t, -n.midi))
    out: list[Note] = []
    dropped = 0
    for note in notes:
        if out and note.t == out[-1].t:
            dropped += 1
            continue  # simultaneous onset: the higher note already won
        if out and out[-1].t + out[-1].dur > note.t:
            out[-1].dur = note.t - out[-1].t
            if out[-1].dur <= 0:
                out.pop()
        out.append(note)
    if dropped:
        print(f"  {where}: dropped {dropped} simultaneous note(s) -- one voice, one note",
              file=sys.stderr)
    return [n for n in out if n.dur > 0]


def arpeggiate(notes: list[Note], where: str) -> list[dict]:
    """Collapse each simultaneous stack into one note carrying `arp` offsets."""
    stacks: dict[int, list[Note]] = {}
    for note in notes:
        stacks.setdefault(note.t, []).append(note)

    out: list[dict] = []
    made = 0
    for t in sorted(stacks):
        stack = sorted(stacks[t], key=lambda n: n.midi)
        root = stack[0]
        event = {"t": t, "dur": max(n.dur for n in stack), "midi": root.midi, "vel": root.vel}
        if len(stack) > 1:
            event["arp"] = [n.midi - root.midi for n in stack]
            event["arpHz"] = DEFAULT_ARP_HZ
            made += 1
        out.append(event)
    if made:
        print(f"  {where}: {made} chord(s) became arpeggios", file=sys.stderr)
    return out


def assign(voices: list[list[Note]], override: dict[int, str]) -> dict[str, list[Note]]:
    """Rank the voices onto the four channels: highest is the melody."""
    assigned: dict[str, list[Note]] = {}
    remaining: list[tuple[int, list[Note]]] = []

    for index, notes in enumerate(voices):
        named = override.get(index)
        if named is not None:
            if named != "skip":
                assigned.setdefault(named, []).extend(notes)
            continue
        if all(n.channel == PERCUSSION_CHANNEL for n in notes):
            assigned.setdefault("noise", []).extend(notes)
            continue
        remaining.append((index, notes))

    remaining.sort(key=lambda pair: -(sum(n.midi for n in pair[1]) / len(pair[1])))
    melodic = [c for c in ("pulse1", "pulse2", "triangle") if c not in assigned]
    for (index, notes), channel in zip(remaining, melodic):
        assigned[channel] = notes
    for index, notes in remaining[len(melodic):]:
        print(f"  track {index}: dropped, only four channels exist", file=sys.stderr)
    return assigned


# --- output -----------------------------------------------------------------


def convert(args: argparse.Namespace) -> dict:
    voices, source_ppq, us_per_quarter = parse_midi(Path(args.input).read_bytes())
    override = {}
    for pair in args.map or []:
        index, _, channel = pair.partition("=")
        if channel not in CHANNELS and channel != "skip":
            raise SystemExit(f"--map: {channel!r} is not one of {', '.join(CHANNELS)} or 'skip'")
        override[int(index)] = channel

    scale = args.ppq / source_ppq
    assigned = assign(voices, override)
    arp_channels = set(args.arp or ["pulse2"])

    tracks = []
    for channel in CHANNELS:
        notes = assigned.get(channel)
        if not notes:
            continue
        for note in notes:
            note.t = round(note.t * scale)
            note.dur = max(1, round(note.dur * scale))
            note.midi = max(0, min(MIDI_MAX, note.midi))
            note.vel = max(1, min(MIDI_MAX, note.vel))

        if channel in arp_channels:
            events = arpeggiate(sorted(notes, key=lambda n: (n.t, n.midi)), channel)
        else:
            events = [
                {"t": n.t, "dur": n.dur, "midi": n.midi, "vel": n.vel}
                for n in mono(notes, channel)
            ]
        if channel == "triangle":
            for event in events:
                event.pop("vel", None)  # the 2A03 triangle has no volume register

        track: dict = {"ch": channel}
        if channel.startswith("pulse"):
            track["duty"] = args.duty
        track["notes"] = events
        tracks.append(track)

    end = max((n["t"] + n["dur"] for t in tracks for n in t["notes"]), default=args.ppq)
    bar = args.ppq * 4
    loop = args.loop or ((end + bar - 1) // bar) * bar

    return {
        "id": args.id,
        "name": args.name,
        "source": args.source,
        "bpm": args.bpm or round(US_PER_MINUTE / us_per_quarter),
        "ppq": args.ppq,
        "loop": loop,
        "tracks": tracks,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="the .mid to convert")
    p.add_argument("--id", required=True, help="tune id, matching the themes table")
    p.add_argument("--name", required=True, help="human-readable name")
    p.add_argument("--source", required=True,
                   help="provenance and the public-domain claim; this is not optional")
    p.add_argument("--ppq", type=int, default=DEFAULT_PPQ, help=f"target ticks per quarter (default {DEFAULT_PPQ})")
    p.add_argument("--bpm", type=int, default=None, help="override the tempo in the file")
    p.add_argument("--loop", type=int, default=None, help="loop length in target ticks")
    p.add_argument("--duty", type=float, default=0.25, help="pulse duty cycle (0.125, 0.25 or 0.5)")
    p.add_argument("--map", action="append", metavar="N=CHANNEL",
                   help="force track N onto a channel, or 'skip' it; repeatable")
    p.add_argument("--arp", action="append", metavar="CHANNEL",
                   help="collapse chords into arpeggios on this channel (default pulse2)")
    p.add_argument("-o", "--out", default=None, help="write here instead of stdout")
    args = p.parse_args()

    tune = convert(args)
    text = json.dumps(tune, indent=2) + "\n"
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"  wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
