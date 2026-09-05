/**
 * Boot the real compiled bundle and assert the game actually works.
 *
 * The unit tests never touch platform/web/, and a deployment is not tested at
 * all -- so a change that leaves core/ perfectly green can still ship a game
 * that renders nothing, loads no text, or plays in silence. One did: a deploy
 * path change made every data fetch 404, the game fell back to a five-verse
 * stub with no themes and therefore no audio, and it looked entirely correct
 * for hours. See docs/decisions/0009-fallbacks-must-announce-themselves.md.
 *
 * This drives build/platform/web/main.js under a DOM stub, types what the game
 * itself asks for, and asserts the properties that bug would have broken.
 *
 * It now also drives the two screens whose whole content is assembled in the
 * platform, and which a core test can therefore only ever see as a data
 * structure that nobody proved reached a player: **the map** -- where he is,
 * what is finished, what is locked and why, what the counter promises, and the
 * fact that a room he has not found is not listed while a room he has is -- and
 * **reading mode**, which asks for nothing, so the only way to know it works is
 * to watch it not ask. Plus the choice between the two translations, which is a
 * fetch, a reclassification and a rebuilt part, none of it reachable from core.
 *
 * Usage: node tools/smoke.mjs        (after `make build`)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const calls = {
  fillText: [], lines: [], fills: [], sprites: [], clips: [], fillRect: 0, stroke: 0, ready: null,
};
// Every (verse, sky colour) the game has drawn while standing in Genesis 1.
// The scenery is the one thing in the game a unit test can only ever see as a
// display list: `core/scenes.test.ts` proves the *resolver* returns seven
// different places, and this proves the player is actually shown them.
const genesisSky = [];
// Every string the game has drawn since it booted, kept across frames. The
// per-frame lists above are cleared by `tick`, and the tone sweep at the foot
// of this file needs the whole run rather than the last sixteen milliseconds.
const everSaid = new Set();

class Ctx2D {
  constructor() {
    this.font = ''; this.textAlign = ''; this.textBaseline = '';
    this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 1; this.globalAlpha = 1;
    this.imageSmoothingEnabled = true;
  }
  setTransform() {} translate() {} scale() {}
  // The clip stack, because it is the one thing that tells a *sprite* draw from
  // a *tile* draw: `canvas_renderer.ts` fills a band by clipping to it and
  // repeating one 16x16 image, and both end up in `drawImage`. Followers are
  // sprites, and a band of grass is not one.
  save() { this._clips = this._clips ?? []; this._clips.push(this._clipped === true); }
  restore() { this._clipped = (this._clips ?? []).pop() === true; }
  clearRect() {}
  fillRect(x, y, w, h) { calls.fillRect += 1; calls.fills.push({ x, y, w, h, color: this.fillStyle }); }
  // The clip rect is the only place a *parallax* band's position surfaces:
  // `canvas_renderer.ts` fills one by clipping to the command's rect and
  // repeating a 16x16 image inside it, so the rect's x is the layer's scroll
  // phase and nothing else in the frame produces one. That is what makes
  // "the parallax froze" an assertion rather than a screenshot.
  beginPath() {} rect(x, y, w, h) { this._rect = { x, y, w, h }; }
  clip() { this._clipped = true; if (this._rect) calls.clips.push(this._rect); }
  // The caret and the focal guide are lines, and "the eyes never move" is a
  // claim about exactly where they are drawn -- so they are recorded rather
  // than counted.
  moveTo(x, y) { this._pen = [x, y]; }
  lineTo(x, y) {
    const [px, py] = this._pen ?? [x, y];
    calls.lines.push({ x1: px, y1: py, x2: x, y2: y });
  }
  stroke() { calls.stroke += 1; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData() {}
  // Where every 16x16 sprite landed. Flipped sprites are drawn through a
  // translated transform and arrive here at (0, 0); nothing the followers do is
  // flipped, so they are filtered out by position rather than tracked.
  drawImage(_img, x, y) { if (this._clipped !== true) calls.sprites.push({ x, y }); }
  fillText(v, x, y) {
    const text = String(v);
    calls.fillText.push({ v: text, x, y, style: this.font, color: this.fillStyle });
    // The rail is the Bible, drawn a glyph at a time, and the Bible is not ours
    // to hold to a house style -- it has exclamation marks in it. Everything
    // else on the canvas is the game speaking, and is swept below.
    if (text.length > 1 && !this.font.includes('17px')) everSaid.add(text);
  }
  measureText(t) { return { width: String(t).length * 6 }; }
}
class CanvasShim {
  constructor() { this.width = 0; this.height = 0; this.clientWidth = 1280; this.clientHeight = 720; this._c = new Ctx2D(); }
  getContext() { return this._c; }
}
const canvas = new CanvasShim();
const listeners = {};
const elements = new Map();
function stubEl(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id, hidden: true, textContent: '', value: '', disabled: false, checked: false,
      style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      // Real listeners, so a panel can be driven the way a player drives it:
      // by pressing the control, not by calling the handler behind it.
      _l: new Map(),
      addEventListener(t, h) { const l = this._l.get(t) ?? []; l.push(h); this._l.set(t, l); },
      removeEventListener(t, h) { this._l.set(t, (this._l.get(t) ?? []).filter((f) => f !== h)); },
      dispatchEvent(e) { for (const h of this._l.get(e.type) ?? []) h(e); return true; },
      appendChild(c) { this.children.push(c); return c; },
      append(...c) { this.children.push(...c); },
      prepend(...c) { this.children.unshift(...c); },
      replaceChildren(...c) { this.children = c; },
      removeChild() {}, remove() {}, insertBefore(c) { this.children.push(c); return c; },
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      cloneNode() { return stubEl(`${id}-clone`); }, closest: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      focus() {}, blur() {}, click() { this.dispatchEvent({ type: 'click', preventDefault() {} }); },
      scrollIntoView() {},
      dataset: {}, options: [], children: [], firstChild: null, parentNode: null,
      selectedIndex: 0, min: '', max: '', step: '', type: '', name: '', title: '',
      innerHTML: '', innerText: '', ariaLabel: '',
    });
  }
  return elements.get(id);
}
globalThis.HTMLCanvasElement = CanvasShim;
// main.ts narrows elements with `instanceof`, so every constructor it names
// must exist. Our stub elements are plain objects, and everything is an
// instanceof Object, so Object is a sufficient stand-in for all of them.
for (const name of [
  'HTMLElement', 'HTMLButtonElement', 'HTMLSelectElement', 'HTMLInputElement',
  'HTMLDivElement', 'HTMLParagraphElement', 'HTMLSpanElement', 'HTMLLabelElement',
  'HTMLOListElement', 'HTMLUListElement', 'HTMLLIElement', 'HTMLFieldSetElement',
  'HTMLAnchorElement', 'HTMLHeadingElement', 'HTMLFormElement', 'HTMLDialogElement',
  'HTMLTextAreaElement', 'HTMLTableElement', 'HTMLImageElement',
]) globalThis[name] = Object;
globalThis.document = {
  getElementById: (id) => (id === 'stage' ? canvas : stubEl(id)),
  createElement: (t) => {
    if (t === 'canvas') return new CanvasShim();
    const el = stubEl(`new-${t}-${Math.random()}`);
    el.tagName = String(t).toUpperCase();
    return el;
  },
  body: { classList: { add: (c) => { calls.ready = c; }, remove() {}, toggle() {} } },
  // A backgrounded tab is a real state of a real browser, and the game has to
  // come back from it. See the audio recovery assertions below.
  visibilityState: 'visible',
  addEventListener: (t, h) => { (listeners[t] ??= []).push(h); },
  removeEventListener: (t, h) => { listeners[t] = (listeners[t] ?? []).filter((f) => f !== h); },
  querySelectorAll: () => [],
};
globalThis.window = {
  addEventListener: (t, h) => { (listeners[t] ??= []).push(h); },
  // Detaching has to work, or the game cannot put a panel up: `main.ts` takes
  // the keyboard away before every dialogue so the next keystroke does not go
  // into the rail behind it. Without this the harness could never reach a
  // promotion, a report card or the map.
  removeEventListener: (t, h) => { listeners[t] = (listeners[t] ?? []).filter((f) => f !== h); },
  devicePixelRatio: 2, matchMedia: () => ({ matches: false, addEventListener() {} }),
};
globalThis.self = globalThis.window;
globalThis.devicePixelRatio = 2;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
// The audio device, and what it was asked to play.
//
// Audio ships **on** and the platform opens the context on the player's first
// keystroke, so this shim is now exercised by an ordinary run rather than only
// by a click on the toggle. It has to behave like the real thing where
// `web_audio.ts` leans on it: `connect` returns its destination, because the
// noise voice chains `noise.connect(filter).connect(gain)`, and an AudioParam
// carries the full schedule API.
const audio = { contexts: 0, started: 0, notes: 0, ctx: null };
function shimParam(value = 0) {
  return {
    value,
    setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
  };
}
function shimNode(extra = {}) {
  return { connect: (to) => to, disconnect() {}, start() {}, stop() {}, ...extra };
}
class AudioCtxShim {
  constructor() {
    this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.sampleRate = 48000;
    audio.contexts += 1;
    audio.ctx = this;
  }
  createGain() { return shimNode({ gain: shimParam(1) }); }
  createOscillator() {
    audio.notes += 1;
    return shimNode({ frequency: shimParam(), type: 'square', setPeriodicWave() {} });
  }
  createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }
  createBufferSource() { audio.notes += 1; return shimNode({ buffer: null }); }
  createBiquadFilter() { return shimNode({ type: '', frequency: shimParam(), Q: shimParam() }); }
  createPeriodicWave() { return {}; }
  resume() { this.state = 'running'; audio.started += 1; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
globalThis.AudioContext = AudioCtxShim; globalThis.webkitAudioContext = AudioCtxShim;

// Set the moment anything clicks the sound toggle. Nothing does, and the
// assertions about the music starting are worth nothing unless that is checked
// rather than assumed.
let audioToggled = false;
const audioToggle = stubEl('audio-toggle');
audioToggle.addEventListener('click', () => { audioToggled = true; });

let rafCb = null, frames = 0;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; frames += 1; return frames; };
globalThis.cancelAnimationFrame = () => {};
globalThis.fetch = async (url) => {
  const p = String(url).startsWith('file:') ? fileURLToPath(String(url)) : String(url);
  try {
    const body = await readFile(p, 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, text: async () => '', json: async () => { throw new Error('404'); } };
  }
};

// --- drive ------------------------------------------------------------------

await import(pathToFileURL(resolve(ROOT, 'build/platform/web/main.js')).href);
await new Promise((r) => setTimeout(r, 400));

const step = (t) => { const cb = rafCb; rafCb = null; if (cb) cb(t); };
const settle = (n = 60, base = 0) => { for (let i = 0; i < n; i++) step(base + i * 16); };
const press = (k) => (listeners.keydown ?? []).forEach((h) =>
  h({ key: k, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }));

const rail = () => calls.fillText.filter((c) => c.style.includes('17px'));

// The scenery band is the full-width rect the world is painted on: virtual
// (0, 22) to (640, 114), between the HUD and the rail. Its fill is the theme's
// `shade` role resolved through `core/worlds.ts`, which is exactly what changes
// when the world changes -- including mid-transition, when the theme id on the
// command is a blend of two palettes.
const SKY = { x: 0, w: 640, h: 92 };
const skyColour = () => calls.fills.find(
  (f) => f.x === SKY.x && f.w === SKY.w && f.h === SKY.h,
)?.color ?? null;

/**
 * Record where the player is standing and what colour the world is there.
 *
 * The verse comes off the HUD, which now names the stretch he is typing by its
 * citation -- `Genesis 1:13-15` -- rather than by an invented `part 4/9`. So the
 * number keyed on here is the *first verse of the stretch*, which is the only
 * verse number on the screen. That is enough: the scenery is still resolved per
 * verse and blended between, so the sky moves within a stretch as well as
 * across one, and the beginning of the chapter and the end of it are two
 * different stretches. docs/design/03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing
 */
