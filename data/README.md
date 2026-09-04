# data/

All JSON. Several of these files are **generated** — do not hand-edit them. `make check`
regenerates and diffs, so an edit here fails the build rather than taking effect.

| File | Source | Edit by |
|---|---|---|
| `curriculum.json` | `docs/design/06-curriculum.md` | editing that doc, then `make build` |
| `tuning.json` | `docs/design/07-tuning.md` | editing that doc, then `make build` |
| `items.json` | `docs/design/03-pacing.md` | editing that doc, then `make build` |
| `themes.json` | `docs/design/05-scenery-warps.md` | editing that doc, then `make build` |
| `scenes/bible.json` | `docs/design/05-scenery-warps.md` | editing that doc, then `make build` |
| `routes/pilgrimage.json` | `docs/design/04-route.md` | editing that doc, then `make build` |
| `texts/**` | eBible.org and Project Gutenberg | `make fetch` |
| `coverage.json` | measured from the texts | `tools/build_wordlists.py` |
| `tunes/*.json` | hand-authored | directly, or `tools/midi_to_tune.py` |

Generated files carry a `_generated_from` field naming the document they came from.

Schemas: [data-schemas.md](../docs/architecture/data-schemas.md).
Why it works this way: [ADR 0006](../docs/decisions/0006-docs-are-canonical.md).
