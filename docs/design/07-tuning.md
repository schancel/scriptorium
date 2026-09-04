# Tuning

**Implemented by:** `core/sim.js`, `core/damage.js`, `core/curriculum.js`, `core/rail.js`

Every tunable number in the game lives in this table and nowhere else. Numeric literals
in `core/` outside a tiny allowlist (`0`, `1`, `-1`) are a `make check` failure.

Two reasons. First, drift here is invisible — a threshold quietly changed in code is
undetectable in review, while a changed row in this table is obvious. Second, the whole
game becomes tunable by editing one document, which is exactly what will be wanted the
first evening a real beginner plays it and something feels wrong.

<!-- generates: data/tuning.json -->

| key | value | unit | what it does |
|---|---|---|---|
| `grey_snap_ms` | 0 | ms | Delay before a greyed run auto-advances. Zero means the cursor snaps; anything above ~60 makes the player wait on the game. |
| `min_stage1_coverage` | 0.30 | fraction | If measured stage-1 live coverage falls below this, the curriculum boundaries must move. Hard floor. |
| `gate_accuracy` | 0.95 | fraction | Accuracy required on a stage's new keys to advance. |
| `gate_window` | 200 | keystrokes | Trailing window the gate is measured over. |
| `gate_latency_base_ms` | 600 | ms | Median keystroke latency allowed at stage 0. |
| `gate_latency_step_ms` | 25 | ms | Tightening per stage. This is the anti-hunt-and-peck lever. |
| `gate_latency_floor_ms` | 250 | ms | Never demand faster than this. |
| `idle_base_ms` | 8000 | ms | Silence before the blot-cloud approaches, at stage 0. Generous on purpose. |
| `idle_step_ms` | 400 | ms | Tightening per stage. |
| `idle_floor_ms` | 3000 | ms | Never less than this, at any stage. |
| `cloud_approach_ms` | 2500 | ms | Telegraph time between the cloud appearing and it striking. |
| `cloud_smudge` | 25 | smudge | Smudge added when the cloud lands. |
| `smudge_max` | 100 | smudge | Full meter. Reaching it costs one heart and resets. |
| `smudge_per_error_base` | 12 | smudge | Added per mistyped key at stage 0. |
| `smudge_per_error_step` | 2 | smudge | Added per stage, so tolerance narrows as skill grows. |
| `smudge_decay_per_key` | 2 | smudge | Removed per correct keystroke. Clean typing cleans the page. |
| `hearts_start` | 3 | hearts | Starting health. |
| `hearts_max` | 5 | hearts | Cap, including quill-nib upgrades. |
| `combo_tempo_max` | 1.25 | ratio | Music tempo multiplier at maximum combo. |
| `rail_cursor_x` | 0.5 | fraction | Cursor position across the viewport. Must never vary. |
| `rail_scroll_lerp` | 0.25 | fraction | Text ribbon easing per frame toward its target offset. |
| `focal_guide_width` | 40 | px | Width of the rules above and below the cursor. |
| `warp_phase_ms` | 1400 | ms | Duration of a warp crossfade. |
| `warp_echo_hold_ms` | 900 | ms | How long the shared phrase stays lit while the world changes. |
| `lectio_start_wpm` | 180 | wpm | Opening pace in reading mode. |
| `lectio_ramp_wpm` | 20 | wpm/min | How fast Lectio accelerates while sustained. |
| `lectio_max_wpm` | 700 | wpm | Ceiling. |
| `candle_interval` | 3 | verses | Checkpoint spacing, so death costs a verse or two, never a chapter. |
| `bonus_word_chance` | 0.15 | probability | Chance a verse offers a side-platform bonus word. |
| `master_volume` | 0.35 | gain | Default output gain. |
| `audio_default_on` | 0 | boolean | Audio starts muted. Browsers block autoplay and a beginner does not need a surprise. |
| `wpm_chars_per_word` | 5 | chars | The standard definition of a "word" for WPM. Do not change; it makes scores incomparable. |
| `history_max_sessions` | 500 | sessions | How much practice history is retained locally. |
