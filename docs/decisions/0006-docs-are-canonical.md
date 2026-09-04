# 0006 — Documentation is canonical; code is a projection

**Status:** accepted, 2026-09-03

## Context

This repository is expected to be worked on by agents — Codex, future Claude sessions —
as well as by its author months later. None of the reasoning behind the design is
recoverable from the code. Nothing in `illumination.js` explains why filtering the corpus
was rejected, why there is no timer, or why the NET Bible is absent. An agent that has to
infer intent will infer wrong and quietly reverse settled decisions.

## Decision

**The documentation is the source of truth. The code is a projection of it.** Enforced
mechanically rather than by convention.

Three mechanisms:

1. **Table-shaped design is compiled.** Curriculum stages, tuning constants, route edges,
   scene themes and item effects are authored as markdown tables in `docs/design/` and
   compiled to `data/*.json` by `tools/build_from_docs.py`. `make check` regenerates and
   diffs, so hand-editing generated JSON fails the build. There is no path to changing a
   tunable except editing the document that specifies it.
2. **Algorithmic code is linked bidirectionally.** Every `core/` module carries a
   `@doc path#anchor` header. Every design doc names its implementing modules. Both
   directions must resolve.
3. **Decisions with a rejected alternative get an ADR.** These files.

## Consequences

- An agent reading `AGENTS.md` and `docs/design/` has the complete design without opening
  a source file.
- Design changes cannot be made in code alone, which is the entire point.
- Every number in the game is tunable by editing one markdown table — a genuine
  convenience, not just discipline.
- Documentation cannot silently rot, because the build depends on it.
- Cost: a design change is two edits instead of one. Accepted.

## Alternatives rejected

**Docs as description, updated by convention.** The normal arrangement. Rejected because
it always decays, and it decays fastest under exactly the conditions here — several
agents, months apart, no shared memory.

**Generate the docs from the code.** Inverts the dependency and loses everything that
matters: intent, rejected alternatives, and the reasoning that makes a decision
reviewable. Generated docs describe what the code does, which is the one thing already
knowable.
