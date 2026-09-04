# 0001 — A zero-build web app, not a game engine

**Status:** accepted, 2026-09-03. Partly amended by [ADR 0007](0007-typescript-with-one-build-step.md), which introduces a
single `tsc` compile step. Everything else here stands.

## Context

The game has to reach one specific person — a friend learning to type — on whatever
machine he owns, with the least friction possible between "it exists" and "he is playing
it". A secondary requirement is that the architecture should translate to Dart later
without a rewrite.

## Decision

A plain web app: ES modules, Canvas 2D, WebAudio. No framework, no bundler, no runtime
dependencies. Served from GitHub Pages.

*(Amended by ADR 0007: the source is TypeScript, compiled by `tsc`. One build step, still
no bundler and no runtime dependencies.)*

Portability is bought instead through [core purity](../architecture/core-purity.md) — a
pure logic core behind a four-file platform layer.

## Consequences

- He gets a link. Nothing to install, works on any desktop OS, progress saves locally.
- `index.html` works opened directly off the filesystem after a build, which keeps
  debugging simple.
- The repository is entirely readable text — diffable, reviewable, agent-workable.
- We write our own sprite and audio handling rather than getting them from an engine.
  Accepted: the game's requirements are modest and its distinctive parts (illumination,
  the rail) are not things an engine would have provided anyway.
- No dependency upgrades, no toolchain rot. In five years it will still open.

## Alternatives rejected

**Godot 4.** Better sprite and audio tooling, exports to mobile. Rejected: a binary-asset
repository is hostile to both diffing and agent contribution, the learning curve is real,
and mobile is explicitly not a target for a touch-typing tutor.

**Tauri desktop wrapper.** Real `.app`/`.exe` downloads with an icon. Rejected for now as
pure overhead — a Rust toolchain and release signing in exchange for something a URL
already does. The web core would be unchanged, so this remains available later.

**A framework (React et al).** Rejected: it would add a build step, which is the specific
property being protected.
