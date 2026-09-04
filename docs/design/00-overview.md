# Overview: what this is and who it is for

**Implemented by:** `core/sim.ts`

## The player

One specific person: an adult who types with two fingers, hunting and pecking, and wants
to touch type. He is not a beginner at *using* a computer — he is a beginner at using it
with ten fingers.

This matters more than it sounds. His problem is not lack of practice. He has typed for
years. His problem is that he has practised the wrong motion until it is fast and
automatic, and the wrong motion has a ceiling around 40 WPM that he will never break
through by doing more of it.

Two consequences drive the entire design:

**1. He must not be able to hunt.** If a key he hasn't learned appears on screen, he
will look down and find it — that is what years of habit does. Willpower is not a
mechanism. So the game never asks for a key he has not been taught. See
[illumination](01-illumination.md).

**2. He cannot be timed.** A beginner on home row types 8–15 WPM. Every mainstream
typing game assumes 40+ and fails you below it. Being told you are too slow, repeatedly,
in week one, is how someone quits. So the world moves only when he types. See
[pacing](03-pacing.md).

Everything else in this repository is downstream of those two sentences.

## The shape of the game

A side-scrolling pixel platformer in the Castlevania/Mario mould. The player is a novice
scribe in a medieval abbey copying manuscripts. Typing *is* copying — the mechanic and
the fiction are the same act, which is why the theme was chosen and why it should not be
casually restyled.

The text is the Bible by default (public domain; see
[ADR 0002](../decisions/0002-web-and-kjv-not-net.md)), though any public-domain book can
be loaded. Chapters become levels. The map linking them is a graph of textual echoes
rather than a reading plan, so the player reaches the Gospels without first typing
Leviticus. See [route](04-route.md).

## The second goal, nearly free

The text sits at a fixed point on screen and the world scrolls past it, so the player's
eyes never travel. Eliminating saccades is the core speed-reading technique, and getting
it costs us nothing but a rendering decision. He learns to type and trains a fixed-gaze
reading habit on the same keystrokes. See [the rail](02-rail.md).

## What success looks like

Not a WPM number. Success is: after ten minutes of play, he is not looking at his hands.
Everything in [stats](08-stats.md) exists to make that measurable, and the per-finger
report card exists to make it *visible to him*.
