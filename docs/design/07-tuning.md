# Tuning

**Implemented by:** `core/sim.ts`, `core/damage.ts`, `core/curriculum.ts`, `core/rail.ts`

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
| `mastery_min_samples` | 20 | keystrokes | Hits on a key before earned fade-out may retire its overlay highlight. Without a floor, one lucky keystroke removes the crutch. |
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
| `smudge_per_error_step` | 1 | smudge | Added per stage, so tolerance narrows as skill grows -- but never past what the gate itself demands. See the ramp invariant in [pacing](03-pacing.md#the-ramp-must-not-outrun-the-gate). |
| `smudge_decay_per_key` | 3 | smudge | Removed per correct keystroke. Clean typing cleans the page. |
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
| `monster_burst_ms` | 320 | ms | How long a struck monster takes to burst and leave the screen. Feedback only -- nothing is at stake while it runs. |
| `strike_reach` | 36 | px | How far beyond the scribe a monster stands, so a blow has a gap to cross. Derived placement put it exactly where he arrives, and standing in a monster is not a fight -- see [pacing](03-pacing.md#defeating-a-monster-must-read-as-an-action). |
| `stomp_ms` | 460 | ms | The whole stomp: the hop out, the landing on the skull, the bounce back. Longer than the ~430 ms a 140 WPM typist spends on a word, which is why strikes are a list rather than a slot. |
| `ink_ms` | 420 | ms | The whole ink throw: the flung nib's flight, and the burst it makes on the bat. |
| `monster_drop_chance` | 0.20 | probability | Chance a felled monster leaves an ink pot. |
| `combo_drop_bonus` | 0.20 | probability | Added to that chance at a full combo, scaling linearly from none. Losing the combo only returns the chance to its base; nothing is ever taken away. |
| `ink_pot_points` | 25 | points | What an ink pot is worth when the player's hearts are already full. Roughly half a fully gilded part (`gild_page_bonus`), because a pot is a small piece of luck and a finished page is work. See [pacing](03-pacing.md#an-ink-pot-at-full-hearts-must-still-be-worth-something). |
| `gild_score_per_char` | 2 | points | Awarded per greyed character typed correctly, in [gilding mode](01-illumination.md#gilding-a-mode-for-people-who-already-type). |
| `gild_page_bonus` | 50 | points | Awarded for a part in which every character was typed. |
| `gild_offer_wpm` | 60 | wpm | Pace at which the game *offers* gilding. Well above a beginner's ceiling and well below the fluent typist it is for; it only ever opens a dialogue, never a mode. |
| `gild_offer_sessions` | 3 | sessions | Consecutive sessions at that pace before the offer is made. One fast part is a short verse, not a fluent typist. |
| `bonus_word_chance` | 0.15 | probability | Chance a verse offers a side-platform bonus word. |
| `master_volume` | 0.35 | gain | Default output gain. |
| `audio_default_on` | 0 | boolean | Audio starts muted. Browsers block autoplay and a beginner does not need a surprise. |
| `wpm_chars_per_word` | 5 | chars | The standard definition of a "word" for WPM. Do not change; it makes scores incomparable. |
| `history_max_sessions` | 500 | sessions | How much practice history is retained locally. |
| `report_trend_parts` | 20 | parts | How many finished parts the report card's curve shows. Enough to see the shape of a fortnight; few enough that one bar is still wide enough to read. |
| `report_finger_min_hits` | 12 | keystrokes | Hits a finger needs before its mean latency is treated as a signal rather than noise. Below this, one slow reach for a rare key would libel a finger. |
| `report_reach_ratio` | 2.0 | ratio | How many times the quickest finger's mean latency a finger must take before the card calls it a finger being *reached for* rather than rested on. This is the two-finger signature the card exists to make visible, and it is the one thing about technique the game can honestly observe. |
| `report_key_min_attempts` | 12 | attempts | Attempts on a key before its error rate is worth naming as the next thing to work on. |
| `report_worst_key_rate` | 0.12 | fraction | Error rate at which a key becomes the one thing the card asks the player to work on next. Below it the card looks for a finger instead. |
| `first_run_note_keys` | 8 | keystrokes | Correct keystrokes a [first-run note](10-first-run.md#2-then-straight-into-typing-with-three-notes-that-fire-once-each) stays under the rail before it leaves. It is a count of keystrokes rather than a duration because the note is dismissed by *continuing to type*: a clock would take the sentence away from the one player who stopped to read it, and at a beginner's pace eight keystrokes is roughly ten seconds. |
