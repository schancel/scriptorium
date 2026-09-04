/**
 * Shared type definitions for the pure core.
 *
 * @doc docs/architecture/core-purity.md#the-injected-seams
 *
 * These typedefs are the contract between every core module and, later, the
 * spec a Dart port is translated from -- each typedef becomes a Dart class
 * almost line for line. See docs/architecture/porting-to-dart.md.
 *
 * This file contains no runtime code.
 */

// --- keys and fingers -------------------------------------------------------

/**
 * A key as the curriculum names it: a literal character, or an angle-bracketed
 * token for keys with no printable form.
 * @typedef {string} Key
 */

/**
 * @typedef {'lp'|'lr'|'lm'|'li'|'lt'|'rt'|'ri'|'rm'|'rr'|'rp'} Finger
 * Left/right + pinky/ring/middle/index/thumb. The report card groups by this.
 */

/** @typedef {'ansi'|'iso'} KeyboardLayout */

// --- text and illumination --------------------------------------------------

/**
 * One chunk of source text: a verse, or a paragraph in an imported book.
 * @typedef {object} Unit
 * @property {string} text
 * @property {number} number   1-based position within its section
 */

/**
 * @typedef {object} Passage
 * @property {string} ref      canonical reference, e.g. "Genesis 1"
 * @property {string} book
 * @property {number} chapter
 * @property {Unit[]} units
 */

/**
 * A single character of the displayed text, classified against the current
 * stage. See docs/design/01-illumination.md#classification.
 * @typedef {object} Glyph
 * @property {string} ch        the character as printed
 * @property {boolean} live     true if the player must type it
 * @property {Key|null} key     the key required, or null when greyed
 * @property {Finger|null} finger
 */

// --- typing -----------------------------------------------------------------

/**
 * @typedef {object} KeyStat
 * @property {number} hits
 * @property {number} errors
 * @property {number} totalMs    summed latency of hits, for the mean
 * @property {number[]} latencies  retained samples, for the median
 * @property {Object<string, number>} confusions  what was struck instead
 */

/**
 * @typedef {object} TypingState
 * @property {Glyph[]} glyphs
 * @property {number} cursor          index into glyphs
 * @property {number} keystrokes      every keypress, corrections included
 * @property {number} correct
 * @property {number} elapsedMs       time spent typing this passage
 * @property {number} sinceKeyMs      time since the last keystroke; drives the cloud
 * @property {Object<Key, KeyStat>} keyStats
 * @property {boolean} blocked        true when the last keystroke was wrong
 */

/**
 * @typedef {object} Score
 * @property {number} wpm
 * @property {number} accuracy       0..1
 * @property {number} medianLatencyMs
 */

// --- curriculum -------------------------------------------------------------

/**
 * @typedef {object} Stage
 * @property {number} stage
 * @property {Key[]} keys            introduced at this stage
 * @property {Key[]} keySet          cumulative: everything typable now
 * @property {number} predictedCoverage
 * @property {string} description
 */

/**
 * @typedef {object} GateResult
 * @property {boolean} passed
 * @property {boolean} accuracyMet
 * @property {boolean} latencyMet
 * @property {number} samples        keystrokes on the new keys so far
 */

// --- world ------------------------------------------------------------------

/** @typedef {'title'|'level'|'flashback'|'report'|'map'|'lectio'} Mode */

/**
 * @typedef {object} CloudState
 * @property {'absent'|'approaching'|'striking'} phase
 * @property {number} phaseMs
 * @property {number} x
 */

/**
 * @typedef {object} DamageState
 * @property {number} hearts
 * @property {number} smudge         0..tuning.smudge_max
 * @property {number} combo
 */

/**
 * @typedef {object} RailState
 * @property {number} offset         current ribbon scroll, in virtual px
 * @property {number} targetOffset   where it is easing toward
 */

/**
 * A saved position to return to when a flashback ends.
 * @typedef {object} ReturnFrame
 * @property {string} ref
 * @property {number} cursor
 * @property {DamageState} damage
 */

/**
 * The whole simulation. `sim.step` is a pure function of this plus inputs.
 * @typedef {object} GameState
 * @property {Mode} mode
 * @property {number} stage
 * @property {Passage} passage
 * @property {TypingState} typing
 * @property {DamageState} damage
 * @property {CloudState} cloud
 * @property {RailState} rail
 * @property {ReturnFrame[]} returnStack
 * @property {string[]} inventory
 * @property {string} theme
 * @property {number} rngState       the seeded PRNG's state; never ambient
 * @property {number} elapsedMs
 */

// --- injected seams ---------------------------------------------------------

/**
 * @typedef {object} InputEvent
 * @property {'key'|'command'} type
 * @property {string} value          the character typed, or a command name
 */

/**
 * Tuning values, compiled from docs/design/07-tuning.md.
 * @typedef {Object<string, number>} Tuning
 */

// --- output: display list ---------------------------------------------------

/**
 * A frame, as data. The core never draws; the platform executes these in order.
 * See docs/architecture/display-list.md.
 *
 * @typedef {object} DrawCmd
 * @property {'sprite'|'tile'|'text'|'rect'|'line'} op
 * @property {string} [id]
 * @property {string} [value]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [w]
 * @property {number} [h]
 * @property {number} [x1]
 * @property {number} [y1]
 * @property {number} [x2]
 * @property {number} [y2]
 * @property {number} [frame]
 * @property {boolean} [flip]
 * @property {number} [color]        palette index, never a CSS string
 * @property {number} [tint]
 * @property {number} [alpha]
 * @property {number} [width]
 * @property {string} [style]
 */

/**
 * @typedef {object} SoundEvent
 * @property {'note'|'sfx'|'tempo'} type
 * @property {'pulse1'|'pulse2'|'triangle'|'noise'} [ch]
 * @property {number} [midi]
 * @property {number} [vel]
 * @property {number} [ms]
 * @property {number} [duty]
 * @property {number[]} [arp]
 * @property {number} [arpHz]
 * @property {string} [id]
 * @property {number} [ratio]
 */

export {};
