# Scriptorium

**Learn to type by copying the Bible.**

A side-scrolling typing game in the Castlevania/Mario mould. You play a novice scribe in
a medieval abbey, and typing *is* copying — the mechanic and the theme are the same act.

Built for an absolute beginner: someone who hunts and pecks with two fingers today and
wants to touch type. Every design decision falls out of that. See
[`docs/design/00-overview.md`](docs/design/00-overview.md) for the reasoning.

## Play

<https://schancel.github.io/scriptorium>

Or locally. One build step, one dev dependency:

```sh
npm install     # typescript, and nothing else
make build      # compile docs tables into data/, TypeScript into build/
make serve      # python3 -m http.server 8000
open http://localhost:8000
```

## What makes it different

- **Illumination.** Real verses from minute one. Letters you haven't learned yet are
  greyed out and skip themselves; the page lights up as your fingers earn it. You never
  hunt for a key, because unlearned keys are never asked for.
- **No clock.** A beginner types 10 words a minute, and a timer at that speed just
  humiliates. The world moves only when you type. The threat is *stopping*, not being
  slow — an ink-blot cloud drifts in when you go idle.
- **The map is a graph, not a reading plan.** Passages connect by textual echo, so you
  reach the Gospels without slogging through Leviticus first. Genesis 1 warps to John 1
  — and during the transition, the words they share stay lit while everything else
  dissolves.
- **Fixed reading position.** The text sits still at the centre of the screen and the
  world scrolls past it, so your eyes never travel. That's the core speed-reading
  technique, and you get it for free while learning to type.

## Repository layout

| Path | What it is |
|---|---|
| `docs/` | **The design. Canonical.** Code is a projection of this. |
| `core/` | Pure game logic, TypeScript. No browser APIs, ever. |
| `platform/web/` | The only code that touches the DOM, canvas, audio or storage. |
| `data/` | Texts, routes, scenery. Several files are **generated** from `docs/`. |
| `tools/` | Text importers and the docs→data compiler. |

## Contributing, human or agent

Read [`AGENTS.md`](AGENTS.md) first — it is short and it is binding. The short version:
the documentation is the source of truth, the code is derived from it, and `make check`
enforces that mechanically.

```sh
make check      # every invariant. run before committing.
```

## Licensing

Code is MIT (see [`LICENSE`](LICENSE)).

The bundled texts are public domain: the **World English Bible** (released to the public
domain by Michael Paul Johnson / eBible.org) and the **King James Version** (public
domain in the United States). The NET Bible is deliberately *not* used — it is
copyrighted under a conditional free-use policy rather than being public domain. See
[`docs/decisions/0002-web-and-kjv-not-net.md`](docs/decisions/0002-web-and-kjv-not-net.md).
