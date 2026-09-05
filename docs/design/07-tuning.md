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
| `overlay_retired_alpha` | 0.15 | fraction | How far the whole keyboard overlay recedes once every key of the stage has earned its fade-out, so [the scribe at his lectern](02-rail.md#the-scribe-at-his-lectern) comes up behind it. Never zero, and never applied a key at a time: the board must stay a true picture of the keys under the player's hands, so it fades as a whole rather than developing holes. |
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
| `lectio_start_words_per_min` | 180 | words/min | Opening pace in [reading mode](02-rail.md#reading-mode), in **whole words shown, one at a time**. Not the `wpm_chars_per_word` definition every other rate in this table uses: reading mode displays words, so it counts them, and 180 here is 180 words on the screen in a minute. The rows keep the internal name; the player is only ever shown "Reading". |
| `lectio_ramp_words_per_min` | 20 | words/min per min | How fast the pace climbs while the reading is sustained. |
| `lectio_max_words_per_min` | 700 | words/min | Ceiling. |
| `lectio_pace_step` | 40 | words/min | What one press of the pace control moves the pace by, in either direction. It moves the *ramp clock* rather than sitting on top of it, so a pace the player has come down to stays come down and then climbs again from there -- see [coming back down](02-rail.md#coming-back-down). Small enough that one press is an adjustment; large enough that a reader who has overshot does not have to press it nine times. |
| `lectio_comma_hold` | 1.5 | ratio | How much longer a word ending in a comma, semicolon, colon or dash holds, as a multiple of one word's beat. |
| `lectio_stop_hold` | 2.5 | ratio | The same, for a word that ends a sentence or ends a verse. A sentence that ended should feel like it ended, and at 700 words a minute a beat and a half is 90 ms -- which is the difference between prose and a list of words. |
| `candle_interval` | 3 | verses | Checkpoint spacing, so death costs a verse or two, never a chapter. |
| `monster_burst_ms` | 320 | ms | How long a struck monster takes to burst and leave the screen. Feedback only -- nothing is at stake while it runs. |
| `strike_reach` | 36 | px | How far beyond the scribe a monster stands, so a blow has a gap to cross. Derived placement put it exactly where he arrives, and standing in a monster is not a fight -- see [pacing](03-pacing.md#defeating-a-monster-must-read-as-an-action). |
| `stomp_ms` | 460 | ms | The whole stomp: the hop out, the landing on the skull, the bounce back. Longer than the ~430 ms a 140 WPM typist spends on a word, which is why strikes are a list rather than a slot. |
| `ink_ms` | 420 | ms | The whole ink throw: the flung nib's flight, and the burst it makes on the bat. |
| `strike_hop_px` | 12 | px | How high the scribe's leap arcs above the ground line when he stomps. The size of the leap is what makes a felled monster read as something that was *done to* rather than stood next to, and it is the first number to turn if it does not. |
| `strike_contact_px` | 7 | px | How high he is at the moment of contact, so he lands on top of the skull rather than through it. Keep it below `strike_hop_px` or the blow rises into the landing instead of dropping onto it. |
| `strike_bounce_ratio` | 0.6 | ratio | The bounce off the skull, as a fraction of `strike_hop_px`. Below 1 so the bounce arcs lower than the leap did, which is what makes the second arc read as a rebound. |
| `strike_nib_arc_px` | 14 | px | How high the thrown nib arcs on its way to the bat. At zero it slides across the gap in a straight line; the arc is what says it was thrown. |
| `strike_rise_travel` | 0.7 | fraction | How far across the gap to the monster the leap carries him before the contact frame takes over the rest. Low and he floats in and drops on it; near 1 and he arrives flat. |
| `monster_drop_chance` | 0.20 | probability | Chance a felled monster leaves an ink pot. |
| `combo_drop_bonus` | 0.20 | probability | Added to that chance at a full combo, scaling linearly from none. Losing the combo only returns the chance to its base; nothing is ever taken away. |
| `ink_pot_points` | 25 | points | What an ink pot is worth when the player's hearts are already full. Roughly half a fully gilded part (`gild_page_bonus`), because a pot is a small piece of luck and a finished page is work. See [pacing](03-pacing.md#an-ink-pot-at-full-hearts-must-still-be-worth-something). |
| `gild_score_per_char` | 2 | points | Awarded per greyed character typed correctly, in [gilding mode](01-illumination.md#gilding-a-mode-for-people-who-already-type). |
| `gild_page_bonus` | 50 | points | Awarded for a part in which every character was typed. |
| `gild_offer_wpm` | 60 | wpm | Pace at which the game *offers* gilding. Well above a beginner's ceiling and well below the fluent typist it is for; it only ever opens a dialogue, never a mode. |
| `gild_offer_sessions` | 3 | sessions | Consecutive sessions at that pace before the offer is made. One fast part is a short verse, not a fluent typist. |
| `bonus_word_chance` | 0.15 | probability | Chance a verse offers a side-platform bonus word. |
| `master_volume` | 0.35 | gain | Default output gain. |
| `audio_default_on` | 1 | boolean | Audio starts on. The context is opened on the player's first keystroke, which is a user gesture and so is permitted where autoplay is not — see [music](09-music.md#audio-is-on-and-starts-on-the-first-keystroke). The toggle is how it goes off. |
| `wpm_chars_per_word` | 5 | chars | The standard definition of a "word" for WPM. Do not change; it makes scores incomparable. |
| `history_max_sessions` | 500 | sessions | How much practice history is retained locally. |
| `report_trend_parts` | 20 | parts | How many finished parts the report card's curve shows. Enough to see the shape of a fortnight; few enough that one bar is still wide enough to read. |
| `report_finger_min_hits` | 12 | keystrokes | Hits a finger needs before its mean latency is treated as a signal rather than noise. Below this, one slow reach for a rare key would libel a finger. |
| `report_reach_ratio` | 2.0 | ratio | How many times the quickest finger's mean latency a finger must take before the card calls it a finger being *reached for* rather than rested on. This is the two-finger signature the card exists to make visible, and it is the one thing about technique the game can honestly observe. |
| `report_key_min_attempts` | 12 | attempts | Attempts on a key before its error rate is worth naming as the next thing to work on. |
| `report_worst_key_rate` | 0.12 | fraction | Error rate at which a key becomes the one thing the card asks the player to work on next. Below it the card looks for a finger instead. |
| `first_run_note_keys` | 8 | keystrokes | Correct keystrokes a [first-run note](10-first-run.md#2-then-straight-into-typing-with-three-notes-that-fire-once-each) stays under the rail before it leaves. It is a count of keystrokes rather than a duration because the note is dismissed by *continuing to type*: a clock would take the sentence away from the one player who stopped to read it, and at a beginner's pace eight keystrokes is roughly ten seconds. |
| `scene_blend_verses` | 2 | verses | Width of the window a scene change's colour eases across, centred on the boundary verse. The tiles cut at the boundary; the palette moves over this many verses around it, driven by how far through them the player has typed and never by a clock. At zero the world changes between one verse and the next; much above three and Genesis 1 is one long crossfade with no places in it. See [scenery](05-scenery-warps.md#between-two-scenes-the-palette-moves-and-the-tiles-cut). |
| `follower_spacing_px` | 20 | px | Gap between two figures in the line walking behind the scribe. Wider than the 16px sprite, so no two overlap; much wider and the line runs off the left of the screen before the cap is reached. See [followers](11-followers.md#the-cap-and-what-is-shown-instead). |
| `follower_line_max` | 6 | figures | How many followers walk. Past this the earliest on the route walk on ahead and a count stands at the tail of the line instead -- a screen filling with figures is scenery competing with the text it exists to serve. |
| `follower_walk_ms` | 120 | ms | Frame duration of a follower's two-frame walk, and the stagger between one figure and the next, so the line does not march in lockstep. It matches the scribe's own stride because they are walking with him. |
| `reduced_parallax` | 0 | ratio | What the parallax layers' own depths are multiplied by in [reduced motion](12-motion-and-comfort.md#what-reduced-motion-changes). Zero freezes them, which is the intended value: three layers scrolling at differing rates is the strongest part of the stimulus and the least load-bearing part of the picture. Raise it toward 1 for a near-freeze if a frozen world ever reads as broken rather than as still. |
| `reduced_anim_scale` | 0.35 | ratio | What a set piece's own clock is multiplied by in reduced motion -- flame, smoke, swell, drift, and the flicker of a candle. Eased down rather than removed: a flourish is brief, it is what the passage looks like, and a picture that stopped entirely would be losing the scenery to fix the scrolling. |
| `reduced_camera_lerp` | 0.5 | fraction | How much of the remaining distance the world closes each frame in reduced motion, against `rail_scroll_lerp`'s quarter. Half settles a stride in about four frames, which reads as a step rather than a slide and still leaves the scribe long enough to be seen walking. At 1 the world teleports and he never walks. |