function sampleScene() {
  const sky = skyColour();
  if (sky === null) return;
  const ref = calls.fillText.map((c) => c.v).find((v) => /^Genesis 1:\d+/.test(v));
  if (!ref) return;
  const verse = Number(/^Genesis 1:(\d+)/.exec(ref)?.[1]);
  if (Number.isInteger(verse)) genesisSky.push({ verse, sky, ref });
}

const frameNow = () => {
  calls.fillText = []; calls.lines = []; calls.fills = []; calls.sprites = [];
  calls.clips = [];
  step(1000 + frames * 16);
  sampleScene();
};

settle(); frameNow();

// What key does the game itself say it wants? Reading the hint back means the
// harness never has to know the passage, the stage, or the curriculum.
function wanted() {
  const hint = calls.fillText.find((c) => c.v.startsWith('next:'));
  if (!hint) return null;
  const name = hint.v.replace(/^next:\s*/, '').replace(/\s*\(.*$/, '').trim();
  if (name === 'space') return ' ';
  if (name.length === 1) return name;
  return null;
}

const fails = [];
const ok = (cond, label, detail = '') => {
  if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail && !cond ? ` — ${detail}` : ''}`);
};

console.log('smoke: booting the compiled bundle\n');

// boot() catches its own failures into the #boot banner rather than throwing,
// so read it: without this the harness reports six blank failures and no cause.
const bootMsg = String(stubEl('boot').textContent ?? '');
ok(!bootMsg.startsWith('could not start'), 'boot did not fail', bootMsg);
ok(calls.ready === 'ready', 'the page reaches its ready state');
ok(frames > 1, 'the frame loop is running', `frames=${frames}`);
ok(rail().length > 0, 'the rail draws glyphs', `${rail().length} glyphs`);
ok(calls.fillRect > 0 && calls.stroke > 0, 'the renderer executes rect and line commands');

// ADR 0009: if this banner is up, the game is running on fallbacks.
const banner = calls.fillText.find((c) => c.v.includes('NOT THE REAL DATA'));
ok(!banner, 'real data loaded (no fallback banner)',
   banner ? calls.fillText.filter((c) => c.v.includes('fallback')).map((c) => c.v).join(' ') : '');

// The rail's whole point (docs/design/02-rail.md): the reading position never
// moves. Type what the game asks for and check the glyph grid stays anchored to
// the focal column. We test alignment rather than "a glyph sits at 320",
// because the character under the cursor is often a space -- which draws as a
// bar, not as text -- so the focal cell is legitimately empty of glyphs.
const FOCAL = 320;
const CELL = 12;
const offsets = new Set();
let typed = 0;
let sawGlyphs = 0;
for (let i = 0; i < 14; i++) {
  for (const c of rail()) {
    offsets.add(((Math.round(c.x - FOCAL) % CELL) + CELL) % CELL);
    sawGlyphs += 1;
  }
  const k = wanted();
  if (k === null) break;
  press(k); typed += 1; settle(8, 2000 + i * 200); frameNow();
}
ok(typed >= 8, 'the game accepts the keys it asks for', `typed ${typed}`);
ok(sawGlyphs > 50, 'glyphs kept being drawn while typing', `${sawGlyphs} samples`);
ok(offsets.size === 1 && offsets.has(0), 'the reading column never drifts',
   `grid offsets from focal x: ${[...offsets].join(', ')}`);

ok(store.size > 0, 'progress is written to storage');

// --- the HUD names the text, not our machinery -------------------------------
//
// It read `Genesis 1:1  part 1/11`, and `part 1/11` is a number about the way we
// chunk a chapter that the player has no way to check against the page in front
// of him. The owner: "Why not verses and chapters or something?" So the HUD
// carries the citation of the stretch he is typing and nothing else.
// docs/design/03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing
const hudRef = calls.fillText.map((c) => c.v).find((v) => /^Genesis 1[:\d-]/.test(v));
ok(/^Genesis 1:\d+(-\d+)?$/.test(String(hudRef)),
   'THE HUD NAMES A VERSE RANGE, NOT A PART', String(hudRef));
ok(!/\bpart\b/i.test(calls.fillText.map((c) => c.v).join(' ')),
   'and the word "part" is nowhere on the screen',
   calls.fillText.map((c) => c.v).find((v) => /\bpart\b/i.test(v)) ?? '');


// --- the company walking behind him ------------------------------------------
//
// docs/design/11-followers.md. `core/followers.test.ts` proves the derivation,
// the cap and the geometry of the display list; none of that says a figure ever
// reached the screen, because the party is assembled in the platform out of the
// record and handed to the frame. So this reads the canvas: where a 16x16 sprite
// was actually drawn, and whether one turned up when a passage was finished.
//
// A follower is the one thing in the game drawn as *two* sprites at exactly the
// same place -- a body and the mark it carries -- at a whole multiple of
// `follower_spacing_px` behind the scribe. That signature is what is counted.
const TUNING_ROWS = JSON.parse(await readFile(resolve(ROOT, 'data/tuning.json'), 'utf8')).values;
const SPACING = TUNING_ROWS.follower_spacing_px;
const CAP = TUNING_ROWS.follower_line_max;
// The scribe stands over the focal point, half a sprite to the left of it.
const SCRIBE_X = FOCAL - 8;
const RAIL_BAND_TOP = 114;

/** Every follower drawn this frame: body and mark, at one of the line's places. */
function figuresDrawn() {
  const drawn = calls.sprites;
  const found = [];
  for (let i = 1; i < drawn.length; i++) {
    const a = drawn[i - 1];
    const b = drawn[i];
    if (a.x !== b.x || a.y !== b.y) continue;
    const back = (SCRIBE_X - a.x) / SPACING;
    if (back >= 1 && Number.isInteger(back)) { found.push(a); i += 1; }
  }
  return found;
}

frameNow();
const figuresAtStart = figuresDrawn().length;
ok(figuresAtStart === 0, 'nobody walks behind a player who has finished nothing',
   `${figuresAtStart} figures`);

// --- the route, the crossing and the reading mode ----------------------------
//
// Everything above this line was true before the route was wired up. These are
// the parts a core test cannot reach: `core/route.ts`, `core/warp.ts` and
// `core/lectio.ts` were all fully tested and called by nothing, which is the
// exact failure mode this file exists for -- green tests over unreachable code.
//
// The claim worth guarding is one pixel wide. During a crossing the echoed
// phrase must not move, and `core/crossing.test.ts` asserts that of the display
// list. Here it is asserted of the *running game*: the platform plans the warp,
// swaps the ribbon under it, dissolves one world into another, and the drawn
// column of every glyph of the phrase has to come out the same every frame.

const panel = (id) => stubEl(id).hidden === false;
const refText = () => calls.fillText.map((c) => c.v).find((v) => /^\w.*\d+:\d+/.test(v)) ?? '';
const railAt = () => calls.fillText.filter((c) => c.style.includes('17px'))
  .map((c) => `${c.v}@${Math.round(c.x)}`).join(',');
const rowsOf = (id) => stubEl(id).children;
const textOf = (li) => li.children.map((c) => String(c.textContent)).join(' | ');
/**
 * Wait for the game to actually get somewhere.
 *
 * Opening a part is asynchronous -- the platform fetches the book -- so a fixed
 * sleep is a race, and a lost race here shows up as the harness pressing Enter
 * into a report card that has already gone and skipping a chunk it never typed.
 * Drive frames and watch the screen instead.
 */
async function waitFor(pred, tries = 120) {
  for (let i = 0; i < tries; i++) {
    tick(2);
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

/** The key the game is asking for, capitals included. Null when it asks nothing. */
function askedFor() {
  const hint = calls.fillText.find((c) => c.v.startsWith('next:'));
  if (!hint) return null;
  const parts = hint.v.replace(/^next:\s*/, '').split('+').map((t) => t.trim());
  const last = parts[parts.length - 1].replace(/\s*\(.*$/, '').trim();
  const ch = last === 'space' ? ' ' : last;
  if (ch.length !== 1) return null;
  return parts.length > 1 ? ch.toUpperCase() : ch;
}

let clock = 5000;
function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    calls.fillText = []; calls.lines = []; calls.fills = []; calls.sprites = [];
    calls.clips = [];
    step(clock += 16);
    sampleScene();
  }
}

/** The caret: the one vertical line in a frame. Null when nothing is being asked for. */
function caretX() {
  const up = calls.lines.filter((l) => l.x1 === l.x2);
  return up.length === 0 ? null : up[0].x1;
}

/**
 * The state of the audio device the first time the player pressed a key with
 * nothing over the rail -- his first keystroke of ordinary play.
 *
 * Taken here rather than asserted here, because the assertion belongs beside
 * the other things a finished passage proves and this is the only place that
 * can see the moment.
 */
let audioAtFirstKey = null;

/** Type this stretch of verses out and stop, with the report card up. */
async function typeOutPart() {
  for (let i = 0; i < 4000; i++) {
    const k = askedFor();
    if (k === null) break;
    press(k);
    tick();
    // The opening screen is dismissed with Enter, so a press before that is a
    // press the game never saw. This is the first one it did.
    if (audioAtFirstKey === null && !panel('panel-first-run')) {
      audioAtFirstKey = { ...audio, toggled: audioToggled };
    }
  }
  tick(2);
}

/** Take whatever screen is up forward, however many panels are stacked on it. */
async function takeCardForward() {
  // Enter is the forward action at the report card. A promotion or the gilding
  // offer may be over the top of it; each is one button.
  press('Enter');
  await waitFor(() => askedFor() !== null || panel('panel-promotion') || panel('panel-gild'));
  for (let i = 0; i < 3; i++) {
    if (panel('panel-promotion')) {
      stubEl('promotion-ok').click();
      await waitFor(() => askedFor() !== null || panel('panel-gild'));
    }
    if (panel('panel-gild')) {
      stubEl('gild-no').click();
      await waitFor(() => askedFor() !== null);
    }
  }
  // Dismissing a promotion hands the keyboard back but leaves the report card
  // where it was -- the player still has to take it forward. So does the
  // harness, or it waits for a part that nobody asked the game to open.
  if (askedFor() === null) {
    press('Enter');
    await waitFor(() => askedFor() !== null);
  }
}

/** Type this part out, then take whatever screen comes next forward. */
async function finishPart() {
  await typeOutPart();
  await takeCardForward();
}

// Finish Genesis 1, which is what unlocks the thread to John 1. Typed, not
// forged into storage: the map has to agree with what the candle actually wrote.
let parts = 0;
for (; parts < 24; parts++) {
  await finishPart();
  const done = JSON.parse(store.get('scriptorium.progress') ?? '{}').completed ?? [];
  if (done.includes('Genesis 1')) break;
  if (askedFor() === null) break;
}
const record = () => JSON.parse(store.get('scriptorium.progress') ?? '{}');
ok((record().completed ?? []).includes('Genesis 1'),
   'a chapter typed to the end is recorded as completed',
   `after ${parts + 1} stretches of verses`);

// --- the music is on, and typing is what opened it ---------------------------
//
// It shipped muted behind a toggle in the corner of the screen that nobody
// found, and the owner played for hours without hearing one of the ten
// transcribed tunes: "Music should be on, I haven't yet heard anything." The
// autoplay block the mute was avoiding is answered by the gesture the player
// makes anyway -- a keystroke. Nothing in this harness has clicked the toggle,
// and that is asserted rather than assumed.
// docs/design/09-music.md#audio-is-on-and-starts-on-the-first-keystroke
ok(audioAtFirstKey !== null, 'the harness got as far as a first keystroke');
ok(audioAtFirstKey !== null && audioAtFirstKey.toggled === false,
   'nobody pressed the sound toggle');
ok(audioAtFirstKey !== null && audioAtFirstKey.contexts > 0 && audioAtFirstKey.started > 0,
   'AUDIO STARTS ON THE FIRST KEYSTROKE, WITH NOBODY PRESSING ANYTHING',
   audioAtFirstKey
     ? `${audioAtFirstKey.contexts} context(s), ${audioAtFirstKey.started} resume(s)`
     : '(never typed)');
ok(!audioToggled && audio.notes > 0,
   'and the tune is actually being sounded, not merely enabled',
   `${audio.notes} voice(s) started`);

// One passage finished, one figure walking. Not "some": exactly one, because a
// follower is a record of somewhere he has been and two of them would be the
// screen saying he had been there twice.
tick(4);
const firstLine = figuresDrawn();
ok(firstLine.length === 1, 'FINISHING A PASSAGE PUTS EXACTLY ONE FIGURE BEHIND HIM',
   `${firstLine.length} figures after finishing Genesis 1`);
ok(firstLine.every((f) => f.x < SCRIBE_X), 'AND HE WALKS BEHIND THE SCRIBE, NEVER AHEAD',
   firstLine.map((f) => `x=${f.x}`).join(', '));
ok(firstLine.every((f) => f.y + 16 <= RAIL_BAND_TOP),
   'AND NEVER REACHES DOWN INTO THE READING BAND',
   firstLine.map((f) => `y=${f.y}`).join(', '));
// On the ground line, which is where the scribe is: no floating, no flying.
const scribeFeet = calls.sprites.filter((c) => c.x === SCRIBE_X).map((c) => c.y);
ok(scribeFeet.length > 0 && firstLine.every((f) => scribeFeet.includes(f.y)),
   'and stands on the same ground the scribe stands on',
   `scribe y=${scribeFeet.join('/')} follower y=${firstLine.map((f) => f.y).join('/')}`);
// Nothing is written over him. The map names the company; the world does not.
const overhead = calls.fillText.filter(
  (c) => c.y > 22 && c.y + 4 < RAIL_BAND_TOP && firstLine.some((f) => Math.abs(c.x - f.x) < 16),
);
ok(overhead.length === 0, 'AND NOTHING IS WRITTEN OVER HIS HEAD',
   overhead.map((c) => c.v).join(' / '));

// --- and he arrives with a line ----------------------------------------------
//
// A figure appearing in the scenery band, unremarked, on a screen the player is
// not looking at, is an arrival that did not happen. So one sentence goes in the
// strip under the rail, in the same manner as a first-run note: once, gone as he
// types on, never again. docs/design/11-followers.md#arriving-with-a-line
//
// The strip is the reserved band immediately under the reading band: its text
// sits on the centre line of an 18px strip at `M.bandTop + M.bandH`.
const STRIP_Y = RAIL_BAND_TOP + 62 + 9;
const stripText = () => calls.fillText.filter((c) => c.y === STRIP_Y).map((c) => c.v);
const arrivalNow = () => stripText().find((v) => / walks with you\.$|acquired!$/.test(v));

const greeting = arrivalNow();
ok(greeting !== undefined, 'A FOLLOWER ARRIVES WITH A LINE, IN THE STRIP UNDER THE RAIL',
   greeting ?? `strip: ${stripText().join(' | ') || '(empty)'}`);
ok(greeting === 'Adam walks with you.',
   'and it names the figure the passage just handed over', String(greeting));

// Dismissed by continuing to type, and by nothing else: `first_run_note_keys`
// correct keystrokes, the same rule the coaching notes are held to.
const HOLD = TUNING_ROWS.first_run_note_keys;
for (let i = 0; i < HOLD + 2; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick();
}
ok(arrivalNow() === undefined, 'AND IT GOES AS HE TYPES ON',
   stripText().join(' | ') || '(empty)');

// And never comes back. Genesis 2 is not a passage the route names, so nothing
// joins while it is typed -- if the line returned here it would be the strip
// re-announcing a figure that has been walking behind him for a chapter.
let cameBack = null;
for (let i = 0; i < 200 && cameBack === null; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick();
  cameBack = arrivalNow() ?? null;
}
ok(cameBack === null, 'AND IT NEVER COMES BACK', cameBack ?? '');

// --- the world changes under him while he types Genesis 1 --------------------
//
// The owner's report was that Genesis 1 "is still a cavern or something, rather
// than like moving through space, to earth, to eden". The chapter is authored as
// seven scenes now -- void, light, the waters divided, dry land, the stars,
// living things, the garden -- and `core/scenes.test.ts` proves the resolver
// returns all seven. None of that says the player is *shown* them: the resolver
// is called by the platform, per frame, off the verse under the cursor, and a
// level that resolved its scenery once at chapter open would pass every unit
// test in the repository and still be a cavern. So this reads the colour the
// running game actually painted the sky, verse by verse, off the canvas.

const skyAt = (verse) => genesisSky.find((s) => s.verse === verse)?.sky ?? null;
const skies = new Set(genesisSky.map((s) => s.sky));
const versesSeen = new Set(genesisSky.map((s) => s.verse));
ok(genesisSky.length > 0 && versesSeen.size > 5,
   'the harness typed its way across Genesis 1',
   `${versesSeen.size} verses sampled`);
ok(skies.size >= 5, 'GENESIS 1 IS NOT ONE ROOM: THE WORLD CHANGES AS HE TYPES IT',
   `${skies.size} distinct skies over ${genesisSky.length} frames`);

// The one comparison the owner would make himself: the beginning against the
// end. The first stretch of the chapter opens on the formless void and the last
// one is the garden, and if those two paint the same sky then nothing above this
// line is reaching the screen.
const early = skyAt(1);
const late = skyAt(Math.max(...versesSeen));
ok(early !== null && late !== null && early !== late,
   'THE SCENE AT THE START OF GENESIS 1 IS NOT THE SCENE AT THE END OF IT',
   `v2 ${early} / v30 ${late}`);

// docs/decisions/0004-idle-threat-not-speed-timer.md, on the scenery: the world
// must not change while the player is thinking. Sit for ten seconds of frames
// without touching a key and the sky must be the colour it was.
const restingBefore = skyColour();
for (let i = 0; i < 600; i++) tick();
ok(restingBefore !== null && skyColour() === restingBefore,
   'THE WORLD DOES NOT CHANGE WHILE HE IS THINKING',
   `${restingBefore} became ${skyColour()}`);

// --- the report card ---------------------------------------------------------
//
// docs/design/08-stats.md: "the per-finger table is the point". It is the most
// valuable teaching surface in the game and the one a unit test can only see as
// a display list -- so it is read here off the running game, with a real record
// behind it, at the moment a player actually meets it.

await typeOutPart();
const card = () => calls.fillText.map((c) => c.v);
ok(card().some((v) => v.startsWith('your hands')), 'the report card lands',
   card().slice(0, 4).join(' / '));

// Nine rows, not ten: eight fingers and the one thumb on the space bar.
const EIGHT = ['L pinky', 'L ring', 'L mid', 'L index', 'R index', 'R mid', 'R ring', 'R pinky'];
const drawn = EIGHT.filter((f) => card().includes(f));
const thumbs = ['L thumb', 'R thumb'].filter((f) => card().includes(f));
ok(drawn.length === EIGHT.length && thumbs.length === 1,
   'NINE ROWS: EVERY FINGER, AND ONLY THE THUMB THIS PLAYER USES',
   `${String(drawn.length)} fingers, thumbs: ${thumbs.join(', ') || 'none'}`);

// One instruction, derived from the data, in the game's own voice.
const next = card().filter((v) => v.startsWith('Next:'));
ok(next.length === 1, 'the card asks for exactly one thing', next.join(' | ') || '(none)');
ok(card().every((v) => !v.includes('!')), 'nothing on the card is exclaimed',
   card().find((v) => v.includes('!')) ?? '');

ok(card().some((v) => v.includes('still missing')), 'the gate says what is left',
   card().find((v) => v.includes('still missing')) ?? '(none)');
ok(card().some((v) => /^last \d+ stretch(es)? - /.test(v)), 'the curve is drawn and labelled',
   card().find((v) => v.startsWith('last ')) ?? '(none)');
ok(card().some((v) => v.startsWith('so far')), 'this part is shown against the running average');

// The same card, on purpose, from the menu. A history reachable only by
// finishing something is one he cannot look at when he wants to.
stubEl('menu-open').click();
tick(2);
stubEl('menu-hands').click();
tick(2);
ok(panel('panel-hands'), 'the report card opens from the menu too');
const handRows = rowsOf('hands-table').map(textOf);
ok(handRows.length === 9, 'and carries the same nine rows',
   `${String(handRows.length)} rows: ${handRows[0] ?? '(none)'}`);
ok(String(stubEl('hands-advice').textContent).startsWith('Next:'),
   'and the same one thing to work on', String(stubEl('hands-advice').textContent));
ok(String(stubEl('hands-note').textContent).length > 0, 'and says what the table means',
   String(stubEl('hands-note').textContent));
ok(rowsOf('hands-curve').length > 0, 'the curve has a bar per finished part',
   `${String(rowsOf('hands-curve').length)} bars`);
ok(/dip|average/.test(String(stubEl('hands-curve-note').textContent)),
   'THE CURVE EXPLAINS ITS OWN DIPS RATHER THAN LOOKING LIKE A REGRESSION',
   String(stubEl('hands-curve-note').textContent));
stubEl('hands-resume').click();
tick(2);
ok(card().some((v) => v.startsWith('your hands')), 'and leaving it returns to the card');

// Requirement four: he must be able to leave in one keystroke.
press('Enter');
const left = await waitFor(
  () => askedFor() !== null || panel('panel-promotion') || panel('panel-gild'),
);
ok(left, 'ONE KEYSTROKE LEAVES THE CARD: no ceremony to sit through');
await takeCardForward();

// The map.
stubEl('menu-open').click();
tick(2);
stubEl('menu-map').click();
tick(2);
ok(panel('panel-map'), 'the map opens from the menu');
const nodeRows = rowsOf('map-nodes').map(textOf);
const threadRows = rowsOf('map-threads').map(textOf);
ok(nodeRows.length > 1, 'the map draws the passage graph', `${nodeRows.length} passages`);
ok(threadRows.some((t) => t.includes('Genesis 1') && t.includes('John 1') && t.includes('quoting')),
   'every thread carries its one-line note about the echo',
   threadRows[0] ?? '(none)');
const johnRow = rowsOf('map-nodes').find((li) => String(li.children[0].textContent) === 'John 1');
const goButton = johnRow && johnRow.children.find((c) => c.tagName === 'BUTTON');
ok(Boolean(goButton), 'a passage unlocked by a completed origin can be travelled to',
   johnRow ? textOf(johnRow) : 'John 1 is not on the map');

// The rest of the screen, which is the part a core test cannot see: `core/route.ts`
// is exhaustively tested as a graph, and none of that says whether the graph
// reached a player's eyes. Read the panel back instead.

// Where he stands. He has read straight on past the end of Genesis 1, so he is
// in a chapter the graph does not name -- and the map used to answer that by
// marking its own first entry, telling a player reading Genesis 2 that he was
// in Genesis 1. docs/design/04-route.md#standing-off-the-route: mark nothing,
// say plainly where he is, and leave the finished passages marked.
const chapterNow = refText().split(':')[0].trim();
const onTheRoute = nodeRows.some((t) => t.startsWith(chapterNow));
const hereRows = rowsOf('map-nodes').filter((li) => textOf(li).includes('you are here'));
const standing = String(stubEl('map-standing').textContent);
ok(!onTheRoute, 'the harness really is standing off the route here', chapterNow);
ok(hereRows.length === 0, 'STANDING OFF THE ROUTE, THE MAP MARKS NO NODE AT ALL',
   hereRows.map(textOf).join(' / ') || '(nothing is marked)');
ok(standing.includes(chapterNow), 'AND NAMES THE PASSAGE HE IS ACTUALLY READING', standing);
ok(/not on the .+ route/.test(standing) && /Nothing is wrong/.test(standing),
   'and says being off it is not an error', standing);
ok(nodeRows.some((t) => t.startsWith('Genesis 1') && t.includes('finished')),
   'while the thread he finished stays marked, so he can get back to one',
   nodeRows.find((t) => t.startsWith('Genesis 1')) ?? '(not on the map)');

// A locked passage says what would unlock it. "Not yet", with no reason, reads
// as a bug in a graph the player can see -- and it must not offer a way in.
const locked = rowsOf('map-nodes').filter((li) => textOf(li).includes('finish a passage that leads here'));
ok(locked.length > 0, 'a passage nothing leads to yet says what would open it',
   rowsOf('map-nodes').map(textOf).join(' / '));
ok(locked.every((li) => !li.children.some((c) => c.tagName === 'BUTTON')),
   'and offers no way to travel to it',
   locked.map(textOf).join(' / '));

// The counter, and the promise under it. Secrets are deliberately not counted:
// a player who never finds a doorway still finishes the pilgrimage, and a
// progress line that counted them would say otherwise every time he read it.
const mapProgress = String(stubEl('map-progress').textContent);
ok(/^\d+ of \d+ passages finished\./.test(mapProgress),
   'the map counts the stops finished against the stops the route requires', mapProgress);
ok(mapProgress.includes('Secret rooms are not counted'),
   'AND SAYS SECRETS ARE NOT COUNTED, SO A MISSED ROOM NEVER READS AS AN UNFINISHED ROUTE',
   mapProgress);
ok(String(stubEl('map-error').textContent) === '',
   'and nothing on it claims the route failed to load',
   String(stubEl('map-error').textContent));

// Every thread names both ends and the phrase they share. The note is checked
// above; without the phrase the note is an assertion the player cannot check.
ok(threadRows.every((t) => t.includes('\u2192') || t.includes('\u21a9')),
   'every thread says which way it runs', threadRows[0] ?? '(none)');
ok(threadRows.every((t) => /\u201c[^\u201d]+\u201d/.test(t)),
   'and quotes the phrase the two passages share',
   threadRows.find((t) => !/\u201c[^\u201d]+\u201d/.test(t)) ?? '');
// And a secret is not spoiled by the screen that lists everything else. No
// doorway has been found yet, so none is drawn: `core/route.ts` decides that,
// and this is the only place it can be seen deciding it.
ok(!threadRows.some((t) => t.includes('\u21a9')),
   'A ROOM NOBODY HAS FOUND IS NOT ON THE MAP, SO THE MAP CANNOT SPOIL IT',
   threadRows.filter((t) => t.includes('\u21a9')).join(' / '));
ok(!rowsOf('map-nodes').some((li) => textOf(li).includes('a room you found')),
   'and neither is the passage behind it', '');

// Escape leaves the map the way it leaves everything else, and hands the rail
// back. A screen with a way in and no way out is the trap the menu button exists
// to prevent, and this one is reachable mid-part.
press('Escape');
tick(4);
ok(!panel('panel-map'), 'Escape closes the map');
ok(askedFor() !== null, 'and hands the rail straight back', refText());
stubEl('menu-open').click();
tick(2);
stubEl('menu-map').click();
tick(2);

// The crossing. Drive it frame by frame and watch the phrase.
if (goButton) {
  const PHRASE = 'In the beginning';
  const want = [...PHRASE].filter((c) => c !== ' ').length;
  const holdsPhrase = () => {
    const bold = calls.fillText.filter((c) => c.style.includes('bold 17px'));
    return bold.length >= want
      && bold.slice(-want).map((c) => c.v).join('') === PHRASE.replace(/ /g, '');
  };
  goButton.click();
  // The destination level is built before the crossing starts, so wait for the
  // phrase to actually be on screen rather than for a stopwatch.
  const began = await waitFor(holdsPhrase);
  ok(began, 'travelling a thread starts a crossing');
  const columns = new Set();
  const ribbons = new Set();
  let held = 0;
  for (let i = 0; i < 140; i++) {
    tick();
    const bold = calls.fillText.filter((c) => c.style.includes('bold 17px'));
    if (bold.length < want) continue;
    const phrase = bold.slice(-want);
    if (phrase.map((c) => c.v).join('') !== PHRASE.replace(/ /g, '')) continue;
    columns.add(phrase.map((c) => Math.round(c.x * 1e6) / 1e6).join(','));
    ribbons.add(calls.fillText.filter((c) => c.style.includes('17px')).length);
    held += 1;
  }
  ok(held > 1, 'the crossing runs for more than one frame', `${held} frames`);
  ok(columns.size === 1,
     'THE ECHOED PHRASE DOES NOT MOVE, ON ANY FRAME OF THE CROSSING',
     `${columns.size} distinct column sets: ${[...columns].join(' | ')}`);
  ok(ribbons.size > 1, 'the ribbon underneath it changed, so something was held across a cut',
     `ribbon lengths: ${[...ribbons].join(', ')}`);
  await waitFor(() => calls.fillText.some((c) => c.v.startsWith('John 1')));
  const focalCrossing = [...columns][0];
  ok(calls.fillText.some((c) => c.v.startsWith('John 1')), 'the crossing arrives at the destination',
     calls.fillText[0] ? calls.fillText.map((c) => c.v).find((v) => /\d+:\d+/.test(v)) ?? '(no ref)' : '(no frame)');

  // Standing on a passage the route names, the map and the game have to agree
  // about which one. This is the claim the earlier "exactly one is marked" check
  // could not make, because the player was then in a chapter off the graph.
  const standingOn = refText();
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-map').click();
  tick(2);
  const arrivedRows = rowsOf('map-nodes').map(textOf);
  const marked = rowsOf('map-nodes').find((li) => textOf(li).includes('you are here'));
  ok(Boolean(marked) && standingOn.startsWith(String(marked.children[0].textContent)),
     'THE MAP AND THE GAME AGREE ABOUT WHICH PASSAGE HE IS ON',
     `${marked ? String(marked.children[0].textContent) : '(nothing marked)'} vs ${standingOn}`);
  ok(arrivedRows.some((t) => t.startsWith('Genesis 1') && t.includes('finished')),
     'and the passage he came from now reads as finished',
     arrivedRows.find((t) => t.startsWith('Genesis 1')) ?? '(not on the map)');
  press('Escape');
  tick(4);

  // The harder case. Travelled from the map, the crossing is entered *on* the
  // phrase, so it is held on the focal guide -- and a renderer that had quietly
  // gone back to deriving the column from the rail would look right. Entered
  // from where the player is actually standing, `echoX` is nowhere near the
  // middle, and only a column computed once at the doorway can hold it there.
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-book').value = 'Genesis';
  stubEl('menu-chapter').value = '1';
  stubEl('menu-go').click();
  await waitFor(() => refText().startsWith('Genesis 1'));
  for (let i = 0; i < 12; i++) {
    const k = askedFor();
    if (k === null) break;
    press(k);
    tick();
  }
  tick(40);
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-map').click();
  tick(2);
  const again = rowsOf('map-nodes').find((li) => String(li.children[0].textContent) === 'John 1');
  const goAgain = again && again.children.find((c) => c.tagName === 'BUTTON');
  if (goAgain) {
    goAgain.click();
    await waitFor(holdsPhrase);
    const live = new Set();
    for (let i = 0; i < 140; i++) {
      tick();
      if (!holdsPhrase()) continue;
      const bold = calls.fillText.filter((c) => c.style.includes('bold 17px')).slice(-want);
      live.add(bold.map((c) => Math.round(c.x * 1e6) / 1e6).join(','));
    }
    ok(live.size === 1, 'AND IT DOES NOT MOVE WHEN THE CROSSING IS ENTERED OFF-CENTRE',
       `${live.size} distinct column sets: ${[...live].join(' | ')}`);
    ok(live.size === 1 && [...live][0] !== focalCrossing,
       'that crossing really was held somewhere else on the rail',
       `${[...live][0]} vs ${focalCrossing}`);
    await waitFor(() => calls.fillText.some((c) => c.v.startsWith('John 1')));
  }
}

// Reading mode: no typing, a pace that ramps, and a way out that is named.
//
// What the stage is dimming right now, for comparison. Reading classifies the
// ribbon against the *whole board* rather than the current stage -- the mode
// asks for no keys, so half a page greyed would be the curriculum answering a
// question this mode never puts (docs/design/02-rail.md#reading-mode).
const DIM_COLOUR = '#4a4238';
const dimShare = () => {
  const glyphs = calls.fillText.filter((c) => c.style.includes('17px'));
  return glyphs.length === 0 ? null : glyphs.filter((c) => c.color === DIM_COLOUR).length / glyphs.length;
};
let typingDim = null;
for (let i = 0; i < 20 && typingDim === null; i++) { tick(); typingDim = dimShare(); }
const typingRef = refText();

stubEl('menu-open').click();
tick(2);
stubEl('menu-read').click();
tick(2);
const opening = calls.fillText.find((c) => c.v.startsWith('READING'));
ok(Boolean(opening), 'reading mode reports a pace instead of a score',
   calls.fillText.map((c) => c.v).slice(0, 3).join(' / '));
ok(!calls.fillText.some((c) => c.v.startsWith('next:')), 'reading mode asks for no keys');
ok(calls.fillText.some((c) => /esc/.test(c.v)), 'and names the way out of it');
// The ribbon *glides* here rather than stepping -- `charOffset` is fractional on
// purpose, because rounding it to whole cells would make 180 wpm a stutter of
// three cells a second. So the claim is not that a glyph sits on the focal
// column; it is that the focal point itself does not move, and that the ribbon
// stays one rigid grid sliding under it.
const readingCarets = new Set();
const readingPitch = new Set();
const readingOffsets = new Set();
for (let i = 0; i < 240; i++) {
  tick();
  const x = caretX();
  if (x !== null) readingCarets.add(x);
  const xs = calls.fillText.filter((c) => c.style.includes('17px')).map((c) => c.x).sort((a, b) => a - b);
  for (let j = 1; j < xs.length; j++) readingPitch.add(Math.round((xs[j] - xs[j - 1]) * 100) / 100);
  if (xs.length > 0) readingOffsets.add(Math.round((((xs[0] % CELL) + CELL) % CELL) * 100) / 100);
}
ok(readingCarets.size === 1 && readingCarets.has(FOCAL),
   'the focal point does not move in reading mode either',
   `caret columns: ${[...readingCarets].join(', ')}`);
ok([...readingPitch].every((d) => Math.abs(d % CELL) < 1e-6),
   'the ribbon stays one rigid grid, so nothing inside it can drift',
   `pitches: ${[...readingPitch].slice(0, 6).join(', ')}`);
ok(readingOffsets.size > 1, 'and it really was sliding under the guide',
   `${readingOffsets.size} distinct offsets`);
const later = calls.fillText.find((c) => c.v.startsWith('READING'));
ok(Boolean(later) && later.v !== opening?.v, 'the pace ramps while the reading is sustained',
   `${opening?.v ?? '?'} -> ${later?.v ?? '?'}`);

// It ramps and it *holds*; it never falls back. This is the one mode in the game
// that exists for a day without pressure, and a pace that dropped would be a
// punishment for blinking -- which is a failure state by another name.
const paces = [];
for (let i = 0; i < 200; i++) {
  tick();
  const line = calls.fillText.find((c) => c.v.startsWith('READING'));
  if (line) paces.push(Number(line.v.replace(/\D+/g, '')));
}
const fell = paces.findIndex((wpm, i) => i > 0 && wpm < paces[i - 1]);
ok(paces.length > 0 && fell === -1,
   'THE PACE NEVER FALLS: THERE IS NO WAY TO DO BADLY IN THIS MODE',
   fell < 0 ? '' : `${paces[fell - 1]} -> ${paces[fell]} wpm at sample ${fell}`);

// The whole chapter, not the part he is in. The reference carries no part
// counter, because there is nothing here that is cut into parts.
const readingRef = calls.fillText.map((c) => c.v).find((v) => /^\w.*\d/.test(v)) ?? '';
ok(!readingRef.includes('part'), 'reading is the chapter, not the part he was typing',
   `${readingRef} (was ${typingRef})`);

// Lit against the whole board. A page half greyed here would be the curriculum
// answering a question this mode never puts.
const readingDim = dimShare();
ok(typingDim !== null && readingDim !== null && readingDim < typingDim,
   'READING LIGHTS THE PAGE THE STAGE WOULD HAVE GREYED',
   `${Math.round((readingDim ?? 1) * 100)}% dim reading, ${Math.round((typingDim ?? 0) * 100)}% typing`);

// And it asks for nothing. Keys pressed into it are not typing: nothing is
// owed, nothing is scored, and the record does not move -- the ribbon carries on
// at its own pace regardless.
const beforeReadingKeys = store.get('scriptorium.progress');
// Where the ribbon has slid to. It is a clock this mode runs on, not a cursor a
// keystroke moves, so the way to show a key did nothing is to show the page went
// on doing exactly what it was doing anyway.
const ribbonX = () => {
  const xs = calls.fillText.filter((c) => c.style.includes('17px')).map((c) => c.x);
  return xs.length === 0 ? null : Math.round(Math.min(...xs) * 100) / 100;
};
const flowedTo = ribbonX();
for (const k of ['a', 's', 'd', 'f', 'x']) { press(k); tick(); }
tick(4);
ok(!calls.fillText.some((c) => c.v.startsWith('next:')),
   'keys pressed while reading are not owed back', '');
ok(store.get('scriptorium.progress') === beforeReadingKeys,
   'AND NOTHING TYPED INTO A READING SITTING REACHES THE RECORD', '');
ok(flowedTo !== null && ribbonX() !== null && ribbonX() !== flowedTo,
   'and the page kept flowing at its own pace while they were pressed',
   `${String(flowedTo)} -> ${String(ribbonX())}`);

press('Escape');
tick(4);
ok(calls.fillText.some((c) => c.v.startsWith('next:')), 'Escape hands the rail back');

// A sitting, not a setting. Opening the menu ends it, rather than leaving it
// running silently behind the panel to come back at a pace nobody chose.
stubEl('menu-read').click();
tick(4);
ok(calls.fillText.some((c) => c.v.startsWith('READING')), 'reading starts again from the menu');
stubEl('menu-open').click();
tick(2);
stubEl('menu-resume').click();
tick(4);
ok(!calls.fillText.some((c) => c.v.startsWith('READING')),
   'OPENING THE MENU ENDS THE SITTING RATHER THAN HIDING IT BEHIND A PANEL',
   calls.fillText.map((c) => c.v).find((v) => v.startsWith('READING')) ?? '');
ok(calls.fillText.some((c) => c.v.startsWith('next:')), 'and Resume means the rail, not the reading');

// --- the second text ---------------------------------------------------------
//
// The King James is a difficulty step, not a preference about wording, and it is
// its own control now rather than a second field in the go-somewhere-else row --
// docs/design/04-route.md#two-texts-and-the-second-act. Three things have to be
// true of it and none of them is reachable from a core test: it applies on
// change, it keeps the player's place, and it does not touch his stage.
const stageLabel = () => calls.fillText.map((c) => c.v).find((v) => v.startsWith('STAGE ')) ?? '';
const railText = () => calls.fillText.filter((c) => c.style.includes('17px')).map((c) => c.v).join('');

// From the top of Genesis 1, where the two texts diverge inside the first line
// -- John 1 opens with the same seven words in both, so the rail there would
// prove nothing about which one is loaded.
stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '1';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 1'));
tick(40);
const beforeText = { ref: refText(), stage: stageLabel(), rail: railText(), stage_: record().stage };

stubEl('menu-open').click();
tick(2);
stubEl('menu-edition').value = 'KJV';
stubEl('menu-edition').dispatchEvent({ type: 'change' });
await waitFor(() => record().translation === 'KJV');
stubEl('menu-resume').click();
await waitFor(() => askedFor() !== null);
tick(40);

ok(record().translation === 'KJV', 'choosing the other text switches to it there and then',
   String(record().translation));
ok(refText().split(':')[0] === beforeText.ref.split(':')[0],
   'and leaves the player in the chapter he was in',
   `${refText()} vs ${beforeText.ref}`);
ok(record().stage === beforeText.stage_ && stageLabel() === beforeText.stage,
   'A TRANSLATION IS NOT A STAGE: THE CURRICULUM DOES NOT MOVE WITH THE PROSE',
   `${stageLabel()} vs ${beforeText.stage}`);
ok(railText().length > 0 && railText() !== beforeText.rail,
   'and the words on the rail really are the other translation',
   `${railText().slice(0, 40)} | ${beforeText.rail.slice(0, 40)}`);

// Back again, because a difficulty step nobody can step back down from is a trap.
stubEl('menu-open').click();
tick(2);
stubEl('menu-edition').value = 'WEB';
stubEl('menu-edition').dispatchEvent({ type: 'change' });
await waitFor(() => record().translation === 'WEB');
stubEl('menu-resume').click();
await waitFor(() => askedFor() !== null);
ok(record().translation === 'WEB', 'and it goes back the same way it came');

// --- a secret room -----------------------------------------------------------
//
// "Entering and leaving one must restore the exact verse, cursor position,
// hearts, smudge level and combo -- and skipping a flashback entirely must
// leave the level completable." Both halves are asserted, in that order.

stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'John';
stubEl('menu-chapter').value = '19';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('John 19'));

const doorwayText = () => calls.fillText.map((c) => c.v).find((v) => v.startsWith('tab: a doorway'));

let doorway;
for (let p = 0; p < 24 && doorway === undefined; p++) {
  for (let i = 0; i < 4000; i++) {
    doorway = doorwayText();
    if (doorway !== undefined) break;
    const k = askedFor();
    if (k === null) break;
    press(k);
    tick();
  }
  if (doorway !== undefined) break;
  await finishPart();
  if (askedFor() === null) break;
}
ok(doorway !== undefined, 'a doorway stands open on the echoed phrase, and says so',
   doorway ?? `never reached one; at ${refText()}`);

if (doorway !== undefined) {
  // Let the ribbon settle first. `stepRail` eases toward its target, so a
  // signature taken on the keystroke that opened the doorway is a signature of
  // a rail still in flight, and comparing it to a settled one would fail for
  // the wrong reason.
  tick(40);
  const before = { ref: refText(), rail: railAt(), where: record().position };
  press('Tab');
  await waitFor(() => refText().startsWith('Genesis 22'), 200);
  const inside = refText();
  ok(inside.startsWith('Genesis 22'), 'stepping through phases backwards into the older passage', inside);
  ok((record().discovered ?? []).includes('Genesis 22'),
     'a room found is remembered, so a reload cannot lose it',
     JSON.stringify(record().discovered));
  ok(JSON.stringify(record().position) === JSON.stringify(before.where),
     'the bookmark does not follow him into the room',
     `${JSON.stringify(record().position)} vs ${JSON.stringify(before.where)}`);

  // Walk straight back out, having done nothing.
  press('Tab');
  await waitFor(() => refText() === before.ref, 200);
  tick(40);
  ok(refText() === before.ref, 'leaving returns to the exact verse he left',
     `${refText()} vs ${before.ref}`);
  ok(railAt() === before.rail, 'and to the exact cursor, so the rail is the rail he left',
     railAt() === before.rail ? '' : 'the ribbon came back on a different column');

  // The room is on the map now, and only now. `discovered` is written on the way
  // in, and the map reads it -- so a secret the player has found stops being a
  // secret the screen is hiding from him.
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-map').click();
  tick(2);
  const foundNodes = rowsOf('map-nodes').map(textOf);
  const foundThreads = rowsOf('map-threads').map(textOf);
  ok(foundNodes.some((t) => t.startsWith('Genesis 22') && t.includes('a room you found')),
     'A ROOM HE STEPPED INTO IS ON THE MAP AFTERWARDS, AND SAYS SO',
     foundNodes.find((t) => t.startsWith('Genesis 22')) ?? '(Genesis 22 is not on the map)');
  ok(foundThreads.some((t) => t.includes('\u21a9') && t.includes('Genesis 22')),
     'and the doorway he used is drawn as a thread of its own',
     foundThreads.filter((t) => t.includes('\u21a9')).join(' / ') || '(no doorway threads)');

  // The room left a figure behind as well, which is the other half of what a
  // secret was missing: "a secret room leaves no visible trace once you have
  // left it, and this is the natural one."
  const partyRows = rowsOf('map-party').map(textOf);
  ok(partyRows.some((t) => t.includes('Genesis 22') && t.includes('Abraham')),
     'A ROOM FOUND PUTS ITS FIGURE IN THE COMPANY, AND THE MAP NAMES HIM',
     partyRows.join(' / ') || '(nobody is with him)');
  ok(partyRows.some((t) => t.includes('Genesis 1')),
     'and the passages he finished are named there too', partyRows.join(' / '));
  ok(String(stubEl('map-party-note').textContent).length > 0,
     'and the map says what the company does, which is nothing',
     String(stubEl('map-party-note').textContent));
  press('Escape');
  tick(4);
  ok(askedFor() !== null, 'and the rail comes back from the map mid-passage', refText());

  // And declining it: type straight past the doorway and finish the chapter.
  let past = 0;
  for (; past < 24; past++) {
    await finishPart();
    if ((record().completed ?? []).includes('John 19')) break;
    if (askedFor() === null) break;
  }
  ok((record().completed ?? []).includes('John 19'),
     'A SKIPPED FLASHBACK NEVER GATES THE EXIT: the chapter finishes without it',
     `after ${past + 1} more parts`);
}

// --- a held scene ------------------------------------------------------------
//
// "The serpent and the woman are talking. Nothing about that conversation
// travels, and sliding a landscape past it is the game insisting on movement the
// text does not have." Genesis 3 is authored as five beats, four of them held,
// and the claim to prove is a pair: the camera does not translate, and the same
// completed words still move the tableau.
//
// The parallax phase is the observable for the camera. `canvas_renderer.ts`
// fills a layer by clipping to the command's rect and repeating one 16x16 image
// inside it, so the clip rect's x *is* how far that layer has scrolled -- and it
// is the only place in the frame that number appears.
// docs/design/05-scenery-warps.md#held-scenes-not-every-passage-is-a-journey

/** Where the parallax layers stand this frame, innermost first. */
const layerPhase = () => calls.clips.map((c) => c.x).join(',');

/**
 * How far the serpent has leaned down out of the branches, in virtual px.
 *
 * A rect three pixels wide, in the scenery band, and the only one: it is the
 * serpent hanging off the bough, and its height is a pure function of how much
 * of the conversation has been written. No clock touches it -- the swaying is in
 * its *x* -- which is what makes "the tableau advances on typed words" separable
 * from "something on the screen is flickering".
 */
const serpentLean = () => {
  const bars = calls.fills.filter(
    (f) => f.w === 3 && f.y > 22 && f.y + f.h <= RAIL_BAND_TOP,
  );
  if (bars.length === 0) return 0;
  // The lower of the two is the one hanging *below* the bough. The other is the
  // serpent's length along the bough itself, which is three pixels tall and
  // whose width is what grows -- the two are told apart by height rather than by
  // width, because each of them passes through three pixels on the way past.
  return bars.reduce((low, f) => (f.y > low.y ? f : low), bars[0]).h;
};

stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '3';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 3'));
tick(30);

ok(refText().startsWith('Genesis 3:1'), 'the game opens at the top of Genesis 3', refText());

const heldPhases = new Set();
const heldSerpent = [];
let heldTyped = 0;
for (let i = 0; i < 400; i++) {
  heldPhases.add(layerPhase());
  heldSerpent.push(serpentLean());
  const k = askedFor();
  if (k === null) break;
  press(k); heldTyped += 1; tick(2);
}
heldPhases.add(layerPhase());
heldSerpent.push(serpentLean());

ok(heldTyped >= 60, 'the harness typed its way into the conversation',
   `${heldTyped} keys`);
ok(heldPhases.size === 1,
   'A HELD SCENE DOES NOT TRANSLATE THE CAMERA, HOWEVER MUCH IS TYPED',
   `${heldPhases.size} parallax positions: ${[...heldPhases].slice(0, 3).join(' | ')}`);
ok(heldSerpent[heldSerpent.length - 1] > heldSerpent[0],
   'AND THE SAME TYPED WORDS ADVANCE THE TABLEAU INSTEAD',
   `the serpent leaned ${heldSerpent[0]}px to ${heldSerpent[heldSerpent.length - 1]}px`);
ok(heldSerpent.every((h, i) => i === 0 || h >= heldSerpent[i - 1]),
   'and it only ever leans further in, never back',
   `${heldSerpent[0]} .. ${heldSerpent[heldSerpent.length - 1]}`);

// Nothing on a clock: frames without a keystroke leave the tableau exactly where
// the last word left it. Same rule as the rest of the game
// (docs/decisions/0004-idle-threat-not-speed-timer.md), and the reason a held
// scene is a rest rather than a cutscene.
const restingAt = serpentLean();
tick(120);
ok(serpentLean() === restingAt,
   'and nothing in a held scene moves while the player is thinking',
   `${restingAt} -> ${serpentLean()}`);

// The staging rule, checked where it matters: behind and above the rail. A
// serpent near the words would be competing with the one thing on screen the
// player is there to read.
const genesis3Band = calls.fills.filter(
  (f) => f.y >= 22 && f.y < RAIL_BAND_TOP && f.h > 0 && f.w > 0,
);
ok(genesis3Band.length > 1 && genesis3Band.every((f) => f.y + f.h <= RAIL_BAND_TOP),
   'AND EVERY PART OF THE TABLEAU STAYS ABOVE THE READING BAND',
   `${genesis3Band.length} shapes, lowest ${Math.max(...genesis3Band.map((f) => f.y + f.h))}`);

// And the observable has teeth: a chapter that is *not* held scrolls under the
// same measurement. Without this, a parallax that had simply stopped working
// would pass every assertion above.
stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '1';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 1'));
tick(20);

const travelPhases = new Set();
let travelTyped = 0;
for (let i = 0; i < 40; i++) {
  travelPhases.add(layerPhase());
  const k = askedFor();
  if (k === null) break;
  press(k); travelTyped += 1; tick(3);
}
ok(travelPhases.size > 1,
   'while an ordinary chapter still scrolls, so the measurement means something',
   `${travelPhases.size} parallax positions over ${travelTyped} keys`);

// --- the two presentations of the rail ---------------------------------------
//
// docs/decisions/0011-respect-reduced-motion.md. The owner reported a motion
// aftereffect that followed him out of the game and into a terminal, and nothing
// in the game consulted `prefers-reduced-motion`. Both presentations are driven
// here, because "two presentations of the rail to keep working, and the smoke
// test must drive both" is a consequence the ADR wrote down.

/** Every glyph on the rail that is not sitting exactly on the focal grid. */
const offGrid = () => rail().filter((c) => ((c.x - FOCAL) % CELL + CELL) % CELL !== 0);

/** Type a few keys, sampling the frame *immediately* after each one. */
function driveRail(keys) {
  const columns = new Set();
  const slid = [];
  let typed = 0;
  for (let i = 0; i < keys; i++) {
    const k = askedFor();
    if (k === null) break;
    press(k); typed += 1;
    // One frame, not a settled eight: the whole difference between the two
    // presentations lives in the frames a smooth ribbon spends in between.
    for (let f = 0; f < 4; f++) {
      tick(1);
      slid.push(offGrid().length);
      const caret = caretX();
      if (caret !== null) columns.add(caret);
    }
  }
  return { typed, columns, slid };
}

const smooth = driveRail(10);
ok(smooth.typed >= 6, 'the smooth presentation took the keys it asked for',
   `${smooth.typed} keys`);
ok(smooth.slid.some((n) => n > 0),
   'the smooth ribbon really does slide, so the next assertion is not vacuous',
   `${smooth.slid.filter((n) => n > 0).length} of ${smooth.slid.length} frames mid-slide`);
ok(smooth.columns.size === 1 && smooth.columns.has(FOCAL),
   'and the reading column does not move while it slides',
   [...smooth.columns].join(', '));

stubEl('menu-open').click();
tick(2);
stubEl('menu-motion').value = 'reduced';
stubEl('menu-motion').dispatchEvent({ type: 'change' });
await waitFor(() => record().motion === 'reduced');
stubEl('menu-resume').click();
await waitFor(() => askedFor() !== null);
tick(4);

ok(record().motion === 'reduced',
   'THE MOTION SWITCH IS IN THE MENU AND IS REMEMBERED, NOT ONLY THE SYSTEM SETTING',
   String(record().motion));

const steppedPhases = new Set();
const stepped = driveRail(10);
steppedPhases.add(layerPhase());
for (let i = 0; i < 10; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k); tick(3);
  steppedPhases.add(layerPhase());
}

ok(stepped.typed >= 6, 'the stepped presentation is a way to play, not a way to stop',
   `${stepped.typed} keys`);
ok(stepped.slid.every((n) => n === 0),
   'REDUCED MOTION STEPS THE RIBBON: NO FRAME IS CAUGHT BETWEEN TWO POSITIONS',
   `${stepped.slid.filter((n) => n > 0).length} of ${stepped.slid.length} frames mid-slide`);
ok(stepped.columns.size === 1 && stepped.columns.has(FOCAL),
   'AND THE READING COLUMN IS THE SAME COLUMN IT IS IN THE OTHER PRESENTATION',
   [...stepped.columns].join(', '));
ok(steppedPhases.size === 1,
   'AND THE PARALLAX STOPS DEAD, WHICH IS THE HALF THAT ADAPTS THE EYE',
   `${steppedPhases.size} parallax positions: ${[...steppedPhases].slice(0, 3).join(' | ')}`);

// Back, because a setting that cannot be turned off is not a setting -- and
// because everything after this expects the game it had.
stubEl('menu-open').click();
tick(2);
stubEl('menu-motion').value = 'auto';
stubEl('menu-motion').dispatchEvent({ type: 'change' });
await waitFor(() => record().motion === 'auto');
stubEl('menu-resume').click();
await waitFor(() => askedFor() !== null);
const backPhases = new Set();
for (let i = 0; i < 20; i++) {
  backPhases.add(layerPhase());
  const k = askedFor();
  if (k === null) break;
  press(k); tick(3);
}
ok(record().motion === 'auto' && backPhases.size > 1,
   'and it goes back the way it came, with the world moving again',
   `${backPhases.size} parallax positions`);

// --- the sound comes back after a backgrounded tab ---------------------------
//
// "Sound had been working when I turned it on. Now it's not at all." A browser
// suspends an AudioContext when its tab goes to the background, and the open
// path latched on "we have opened one before" -- so after one alt-tab nothing
// ever resumed it and the game was silent for the rest of the evening with the
// toggle still reading on. Every existing test passed while this was broken.
// docs/design/09-music.md#a-suspended-context-is-a-backgrounded-tab-not-an-error
ok(audio.ctx !== null && audio.ctx.state === 'running',
   'the audio device is open and running before the tab is backgrounded',
   audio.ctx === null ? '(no context)' : String(audio.ctx.state));

// Backgrounded: exactly what a browser does, and not an error.
audio.ctx.state = 'suspended';
const silentFrom = audio.notes;
tick(60);
ok(audio.notes === silentFrom, 'a suspended device schedules nothing, as the browser intends',
   `${audio.notes - silentFrom} notes`);

// He comes back and types. A keystroke is a user gesture, so resuming inside the
// input handler is allowed -- and it is the same door the first keystroke used.
const typedKey = askedFor();
if (typedKey !== null) press(typedKey);
await waitFor(() => audio.ctx.state === 'running', 20);
tick(120);
ok(audio.ctx.state === 'running', 'TYPING AGAIN RESUMES THE DEVICE INSTEAD OF LATCHING IT OFF',
   String(audio.ctx.state));
ok(audio.notes > silentFrom, 'AND THE MUSIC IS ACTUALLY SOUNDING AGAIN, NOT MERELY ENABLED',
   `${audio.notes - silentFrom} notes since it was suspended`);

// And without a keystroke at all: the tab coming back to the foreground is
// enough, which is what a player alt-tabbing back from a terminal actually does.
audio.ctx.state = 'suspended';
const backFrom = audio.notes;
globalThis.document.visibilityState = 'visible';
for (const handler of listeners.visibilitychange ?? []) handler({ type: 'visibilitychange' });
await waitFor(() => audio.ctx.state === 'running', 20);
tick(120);
ok((listeners.visibilitychange ?? []).length > 0,
   'the game is listening for the tab coming back at all');
ok(audio.ctx.state === 'running' && audio.notes > backFrom,
   'AND COMING BACK TO THE TAB BRINGS THE SOUND BACK WITH NO KEYSTROKE AT ALL',
   `${audio.notes - backFrom} notes, device ${String(audio.ctx.state)}`);

// --- the voice ---------------------------------------------------------------
//
// docs/design/10-first-run.md#tone is not a rule about the opening screen. It is
// the game's voice, and it applies to every surface: plain, adult, specific, no
// exclamation marks, no praise for trivia, and no word that names something in
// our source and nothing he has been shown.
//
// `core/copy.test.ts` holds the canvas card's two generated sentences and the
// prose in index.html to exactly this rule. What it cannot reach is the copy
// assembled in `platform/web/overlay.ts` -- the promotion, the history note, the
// map's rows and counters, the gate table -- which is a string in a function
// that only a running game calls. So it is swept here, off the panels this run
// actually rendered and everything the canvas actually drew.
const panelText = [...elements.values()]
  .map((el) => String(el.textContent ?? ''))
  .filter((t) => t.length > 1);
const spoken = [...everSaid, ...panelText];
ok(spoken.length > 60, 'the tone sweep has copy to read', `${spoken.length} strings`);
ok(panelText.some((t) => t.includes('passages finished')), 'including the panels it rendered');

// The exclamation ban narrowed, and this is where the narrowing is kept honest.
// It is about *praise*, so it holds absolutely over the copy that judges the
// player -- the promotion panel and the report card's two sentences -- and not
// over the copy that describes the world. A follower arriving is the world doing
// something, not a verdict on him.
// docs/design/10-first-run.md#the-exclamation-ban-is-about-praise-and-only-covers-copy-that-judges-him
const EVALUATIVE_IDS = [
  'promotion-title', 'promotion-description', 'promotion-keys', 'promotion-dip',
  'promotion-coverage', 'promotion-ok', 'hands-note', 'hands-advice', 'hands-scope',
  'hands-curve-note',
];
const judging = EVALUATIVE_IDS.map((id) => String(stubEl(id).textContent ?? '')).filter((t) => t.length > 1);
ok(judging.length >= 5, 'the panels that judge him were rendered and can be read',
   `${judging.length} of ${EVALUATIVE_IDS.length}`);
const judged = judging.find((t) => t.includes('!'));
ok(judged === undefined, 'NOTHING THAT JUDGES THE PLAYER IS EXCLAIMED', judged ?? '');

// Everywhere else, an exclamation mark is allowed only where the roster puts
// one. So a stray `!` anywhere in the game is still a failure -- what changed is
// that there is now exactly one licensed place for it.
const { loadFollowers, arrivalLines } = await import(
  pathToFileURL(resolve(ROOT, 'build/core/followers.js')).href
);
const ARRIVALS = arrivalLines(
  loadFollowers(JSON.parse(await readFile(resolve(ROOT, 'data/followers.json'), 'utf8'))),
);
const stray = spoken.find(
  (t) => t.includes('!') && !ARRIVALS.some((line) => t.includes(line)),
);
ok(stray === undefined, 'AND NOTHING ELSE EXCLAIMS EXCEPT A FOLLOWER ARRIVING', stray ?? '');
ok(ARRIVALS.some((line) => line.includes('!')),
   'and the licence is actually being used, or the rule above tests nothing',
   ARRIVALS.filter((l) => l.includes('!')).join(' | '));

const praise = ['great', 'well done', 'nice work', 'awesome', 'perfect', 'excellent',
                'good job', 'congratulations', 'brilliant', 'amazing', 'fantastic'];
const flattered = spoken.find((t) => praise.some((w) => t.toLowerCase().includes(w)));
ok(flattered === undefined, 'and nothing praises him for typing a letter', flattered ?? '');

// Words that name a thing in the source tree and nothing on his screen. `candle`
// is the precedent: excellent internal vocabulary, and it reached the HUD as
// `candle 1/11` before a player had ever seen one drawn. `part` is the second
// one, and it was `candle`'s replacement -- the same mistake in a plainer coat.
// docs/design/03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing
const ours = [/\bcandles?\b/i, /\bparts?\b/i, /\blectio\b/i, /\bchunks?\b/i, /\bglyphs?\b/i,
              /\bribbon\b/i, /\bblot\b/i, /\billuminat(e|ed|ion|ing)\b/i,
              /\bgreyed\b/i, /\blive\b/i, /\bmastery gate\b/i, /\bkey ?set\b/i];
const jargon = spoken.find((t) => ours.some((re) => re.test(t)));
ok(jargon === undefined, 'AND NOTHING SAYS A WORD ONLY THE SOURCE TREE KNOWS', jargon ?? '');

// --- the line caps ------------------------------------------------------------
//
// A player far enough along the route has more company than the screen can hold
// without the scenery starting to compete with the text
// (docs/design/11-followers.md#the-cap-and-what-is-shown-instead). Typing
// nineteen chapters to reach that state is not something a smoke test can do, so
// the game is booted a second time onto a record that already has them: the
// party is *derived* from `completed` and `discovered`, so a record is the only
// input, and this is exactly the reload the player would get.
const FINISHED = JSON.parse(await readFile(resolve(ROOT, 'data/routes/pilgrimage.json'), 'utf8'))
  .edges.flatMap((e) => [e.from, e.to]);
store.set('scriptorium.progress', JSON.stringify({
  version: 6, stage: 1, translation: 'WEB', route: 'pilgrimage',
  position: { book: 'Genesis', chapter: 1, unit: 1 },
  completed: FINISHED, discovered: FINISHED,
  keyStats: {}, recent: {}, history: [],
  gilding: false, gildOffered: true, firstRun: false, cloudEnabled: true,
  notesSeen: ['space', 'error', 'dim'],
}));
await import(`${pathToFileURL(resolve(ROOT, 'build/platform/web/main.js')).href}?again`);
await new Promise((r) => setTimeout(r, 400));
await waitFor(() => askedFor() !== null);
tick(8);

const capped = figuresDrawn();
ok(capped.length === CAP, 'THE LINE CAPS: A LONG PILGRIMAGE DOES NOT FILL THE SCREEN',
   `${capped.length} figures drawn, cap is ${CAP}`);
ok(capped.every((f) => f.x < SCRIBE_X && f.y + 16 <= RAIL_BAND_TOP),
   'and every one of them is still behind him and still out of the reading band',
   capped.map((f) => `${f.x},${f.y}`).join(' '));
const overflow = calls.fillText.find((c) => /^\+\d+$/.test(c.v));
ok(overflow !== undefined && Number(overflow.v.slice(1)) === new Set(FINISHED).size - CAP,
   'AND THE ONES WHO WALKED ON AHEAD ARE COUNTED RATHER THAN FORGOTTEN',
   overflow ? overflow.v : '(no count on screen)');
ok(overflow !== undefined && overflow.y + 4 < RAIL_BAND_TOP && overflow.y > 22,
   'with the count in the scenery band, never in the reading band',
   overflow ? `y=${overflow.y}` : '');

// And the map still names every one of them, because the cap is a limit on the
// screen and not on the record.
stubEl('menu-open').click();
tick(2);
stubEl('menu-map').click();
tick(2);
const wholeParty = rowsOf('map-party').map(textOf);
ok(wholeParty.length === new Set(FINISHED).size,
   'THE MAP NAMES EVERYONE, INCLUDING THE ONES THE SCREEN IS NOT SHOWING',
   `${wholeParty.length} named, ${new Set(FINISHED).size} met`);
ok(/walk on ahead/.test(String(stubEl('map-party-note').textContent)),
   'and says why some of them are not on the screen',
   String(stubEl('map-party-note').textContent));


console.log('');
if (fails.length > 0) {
  console.error(`smoke FAILED (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('smoke passed — the built game boots, renders, types and saves.');
