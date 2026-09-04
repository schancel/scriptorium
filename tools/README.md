# tools/

Python 3, no dependencies beyond the standard library.

## Build

| Script | What it does |
|---|---|
| `build_from_docs.py` | Compiles marked markdown tables in `docs/design/` into `data/*.json`. `--check` regenerates and diffs instead of writing. |
| `fetch_bible.py` | Downloads and normalises WEB and KJV into the text schema. |
| `build_wordlists.py` | Measures real per-stage live coverage against the corpus; writes `data/coverage.json` and drill vocabulary. |
| `import_gutenberg.py` | Converts a Project Gutenberg plain-text book into the same schema. |
| `midi_to_tune.py` | Converts a `.mid` file into the tune format, mapping tracks onto the four channels. |

## Checks

`check.sh` runs all of these; it is what `make check` invokes.

| Script | Invariant |
|---|---|
| `check_core_purity.py` | No platform APIs in `core/` |
| `check_doc_links.py` | `@doc` headers and `Implemented by:` lines resolve, both directions |
| `check_no_magic.py` | No numeric literals in `core/` outside the allowlist |
| `check_zero_install.sh` | No dependencies, no bundler, no remote scripts |
| `validate_data.py` | Route shape, scene coverage, warp echo phrases present in the real text |

Adding a new generated file means registering a shaper in `build_from_docs.py` — it
fails loudly on an unregistered target rather than silently skipping it.
