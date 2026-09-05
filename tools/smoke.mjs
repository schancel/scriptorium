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
import { readFile, readdir } from 'node:fs/promises';
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
  // `globalAlpha` is recorded with the rect, because the keyboard overlay now
  // gives its band back by *receding* rather than by dropping keys, and
  // "the board thinned" is only an assertion if the alpha is visible here.
  fillRect(x, y, w, h) {
    calls.fillRect += 1;
    calls.fills.push({ x, y, w, h, color: this.fillStyle, alpha: this.globalAlpha });
  }
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

/**
 * The mixer graph, recorded the way an audio engineer would read one.
 *
 * A crossfade is invisible in a stream of notes. It is **two gain nodes under
 * the master**, one coming down while the other goes up, and the only honest way
 * to see one from outside the game is to watch what the running bundle actually
 * builds and what it writes to each fader. So every node it constructs is kept,
 * with what it was connected to, and every value written to a gain in call
 * order. docs/design/09-music.md#two-machines-for-the-width-of-a-boundary
 */
const graph = { nodes: [], edges: [], writes: [] };
const DESTINATION = -1;
/**
 * Pushed into the write log at the top of every frame the harness runs.
 *
 * The mix is asserted **per frame**, not per write, because the two halves of
 * one crossfade step -- the tune coming down and the tune going up -- are two
 * calls scheduled at the same instant on the audio clock. Reading between them
 * would see a sum of 1.05 that nothing ever heard.
 */
const FRAME_MARK = { node: null, value: null };

function shimParam(owner, value = 0) {
  const param = {
    get value() { return value; },
    set value(v) { value = v; graph.writes.push({ node: owner, value: v }); },
    setValueAtTime(v) { param.value = v; },
    // A ramp is recorded at the value it is heading for: what matters here is
    // which gain a fader was told to reach, not where it was halfway up.
    linearRampToValueAtTime(v) { param.value = v; },
    exponentialRampToValueAtTime(v) { param.value = v; },
    cancelScheduledValues() {},
  };
  return param;
}
function shimNode(kind, extra = {}) {
  const id = graph.nodes.length;
  const node = {
    id,
    kind,
    // Which device built it. Several booted games are still running by the end
    // of this file, each with an `AudioContext` of its own, and reading two of
    // their faders as one mix would report a crossfade nobody ever heard.
    ctx: audio.contexts,
    connect(to) { graph.edges.push([id, to?.id ?? DESTINATION]); return to; },
    disconnect() {}, start() {}, stop() {},
    ...extra,
  };
  graph.nodes.push(node);
  return node;
}
class AudioCtxShim {
  constructor() {
    this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.sampleRate = 48000;
    audio.contexts += 1;
    audio.ctx = this;
  }
  createGain() {
    const node = shimNode('gain');
    node.gain = shimParam(node.id, 1);
    return node;
  }
  createOscillator() {
    audio.notes += 1;
    const node = shimNode('osc', { type: 'square', setPeriodicWave() {} });
    node.frequency = shimParam(node.id);
    return node;
  }
  createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }
  createBufferSource() { audio.notes += 1; return shimNode('buffer', { buffer: null }); }
  createBiquadFilter() {
    const node = shimNode('filter', { type: '' });
    node.frequency = shimParam(node.id);
    node.Q = shimParam(node.id);
    return node;
  }
  createPeriodicWave() { return {}; }
  resume() { this.state = 'running'; audio.started += 1; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

/** The master gain of one device: its node wired to the destination. */
function masterNode(ctxId) {
  const edge = graph.edges.find(
    ([from, to]) => to === DESTINATION && graph.nodes[from]?.ctx === ctxId,
  );
  return edge === undefined ? null : edge[0];
}

/**
 * The device whose mix is actually moving: the one that wrote a gain last.
 *
 * Several games are booted over the course of this file and each opens a device
 * of its own -- but only one is ever *running*, because there is a single
 * `requestAnimationFrame` slot and the newest boot owns it. "The newest context"
 * is not the same thing (a device is reopened whenever a tab-suspend test closes
 * one), so the live one is found by asking which device the game last spoke to.
 */
function liveCtx(before = graph.writes.length) {
  for (let i = before - 1; i >= 0; i -= 1) {
    const write = graph.writes[i];
    if (write !== FRAME_MARK) return graph.nodes[write.node]?.ctx ?? audio.contexts;
  }
  return audio.contexts;
}

/**
 * The faders: gain nodes under the master that no *source* feeds.
 *
 * One per tune the game has sounded this sitting. A note's own envelope gain
 * also hangs under the master when it is a cue, but an oscillator or a filter
 * feeds that one, and nothing feeds a fader except other gains.
 */
function faders(ctxId = liveCtx()) {
  const master = masterNode(ctxId);
  if (master === null) return [];
  const sourced = new Set(
    graph.edges.filter(([from]) => graph.nodes[from]?.kind !== 'gain').map(([, to]) => to),
  );
  const out = [];
  for (const [from, to] of graph.edges) {
    if (to !== master || graph.nodes[from]?.kind !== 'gain') continue;
    if (sourced.has(from) || out.includes(from)) continue;
    out.push(from);
  }
  return out;
}

/** Every write to a fader since `from`, in the order the game made them. */
function mixWrites(from = 0, ctxId = liveCtx()) {
  const ids = new Set(faders(ctxId));
  return graph.writes.slice(from).filter((write) => ids.has(write.node));
}

/**
 * Replay the mix from the beginning and hand every intermediate state to
 * `watch`, as a map of fader -> gain. What the player's ear would have had.
 */
function watchMix(watch, from = 0, ctxId = liveCtx(from)) {
  const ids = new Set(faders(ctxId));
  const level = new Map();
  for (const [i, write] of graph.writes.entries()) {
    if (write === FRAME_MARK) {
      if (level.size > 0 && i >= from) watch(level);
      continue;
    }
    if (ids.has(write.node)) level.set(write.node, write.value);
  }
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

const step = (t) => {
  graph.writes.push(FRAME_MARK);
  const cb = rafCb; rafCb = null; if (cb) cb(t);
};
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
// A follower is a sprite standing at a whole multiple of `follower_spacing_px`
// behind the scribe, usually with a second sprite -- the mark it carries -- at
// exactly the same place. Usually, and not always: Mary Magdalene carries
// nothing, so she is one sprite and no second command at all
// (docs/design/11-followers.md#a-figure-may-carry-nothing). The mark is consumed
// with its body when it is there, so a figure is counted once either way.
const TUNING_ROWS = JSON.parse(await readFile(resolve(ROOT, 'data/tuning.json'), 'utf8')).values;
const SPACING = TUNING_ROWS.follower_spacing_px;
const STRIKE_REACH = TUNING_ROWS.strike_reach;
const CAP = TUNING_ROWS.follower_line_max;
// The scribe stands over the focal point, half a sprite to the left of it.
const SCRIBE_X = FOCAL - 8;
const RAIL_BAND_TOP = 114;

/**
 * Every follower drawn this frame: a body, and the mark it carries if it has one.
 *
 * The line is *contiguous* behind the scribe -- one figure per place, starting
 * one spacing back and with no gaps -- so the run is walked from the nearest
 * place outwards and stops at the first empty one. That is what keeps a candle
 * or a monster which happens to land on a whole multiple of the spacing from
 * being counted as company: it can sit sixteen places back all it likes, and
 * there is nobody standing between it and the scribe.
 */
function figuresDrawn() {
  const atPlace = new Map();
  for (const a of calls.sprites) {
    const back = (SCRIBE_X - a.x) / SPACING;
    // A mark is drawn at its body's own place, so the first sprite there wins
    // and a figure is counted once whether or not it is carrying anything.
    if (back >= 1 && Number.isInteger(back) && !atPlace.has(back)) atPlace.set(back, a);
  }
  const found = [];
  for (let back = 1; atPlace.has(back); back += 1) found.push(atPlace.get(back));
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
/**
 * Let the game's own promises settle.
 *
 * Opening a part is asynchronous, and everything in this file that types does
 * so *synchronously* -- `tick` steps the animation frame by hand and never
 * yields. So a rebuild the harness has just asked for (a mode change, a stage
 * change, a new keyboard) is still pending while a thousand keystrokes go into
 * the level it was meant to replace, and the run measures the game it was
 * trying to leave. `waitFor` yields between its tries and so does this; the
 * difference is that this one has nothing to watch for, because "the level has
 * been rebuilt in place" changes nothing on the screen.
 */
async function pump(n = 20) {
  for (let i = 0; i < n; i++) {
    tick(2);
    await new Promise((r) => setTimeout(r, 5));
  }
}

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

// --- and the music followed the scenery across Genesis 1 ---------------------
//
// Two tunes were composed for `void` and `firmament`, verified against real
// notation, and could never be heard by anybody: both themes exist only as
// verse rows inside a chapter whose row is `daybreak`, and the tune followed the
// chapter. It follows the scenery now, and a tune change *crossfades* rather
// than restarting -- which is the only reason following it is affordable.
//
// `core/sound.test.ts` proves the arithmetic on fixtures. None of that says a
// second tune ever reached a device: the mix is assembled per frame from the
// verse under the cursor, and a game that resolved its music once at chapter
// open would pass every unit test in the repository and still be one hymn.
// So this reads the faders the running bundle actually built.
// docs/design/09-music.md#the-music-follows-the-scenery
const genesisFaders = faders();
ok(genesisFaders.length > 1,
   'TYPING GENESIS 1 SOUNDS MORE THAN ONE TUNE',
   `${genesisFaders.length} tune(s) given a fader of their own`);

// Never two at full. The two gains at a boundary are `1 - mix` and `mix`, so
// the pair sums to one and neither can be above a half at the same moment as
// the other: the crossing is never louder, never quieter, and never doubled.
let loudest = 0;
let bothUp = 0;
let overFull = null;
watchMix((level) => {
  const up = [...level.values()].filter((gain) => gain > 0);
  const total = up.reduce((sum, gain) => sum + gain, 0);
  if (up.length > 1) bothUp += 1;
  loudest = Math.max(loudest, total);
  const full = up.filter((gain) => gain > 0.5).length;
  if (full > 1 && overFull === null) overFull = up.join(' + ');
});
ok(overFull === null,
   'AND NEVER TWO OF THEM AT FULL GAIN',
   overFull ?? `loudest moment was ${loudest.toFixed(3)} across every fader`);
ok(loudest <= 1.0001,
   'the whole mix is never louder than one tune',
   `peak ${loudest.toFixed(3)}`);
ok(bothUp > 0,
   'and two of them really did overlap, or nothing above this was tested',
   `${bothUp} frames with two tunes sounding`);

// Every tune in the songbook, through the built loader, against the built
// synth's ceiling.
//
// A note wanting more arpeggio rungs than the ceiling allows is not refused by
// the synth, it is *clamped* by it: the arpeggio stops moving partway through
// the note and holds its last pitch. That is not silence and it is not a wrong
// note -- it is a drone going flat in the middle, and nobody finds it by
// listening. One hid in `veni-creator`, the abbey's tune, which `void` borrows,
// so the most-heard music in the game: 600 rungs against a limit of 512, and
// the drone froze two thirds of the way through every long note.
// docs/design/09-music.md#the-arpeggio-ceiling.
const { MAX_ARP_STEPS, arpStepCount, msPerTick } = await import(
  pathToFileURL(resolve(ROOT, 'build/core/synth.js')).href
);
const { loadTune } = await import(
  pathToFileURL(resolve(ROOT, 'build/core/tunes.js')).href
);
const tuneFiles = (await readdir(resolve(ROOT, 'data/tunes'))).filter((n) => n.endsWith('.json'));
let worstArp = 0;
let worstArpWhere = '';
let overCeiling = null;
let arpeggiated = 0;
for (const name of tuneFiles.sort()) {
  const tune = loadTune(JSON.parse(await readFile(resolve(ROOT, 'data/tunes', name), 'utf8')));
  // `tempoRatio` 1: the combo only ever speeds the music up, and a faster tempo
  // shortens every note, so the note that fits at rest fits at every tempo.
  const perTick = msPerTick(tune.bpm, tune.ppq, 1);
  for (const track of tune.tracks) {
    for (const note of track.notes) {
      if (note.arp === null || note.arpHz === null) continue;
      arpeggiated += 1;
      const rungs = arpStepCount(note.dur * perTick, note.arpHz);
      if (rungs > worstArp) {
        worstArp = rungs;
        worstArpWhere = `${tune.id} ${track.ch} at tick ${note.t}`;
      }
      if (rungs > MAX_ARP_STEPS && overCeiling === null) {
        overCeiling = `${tune.id} ${track.ch} at tick ${note.t}: ${rungs} rungs`;
      }
    }
  }
}
ok(tuneFiles.length > 0 && arpeggiated > 0,
   'every tune in the songbook loads, and the songbook is arpeggiated',
   `${tuneFiles.length} tunes, ${arpeggiated} arpeggiated notes`);
ok(overCeiling === null,
   'NO NOTE IN ANY TUNE EXCEEDS THE ARPEGGIO LIMIT',
   overCeiling ?? `worst is ${worstArp} of ${MAX_ARP_STEPS} (${worstArpWhere})`);
ok(worstArp * 2 <= MAX_ARP_STEPS,
   'and the ceiling has room left in it, so the next tune is not the failing one',
   `worst ${worstArp} of ${MAX_ARP_STEPS} (${worstArpWhere})`);

// Genesis 1 hands over nobody, and that is the finding rather than a gap. The
// man is *formed* in Genesis 2:7, out of the dust; handing him over for
// finishing Genesis 1 attached a person to the famous chapter rather than to the
// verse that makes him, which is the same mistake ADR 0012 found in the route.
// docs/design/11-followers.md#who-genesis-hands-over
tick(4);
const afterGenesis1 = figuresDrawn();
ok(afterGenesis1.length === 0,
   'GENESIS 1 HANDS OVER NOBODY: THE MAN IS FORMED IN GENESIS 2, NOT HERE',
   `${afterGenesis1.length} figures after finishing Genesis 1`);

// --- and it offers the thread it leads to ------------------------------------
//
// Taking a thread used to require opening the route screen, so a player could
// finish Genesis 1, read straight on into Genesis 2, and never learn that any of
// it existed. `core/route.test.ts` proves the rules over the graph; none of that
// says a sentence ever reached the rail, which is the only place the player is
// looking. So it is read here off the canvas, at the moment he meets it.
// docs/design/04-route.md#finishing-a-passage-offers-the-thread-it-leads-to
//
// The strip is the reserved band immediately under the reading band: its text
// sits on the centre line of an 18px strip at `M.bandTop + M.bandH`.
const STRIP_Y = RAIL_BAND_TOP + 62 + 9;
const stripText = () => calls.fillText.filter((c) => c.y === STRIP_Y).map((c) => c.v);
const offerNow = () => stripText().find((v) => v.startsWith('tab: a thread to'));
const arrivalNow = () => stripText().find((v) => / walks with you\.$|acquired!$/.test(v));

const offered = offerNow();
ok(offered !== undefined, 'FINISHING A PASSAGE OFFERS THE THREAD IT LEADS TO',
   offered ?? `strip: ${stripText().join(' | ') || '(empty)'}`);
ok((offered ?? '').includes('John 1'), 'AND NAMES WHERE THE THREAD GOES', String(offered));
ok(/quoting Genesis word for word/.test(offered ?? ''),
   'AND THE ECHO IT IS MADE OF, IN THE ROUTE TABLE’S OWN WORDS', String(offered));
ok((offered ?? '').includes('or read on'),
   'AND SAYS OUT LOUD THAT READING ON IS THE OTHER ANSWER', String(offered));
ok((offered ?? '').includes('2 more on the route'),
   'AND COUNTS THE OTHER THREADS RATHER THAN LISTING THREE IN ONE LINE', String(offered));
ok(!/Genesis 2/.test(offered ?? ''),
   'and never offers the thread that lands where reading on already lands',
   String(offered));
ok(stripText().length <= 1, 'and it is the only sentence in the strip',
   stripText().join(' | '));

// Declining is reading on, and it costs nothing at all: nothing to dismiss,
// nothing recorded, nothing taken, and the thread still there to travel later.
const HOLD = TUNING_ROWS.first_run_note_keys;
const beforeDecline = {
  completed: [...(record().completed ?? [])].join(),
  where: refText().split(':')[0].trim(),
};
for (let i = 0; i < HOLD + 2; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick();
}
ok(offerNow() === undefined, 'READING ON DECLINES THE OFFER, WITH NOTHING TO DISMISS',
   stripText().join(' | ') || '(empty)');
ok([...(record().completed ?? [])].join() === beforeDecline.completed,
   'AND NOTHING IS LOST BY DECLINING: the passage he finished stays finished',
   `${beforeDecline.completed} -> ${[...(record().completed ?? [])].join()}`);
ok(askedFor() !== null && beforeDecline.where === 'Genesis 2',
   'and he is exactly where reading on put him, still being asked for keys',
   `${beforeDecline.where} / ${String(askedFor())}`);

// And it does not come back while he types on through the chapter it pointed
// away from.
let offerReturned = null;
for (let i = 0; i < 60 && offerReturned === null; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick();
  offerReturned = offerNow() ?? null;
}
ok(offerReturned === null, 'AND IT IS SAID ONCE, NOT ONCE A STRETCH', offerReturned ?? '');

// --- Adam at 2:7, Eve at 2:24 ------------------------------------------------
//
// The scenery went verse-precise and the roster did not, and the mismatch
// showed: both of them used to arrive when a chapter ended, four hundred
// keystrokes after the verse they are about. `core/followers.test.ts` proves the
// derivation at the verse; this types the chapter and watches the screen.
// docs/design/11-followers.md#they-join-at-a-verse-not-at-the-end-of-a-chapter

/** The stretch of verses on the HUD right now, as [first, last]. */
function stretchSpan() {
  const found = /^Genesis 2:(\d+)(?:-(\d+))?$/.exec(refText());
  if (!found) return null;
  return [Number(found[1]), Number(found[2] ?? found[1])];
}

/**
 * Type on until somebody joins, taking report cards forward on the way.
 *
 * What is captured is the moment itself: the line said, the stretch that was on
 * the rail when it was said, and how many figures were behind the scribe.
 */
async function typeUntilSomebodyJoins(limitParts = 20) {
  for (let part = 0; part < limitParts; part++) {
    for (let i = 0; i < 4000; i++) {
      const k = askedFor();
      if (k === null) break;
      const span = stretchSpan();
      press(k);
      tick();
      const line = arrivalNow();
      if (line !== undefined) {
        return { line, span, figures: figuresDrawn().length };
      }
    }
    if (askedFor() === null) await takeCardForward();
    if (askedFor() === null) return null;
  }
  return null;
}

const adam = await typeUntilSomebodyJoins();
ok(adam !== null, 'SOMEBODY JOINS WHILE GENESIS 2 IS BEING TYPED, NOT WHEN IT ENDS',
   adam ? adam.line : '(nobody arrived in twenty stretches)');
ok(adam !== null && adam.line === 'Adam walks with you.',
   'AND IT IS ADAM, WHERE THE MAN IS FORMED', adam ? adam.line : '');
ok(adam !== null && adam.span !== null && adam.span[0] <= 7 && adam.span[1] >= 7,
   'AND HE ARRIVES INSIDE THE STRETCH THAT HOLDS GENESIS 2:7',
   adam && adam.span ? `Genesis 2:${adam.span[0]}-${adam.span[1]}` : '(no stretch on the HUD)');
ok(adam !== null && adam.figures === 1,
   'AND THERE IS ONE FIGURE BEHIND THE SCRIBE WHERE THERE WERE NONE',
   adam ? `${adam.figures} figures` : '');

// The line the arrival is drawn in is the one the roster forms, and it goes as
// he types on: `first_run_note_keys` correct keystrokes, the same rule the
// coaching notes are held to.
for (let i = 0; i < HOLD + 2; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick();
}
ok(arrivalNow() === undefined, 'AND IT GOES AS HE TYPES ON',
   stripText().join(' | ') || '(empty)');

// One passage, two people, at the two verses that make them. Eve is the one
// authored line in the game, and it is hers because 2:24 is where she becomes a
// wife -- she is not named Eve until 3:20, which is why it does not use the name.
const eve = await typeUntilSomebodyJoins();
ok(eve !== null && eve.line === 'Wife acquired!',
   'AND EVE ARRIVES LATER IN THE SAME CHAPTER, WITH HER OWN LINE',
   eve ? eve.line : '(she never arrived)');
ok(eve !== null && eve.span !== null && eve.span[0] <= 24 && eve.span[1] >= 24,
   'AT THE STRETCH THAT HOLDS GENESIS 2:24, WHERE THEY BECOME ONE FLESH',
   eve && eve.span ? `Genesis 2:${eve.span[0]}-${eve.span[1]}` : '(no stretch on the HUD)');
ok(eve !== null && eve.figures === 2,
   'and the line behind him is two long now, in the order the chapter makes them',
   eve ? `${eve.figures} figures` : '');

// The geometry of the line, off the real canvas. It was asserted after Genesis 1
// and has moved here with the figures.
tick(4);
const firstLine = figuresDrawn();
ok(firstLine.length === 2, 'GENESIS 2 PUTS EXACTLY TWO FIGURES BEHIND HIM',
   `${firstLine.length} figures while typing Genesis 2`);
ok(firstLine.every((f) => f.x < SCRIBE_X), 'AND THEY WALK BEHIND THE SCRIBE, NEVER AHEAD',
   firstLine.map((f) => `x=${f.x}`).join(', '));
ok(firstLine.every((f) => f.y + 16 <= RAIL_BAND_TOP),
   'AND NEVER REACH DOWN INTO THE READING BAND',
   firstLine.map((f) => `y=${f.y}`).join(', '));
// On the ground line, which is where the scribe is: no floating, no flying.
const scribeFeet = calls.sprites.filter((c) => c.x === SCRIBE_X).map((c) => c.y);
ok(scribeFeet.length > 0 && firstLine.every((f) => scribeFeet.includes(f.y)),
   'and stand on the same ground the scribe stands on',
   `scribe y=${scribeFeet.join('/')} follower y=${firstLine.map((f) => f.y).join('/')}`);
// Nothing is written over them. The route screen names the company; the world does not.
const overhead = calls.fillText.filter(
  (c) => c.y > 22 && c.y + 4 < RAIL_BAND_TOP && firstLine.some((f) => Math.abs(c.x - f.x) < 16),
);
ok(overhead.length === 0, 'AND NOTHING IS WRITTEN OVER THEIR HEADS',
   overhead.map((c) => c.v).join(' / '));

// Her line goes the way his did, and then the chapter is finished off. Finishing
// is what makes an early arrival permanent: the verse is how he arrives before
// the end, not a condition he has to keep meeting.
// docs/design/11-followers.md#derived-never-stored
for (let i = 0; i < HOLD + 2; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick();
}
for (let part = 0; part < 8 && !(record().completed ?? []).includes('Genesis 2'); part++) {
  await finishPart();
  if (askedFor() === null) break;
}
ok((record().completed ?? []).includes('Genesis 2'),
   'the harness typed Genesis 2 to the end as well',
   (record().completed ?? []).join(', '));
tick(4);
ok(figuresDrawn().length === 2,
   'AND THE PAIR STAY IN THE LINE ONCE THE CHAPTER THEY JOINED IN IS FINISHED',
   `${figuresDrawn().length} figures in ${refText()}`);

// And no arrival comes back. If a line returned here it would be the strip
// re-announcing figures that have been walking behind him for a chapter.
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
const mixWritesBefore = graph.writes.length;
for (let i = 0; i < 600; i++) tick();
ok(restingBefore !== null && skyColour() === restingBefore,
   'THE WORLD DOES NOT CHANGE WHILE HE IS THINKING',
   `${restingBefore} became ${skyColour()}`);

// And the same rule for the ear. The music keeps *playing* through a long think
// -- notes are still being scheduled, which is the point of it being music --
// but the balance between two tunes is a function of the verse under the cursor
// and how far through it he has typed, so ten seconds of frames with nobody
// typing must move no fader at all.
// docs/design/09-music.md#the-music-follows-the-scenery
const idleMix = mixWrites(mixWritesBefore);
ok(idleMix.length === 0,
   'AND NEITHER DOES THE MIX: TEN SECONDS OF THINKING MOVES NO FADER',
   `${idleMix.length} fader move(s) with nobody typing`);

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

// Read on far enough to be off the route. Genesis 2 used to serve here and no
// longer can -- ADR 0012 made it a node, which was the whole point of the ADR --
// so the harness stands where the owner was when he found the abbey instead.
stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '4';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 4'));
tick(30);

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

// Where he stands. He has read on past the end of Genesis 3, so he is in a
// chapter the graph does not name -- and the map used to answer that by marking
// its own first entry, telling a player reading Genesis 4 that he was in
// Genesis 1. docs/design/04-route.md#standing-off-the-route: mark nothing, say
// plainly where he is, and leave the finished passages marked.
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

/** The pace the HUD is reporting, in words a minute. */
const paceNow = () => {
  const line = calls.fillText.find((c) => c.v.startsWith('READING'));
  return line ? Number(line.v.replace(/\D+/g, '')) : null;
};
/** The word on the screen, read back left to right. */
const wordNow = () => {
  const glyphs = calls.fillText.filter((c) => c.style.includes('17px')).sort((a, b) => a.x - b.x);
  return glyphs.length === 0 ? null : glyphs.map((c) => c.v).join('');
};

tick(240);
const climbed = paceNow();
ok(climbed !== null && opening !== undefined && climbed > Number(opening.v.replace(/\D+/g, '')),
   'the pace ramps while the reading is sustained',
   `${opening?.v ?? '?'} -> ${climbed ?? '?'}`);

// The pace comes down from inside the mode. It used to take quitting and
// re-entering, which restarts the ramp -- and a decision the player has no way
// to express is not a decision he made.
// docs/design/02-rail.md#coming-back-down.
//
// Wound up first, because the floor is the opening pace: a reader three seconds
// into a sitting is already at the bottom and has nowhere to come down to, so
// pressing down there would prove nothing about whether down works.
for (let i = 0; i < 5; i++) press('ArrowUp');
tick(2);
const high = paceNow();
ok(high !== null && climbed !== null && high > climbed,
   'the pace goes up on request as well as on the ramp',
   `${climbed ?? '?'} -> ${high ?? '?'} wpm`);
press('ArrowDown');
tick(2);
const eased = paceNow();
ok(eased !== null && high !== null && eased < high,
   'THE PACE CAN BE BROUGHT DOWN FROM INSIDE THE MODE',
   `${high ?? '?'} -> ${eased ?? '?'} wpm`);
ok(calls.fillText.some((c) => c.v.startsWith('READING'))
   && !calls.fillText.some((c) => c.v.startsWith('next:')),
   'and it is still the same sitting, not a new one', '');
// Two seconds later it is still down. A correction sitting on top of the ramp
// would be walked over by it; this moved the ramp clock itself.
tick(120);
ok(paceNow() !== null && paceNow() < high,
   'AND IT STAYS DOWN: THE RAMP DOES NOT WALK BACK OVER THE DECISION',
   `${eased ?? '?'} -> ${paceNow() ?? '?'} wpm, was ${high ?? '?'}`);
press('ArrowUp');
tick(2);
ok(paceNow() > eased, 'and it goes back up again the same way',
   `${eased ?? '?'} -> ${paceNow() ?? '?'} wpm`);

// Reading is RSVP: one word at a time, replacing each other in place, with an
// anchor letter nailed to the focal column. It scrolled the ribbon at a rising
// pace until the owner named what that is -- "Read without typing should snap
// words into place rather than moving them" -- so what is asserted below is
// that it snaps, and that it snaps onto one column, for a whole chapter.
// docs/design/02-rail.md#reading-mode.
//
// Wound up to the ceiling first, so a chapter fits in a smoke test rather than
// in three minutes of simulated frames. The pace is the only thing that
// changes: at 700 words a minute a word is still five frames, so a word that
// slid would still have five different pictures to be caught by.
for (let i = 0; i < 40; i++) press('ArrowUp');
tick(2);

const GOLD = '#f0b429';
const anchorColumns = new Set();
const gridOffsets = new Set();
const shapes = [];          // one signature per frame: the word, and where it is
const wordsSeen = [];       // the distinct words, in the order they were shown
let readingFrames = 0;
let multiWord = null;       // the first frame that drew anything but one word
for (let i = 0; i < 20000 && calls.fillText.some((c) => c.v.startsWith('READING')); i++) {
  tick();
  const glyphs = calls.fillText.filter((c) => c.style.includes('17px')).sort((a, b) => a.x - b.x);
  if (glyphs.length === 0) continue;
  readingFrames += 1;
  const text = glyphs.map((c) => c.v).join('');
  // One word: no space in it, and no second word beside it. A page of a chapter
  // is sixty glyphs on the rail; a word is not.
  if (multiWord === null && (/\s/.test(text) || glyphs.length > 24)) multiWord = text;
  // Every cell on the grid, with no fractional position anywhere. A fractional
  // offset is exactly what the sliding version had, on every frame.
  for (const g of glyphs) gridOffsets.add(Math.round((((g.x - FOCAL) % CELL) + CELL) % CELL));
  // The anchor: the one glyph drawn in the caret's gold, and the column it is on.
  for (const g of glyphs) if (g.color === GOLD) anchorColumns.add(g.x);
  shapes.push(glyphs.map((g) => `${g.v}@${Math.round(g.x)}`).join(' '));
  if (wordsSeen[wordsSeen.length - 1] !== text) wordsSeen.push(text);
}
ok(readingFrames > 1000 && wordsSeen.length > 200,
   'reading ran a whole chapter, a frame at a time',
   `${readingFrames} frames, ${wordsSeen.length} words`);
ok(multiWord === null, 'READING MODE SHOWS EXACTLY ONE WORD AT A TIME', multiWord ?? '');
ok(wordsSeen.every((w) => w.length > 0 && !/\s/.test(w)),
   'and every one of them is a whole word with nothing beside it',
   wordsSeen.slice(0, 8).join(' '));
ok(anchorColumns.size === 1 && anchorColumns.has(FOCAL),
   'THE ANCHOR COLUMN IS IDENTICAL ON EVERY FRAME OF THE CHAPTER',
   `anchor columns: ${[...anchorColumns].join(', ')}`);
ok(gridOffsets.size === 1 && gridOffsets.has(0),
   'and every letter sits on the grid, never between two cells',
   `offsets from the focal column: ${[...gridOffsets].join(', ')}`);

// Nothing slides. A word that slid would be a different picture on every frame;
// a word that snaps is the same picture for as long as it is up, and changes
// once, whole, when the word changes.
const runLengths = [];
for (let i = 0; i < shapes.length;) {
  let j = i;
  while (j < shapes.length && shapes[j] === shapes[i]) j += 1;
  runLengths.push(j - i);
  i = j;
}
const runs = runLengths.length;
// The first and last runs are cut by where the sweep started and stopped, not
// by a word ending, so they say nothing about how long a word is held.
const shortestRun = Math.min(...runLengths.slice(1, -1));
ok(shortestRun >= 2 && runs < readingFrames / 2,
   'NOTHING SLIDES: A WORD IS THE SAME PICTURE FOR AS LONG AS IT IS UP',
   `${runs} still pictures over ${readingFrames} frames, shortest ${String(shortestRun)}`);
ok(runs === wordsSeen.length,
   'and the picture changes once per word, never inside one',
   `${runs} pictures, ${wordsSeen.length} words`);

// Punctuation reaches the screen rather than being filtered off it, which is
// also what the beat at the end of a sentence is measured against.
ok(wordsSeen.filter((w) => /[.!?]["”']?$/.test(w)).length > 5,
   'punctuation is on the page, not stripped out of it',
   wordsSeen.filter((w) => /[.!?]["”']?$/.test(w)).slice(0, 4).join(' '));

// The chapter ran out, and the sitting ended with it rather than sitting on the
// last word forever.
ok(!calls.fillText.some((c) => c.v.startsWith('READING'))
   && calls.fillText.some((c) => c.v.startsWith('next:')),
   'and the end of the chapter hands the rail back',
   `${readingFrames} frames`);

// A fresh sitting, for everything that has to be said about one that is running.
stubEl('menu-open').click();
tick(2);
stubEl('menu-read').click();
tick(2);

// It ramps and it *holds*; it never falls back on its own. This is the one mode
// in the game that exists for a day without pressure, and a pace that dropped
// unasked would be a punishment for blinking -- which is a failure state by
// another name. The player may bring it down; nothing else may.
const paces = [];
for (let i = 0; i < 200; i++) {
  tick();
  const line = calls.fillText.find((c) => c.v.startsWith('READING'));
  if (line) paces.push(Number(line.v.replace(/\D+/g, '')));
}
const fell = paces.findIndex((wpm, i) => i > 0 && wpm < paces[i - 1]);
ok(paces.length > 0 && fell === -1,
   'THE PACE NEVER FALLS UNASKED: THERE IS NO WAY TO DO BADLY IN THIS MODE',
   fell < 0 ? '' : `${paces[fell - 1]} -> ${paces[fell]} wpm at sample ${fell}`);

// The whole chapter, not the part he is in. The reference carries no part
// counter, because there is nothing here that is cut into parts.
const readingRef = calls.fillText.map((c) => c.v).find((v) => /^\w.*\d/.test(v)) ?? '';
ok(!readingRef.includes('part'), 'reading is the chapter, not the part he was typing',
   `${readingRef} (was ${typingRef})`);

// Lit against the whole board. A word half greyed here would be the curriculum
// answering a question this mode never puts.
const readingDim = dimShare();
ok(typingDim !== null && readingDim !== null && readingDim < typingDim,
   'READING LIGHTS THE PAGE THE STAGE WOULD HAVE GREYED',
   `${Math.round((readingDim ?? 1) * 100)}% dim reading, ${Math.round((typingDim ?? 0) * 100)}% typing`);

// And it asks for nothing. Letters pressed into it are not typing: nothing is
// owed, nothing is scored, and the record does not move -- the page carries on
// turning at its own pace regardless.
const beforeReadingKeys = store.get('scriptorium.progress');
const wordsWhilePressed = new Set();
for (const k of ['a', 's', 'd', 'f', 'x']) { press(k); tick(10); wordsWhilePressed.add(wordNow()); }
tick(4);
ok(!calls.fillText.some((c) => c.v.startsWith('next:')),
   'keys pressed while reading are not owed back', '');
ok(store.get('scriptorium.progress') === beforeReadingKeys,
   'AND NOTHING TYPED INTO A READING SITTING REACHES THE RECORD', '');
ok(wordsWhilePressed.size > 1,
   'and the page kept turning at its own pace while they were pressed',
   [...wordsWhilePressed].join(' '));

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
  ok(partyRows.some((t) => t.includes('Genesis 2:7') && t.includes('Adam')),
     'AND A FIGURE IS NAMED BY THE VERSE HE JOINED AT, NOT BY THE CHAPTER ALONE',
     partyRows.join(' / '));
  ok(partyRows.some((t) => t.includes('Genesis 2:24') && t.includes('Eve')),
     'so the one chapter that hands over two people can say so',
     partyRows.join(' / '));
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

// --- the default scenery, and Genesis 4 --------------------------------------
//
// Measured before this existed: 1,159 of the Bible's 1,189 chapters -- 97.5% --
// resolved to the abbey, because an authored table covers thirty of them and
// everything else fell back to one constant. Every test in the repository walked
// the authored 2.5%, which is exactly why nobody saw it. The owner did, by
// reading on out of Genesis 1 and asking why Genesis 4 was "a dungeon instead of
// a barren land".
//
// So this drives the fallback itself, off the running game: jump into chapters
// the scene table does not name, in four different books, and read the colour
// the game actually painted the sky.
// docs/design/05-scenery-warps.md#the-default-is-a-property-of-the-text-and-the-bibles-is-open-country

/** Stand at the top of a chapter and take the sky it paints. */
const skyOf = async (book, chapter) => {
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-book').value = book;
  stubEl('menu-chapter').value = String(chapter);
  stubEl('menu-go').click();
  await waitFor(() => refText().startsWith(`${book === 'Psalms' ? 'Psalm' : book} ${chapter}:`));
  tick(20);
  return skyColour();
};

// An authored abbey, so the harness knows what a cloister actually looks like on
// this screen rather than guessing at a hex string. Psalm 22-23 is `abbey` in the
// scene table, and it is the only reference point that cannot go stale.
const abbeySky = await skyOf('Psalms', 23);
const ruthSky = await skyOf('Ruth', 2);
const actsSky = await skyOf('Acts', 9);
const kingsSky = await skyOf('1 Kings', 18);

ok(abbeySky !== null && ruthSky !== null && actsSky !== null && kingsSky !== null,
   'the harness reached four chapters and the sky was painted in each',
   `${abbeySky} / ${ruthSky} / ${actsSky} / ${kingsSky}`);
ok(ruthSky !== abbeySky && actsSky !== abbeySky && kingsSky !== abbeySky,
   'AN UNAUTHORED CHAPTER IS NO LONGER A STONE CLOISTER',
   `abbey ${abbeySky}, Ruth 2 ${ruthSky}, Acts 9 ${actsSky}, 1 Kings 18 ${kingsSky}`);
ok(ruthSky === actsSky && actsSky === kingsSky,
   'and they all take one default, which is what makes it a default',
   `${ruthSky} / ${actsSky} / ${kingsSky}`);
// The authored rows still win, or the default has eaten the scene table.
ok(abbeySky !== null && (await skyOf('Exodus', 14)) !== abbeySky,
   'while an authored passage still wears the theme it was authored with', '');

// Genesis 4, as the owner asked for it: the field where the offerings are
// brought, the ground that will not yield, and Nod. Typed through, so what is
// asserted is the world the player is actually shown rather than the resolver.
const genesis4 = [];
stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '4';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 4'));
tick(20);
// A chapter is typed a stretch at a time with a report card between them, so
// this walks the stretches rather than the keys and stops the moment the game
// leaves Genesis 4 -- which it does when the chapter is finished.
for (let stretch = 0; stretch < 20; stretch += 1) {
  if (!refText().startsWith('Genesis 4')) break;
  for (let i = 0; i < 3000; i += 1) {
    const first = Number((/Genesis 4:(\d+)/.exec(refText()) ?? [])[1]);
    const sky = skyColour();
    if (Number.isInteger(first) && sky !== null) genesis4.push({ verse: first, sky });
    const k = askedFor();
    if (k === null) break;
    press(k);
    tick();
  }
  tick(2);
  await takeCardForward();
  await waitFor(() => askedFor() !== null);
}
const g4Skies = new Set(genesis4.map((g) => g.sky));
const g4Verses = new Set(genesis4.map((g) => g.verse));
ok(g4Verses.size > 2, 'the harness typed its way across Genesis 4',
   `${g4Verses.size} stretches sampled`);
ok(g4Skies.size > 1, 'GENESIS 4 CHANGES AS IT IS TYPED, RATHER THAN BEING ONE ROOM',
   `${g4Skies.size} distinct skies over ${genesis4.length} frames`);
const g4First = genesis4.length > 0 ? genesis4[0].sky : null;
const g4Last = genesis4.length > 0 ? genesis4[genesis4.length - 1].sky : null;
ok(g4First !== null && g4First !== g4Last,
   'THE FIELD AT THE START IS NOT THE GROUND HE IS DRIVEN OUT ONTO',
   `v1 ${g4First} / last ${g4Last}`);
ok(g4First === ruthSky,
   'and it opens in the same open country every unauthored chapter opens in',
   `${g4First} vs ${ruthSky}`);
ok(g4First !== abbeySky && g4Last !== abbeySky,
   'and neither end of it is the abbey the owner found here',
   `${g4First} / ${g4Last} / abbey ${abbeySky}`);

// --- the crossing into the resurrection --------------------------------------
//
// docs/decisions/0012-the-route-must-not-skip-the-events.md: the route ran
// creation, fall, I AM, the shepherd, forsaken, the crucifixion -- and then
// Revelation 22. "For a route built as promise and fulfilment, the thing the
// whole argument turns on is absent." John 20 is reached by two threads from the
// two places the story began, and neither phrase was invented for it: `the first
// day` is Genesis 1:5 and John 20:1 verbatim, in both shipped translations.
//
// What is asserted is that the newest crossing behaves exactly like the oldest
// one. The warp is the same mechanism, so the only thing that can be wrong is
// the data -- and the data is what was added.
stubEl('menu-open').click();
tick(2);
stubEl('menu-map').click();
tick(2);
const graveRow = rowsOf('map-nodes').find((li) => String(li.children[0].textContent) === 'John 20');
const toGrave = graveRow && graveRow.children.find((c) => c.tagName === 'BUTTON');
ok(Boolean(graveRow), 'THE RESURRECTION IS ON THE MAP AT ALL, WHICH IS WHAT ADR 0012 IS ABOUT',
   rowsOf('map-nodes').map(textOf).join(' / ').slice(0, 200));
ok(Boolean(toGrave), 'and Genesis 1 being finished is what opens the thread into it',
   graveRow ? textOf(graveRow) : '(John 20 is not on the map)');
ok(rowsOf('map-threads').map(textOf).some((t) => t.includes('John 20') && t.includes('first day')),
   'and the thread names the phrase the two passages share',
   rowsOf('map-threads').map(textOf).filter((t) => t.includes('John 20')).join(' / ') || '(none)');

if (toGrave) {
  const PHRASE = 'the first day';
  const want = [...PHRASE].filter((c) => c !== ' ').length;
  const boldNow = () => calls.fillText.filter((c) => c.style.includes('bold 17px'));
  const holdsPhrase = () => {
    const bold = boldNow();
    return bold.length >= want
      && bold.slice(-want).map((c) => c.v).join('') === PHRASE.replace(/ /g, '');
  };
  toGrave.click();
  const began = await waitFor(holdsPhrase);
  ok(began, 'travelling it starts a crossing, and the echo is lit on the rail',
     boldNow().map((c) => c.v).join('') || '(nothing held)');
  const graveColumns = new Set();
  const graveRibbons = new Set();
  let graveHeld = 0;
  for (let i = 0; i < 140; i++) {
    tick();
    const bold = boldNow();
    if (bold.length < want) continue;
    const phrase = bold.slice(-want);
    if (phrase.map((c) => c.v).join('') !== PHRASE.replace(/ /g, '')) continue;
    graveColumns.add(phrase.map((c) => Math.round(c.x * 1e6) / 1e6).join(','));
    graveRibbons.add(calls.fillText.filter((c) => c.style.includes('17px')).length);
    graveHeld += 1;
  }
  ok(graveHeld > 1, 'the crossing runs for more than one frame', `${graveHeld} frames`);
  ok(graveColumns.size === 1,
     'AND THE ECHO INTO JOHN 20 HOLDS STILL, EXACTLY LIKE EVERY OLDER THREAD',
     `${graveColumns.size} distinct column sets: ${[...graveColumns].join(' | ')}`);
  ok(graveRibbons.size > 1,
     'while the ribbon under it changed, so something really was held across a cut',
     `ribbon lengths: ${[...graveRibbons].join(', ')}`);
  await waitFor(() => refText().startsWith('John 20'));
  ok(refText().startsWith('John 20'), 'and it arrives at the resurrection', refText());

  // She arrives in the dark and it changes under her: tomb through verse 15,
  // garden from verse 16. Both ends are read off the sky the game painted.
  const tombSky = skyColour();
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-map').click();
  tick(2);
  const met = rowsOf('map-party').map(textOf);
  ok(met.some((t) => t.includes('Mary Magdalene')) === false,
     'and she has not joined yet, because the chapter is not finished',
     met.join(' / ').slice(0, 160));
  press('Escape');
  tick(4);
  ok(tombSky !== null && tombSky !== abbeySky && tombSky !== ruthSky,
     'JOHN 20 OPENS IN THE TOMB, WHICH IS NEITHER THE DEFAULT NOR THE ABBEY',
     `${tombSky} / default ${ruthSky} / abbey ${abbeySky}`);
}

// Back where the rest of the harness expects to be standing.
stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '1';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 1'));
await waitFor(() => askedFor() !== null);
tick(20);

// --- the camera must not eat the leap ----------------------------------------
//
// The scribe leaps at a fixed screen column and the monster's column is
// derived from the camera, so a camera still closing on the monster while the
// hop plays takes the gap out from under it. At speed a word lands about every
// 430 ms against a 460 ms hop, so the world takes a whole stride out of a blow
// designed to cross `strike_reach`. That is the real cause of the owner's first
// report on combat -- "you just stand on top of them for a bit" -- and no value
// of `strike_hop_px` fixes it. docs/design/03-pacing.md#the-camera-must-not-eat-the-leap
//
// Only the running game can see this: `core/entities.ts` returns a *fraction*
// along a path it cannot resolve, and what the fraction is worth in pixels is
// decided by the camera in the platform's frame loop.

/**
 * Where the scribe's feet are on his own line, this frame.
 *
 * Read per frame rather than once, because the ground line is a property of the
 * world and Genesis 1 is seven of them. During a stomp there is no sprite on
 * that column at all -- he is in the air -- so the last reading stands, which is
 * exactly right: the ground cannot move while the camera is held.
 */
let standY = null;
const groundNow = () => {
  const feet = calls.sprites.filter((s) => s.x === SCRIBE_X).map((s) => s.y);
  if (feet.length > 0) standY = Math.max(...feet);
  return standY;
};

/**
 * Whatever a blow has in the air this frame, ahead of the scribe.
 *
 * Lifted off the ground line and inside two strides of him, which is the
 * hopping scribe and the thrown nib and nothing else on the screen: a skeleton
 * stands *on* the line and is excluded by the strict `<`, a bat hangs 34 px
 * above it, and the company walks behind him. `travel` reaches 1 at contact, so
 * the furthest one of these gets is the gap the blow actually crossed.
 *
 * It is also how the harness knows a monster was felled at all, which is what
 * the section below needs: nothing is lifted over the gap unless something is
 * being struck.
 */
const blowAhead = () => {
  const y0 = groundNow();
  if (y0 === null) return [];
  return calls.sprites.filter(
    (s) => s.x > SCRIBE_X && s.x <= SCRIBE_X + STRIKE_REACH * 2
      && s.y < y0 && s.y > y0 - STRIKE_REACH,
  );
};

let reached = 0;
let blowFrames = 0;
let blowRuns = 0;
let movedDuringBlow = 0;
let runPhase = null;
const restPhases = new Set();
for (let i = 0; i < 240; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  // Four frames a keystroke: fast enough that a hop and the next completed word
  // overlap, which is the only speed at which the fault is visible at all.
  for (let f = 0; f < 4; f++) {
    tick(1);
    const blow = blowAhead();
    if (blow.length === 0) {
      restPhases.add(layerPhase());
      runPhase = null;
      continue;
    }
    blowFrames += 1;
    // The *nearest* of them to his standing column, because a felled monster
    // sometimes leaves an ink pot floating where it stood and that pot is not
    // the blow. The scribe is between him and it until contact, where the two
    // coincide -- so the nearest is the leap, all the way across.
    reached = Math.max(reached, Math.min(...blow.map((s) => s.x)) - SCRIBE_X);
    // Per blow, not across the run: the camera is somewhere different for every
    // monster, and what must not happen is that it moves *while one is being
    // struck*.
    const phase = layerPhase();
    if (runPhase === null) { blowRuns += 1; runPhase = phase; continue; }
    if (phase !== runPhase) movedDuringBlow += 1;
  }
}

console.log(`  ..    the blow crossed ${reached}px of its ${STRIKE_REACH}px reach `
  + `over ${blowRuns} blow(s), ${blowFrames} frames`);

ok(blowRuns > 0, 'the harness felled something and watched the blow land',
   `${blowFrames} frames with a blow in the air`);
ok(restPhases.size > 1, 'and the world really does scroll the rest of the time, '
   + 'so the next assertion is not vacuous', `${restPhases.size} parallax positions`);
ok(movedDuringBlow === 0,
   'THE CAMERA HOLDS STILL WHILE A BLOW IS LANDING, HOWEVER FAST HE TYPES',
   `${movedDuringBlow} of ${blowFrames} frames moved the world under a blow`);
ok(reached >= STRIKE_REACH - 2,
   'SO THE BLOW CROSSES THE GAP IT WAS DESIGNED TO CROSS, EVEN AT SPEED',
   `${reached}px of the ${STRIKE_REACH}px reach`);

// And back to the top of the chapter, because the sections below expect a part
// with verses left in it.
stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '1';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 1'));
await waitFor(() => askedFor() !== null);
tick(20);

// --- a monster is felled by a clean word -------------------------------------
//
// "A word typed clean fells the monster. A word with a mistake in it does not --
// the monster survives and the scribe walks past it." Nothing blocks, chases or
// costs: what he loses is a reward he did not earn, which is not a penalty, and
// that difference is the whole of ADR 0004.
// docs/design/03-pacing.md#a-monster-is-felled-by-a-clean-word-not-by-any-word
//
// A blow in the air is the observable, and it is the only one there is: a
// monster that is not felled is simply still standing, and a screen with a
// monster on it looks exactly like a screen with a monster on it. So the
// harness types the same opening of the same chapter three times -- the monsters
// are seeded from the passage, so it is the same monsters each time -- and
// counts the blows.

/**
 * Back to the top of Genesis 1, which is the same seed and the same monsters.
 *
 * It waits for the *overlay* to go away as well as for the reference to say
 * Genesis 1, and both halves matter here in a way they do not elsewhere in this
 * file: this is the only place that navigates to the chapter it is already
 * standing in, so the citation is true before the panel has closed -- and the
 * keyboard is handed back only when it does. A run driven into a menu that is
 * still open types nothing and asserts nothing.
 */
async function openGenesis1() {
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-book').value = 'Genesis';
  stubEl('menu-chapter').value = '1';
  stubEl('menu-go').click();
  await waitFor(() => !panel('overlay') && refText().startsWith('Genesis 1:1'));
  await waitFor(() => askedFor() !== null);
  tick(20);
}

/** Whether the wrong-key setting is `stand` or `block`, applied and remembered. */
async function setWrongKeys(value) {
  stubEl('menu-open').click();
  tick(2);
  stubEl('menu-mistakes').value = value;
  stubEl('menu-mistakes').dispatchEvent({ type: 'change' });
  await waitFor(() => record().mistakesStand === (value === 'stand'));
  // The switch rebuilds the part in place, and nothing on the screen says so.
  await pump();
  stubEl('menu-resume').click();
  await waitFor(() => !panel('overlay') && askedFor() !== null);
  tick(8);
}

/**
 * Type this many characters, counting the blows that land.
 *
 * `fumble` is called with the character owed at the start of each word, and is
 * where the mistake goes. Once per word rather than once per keystroke, so the
 * smudge meter drains between them: a wrong key on every letter would empty his
 * hearts before the harness reached the first monster, and what is being
 * measured here is not the damage model.
 */
function countBlows(keys, fumble) {
  let blows = 0;
  let inBlow = false;
  let wordStart = true;
  let typed = 0;
  for (let i = 0; i < keys; i++) {
    const k = askedFor();
    if (k === null) break;
    if (wordStart && fumble) fumble(k);
    wordStart = k === ' ';
    press(k);
    typed += 1;
    for (let f = 0; f < 4; f++) {
      tick(1);
      if (blowAhead().length === 0) { inBlow = false; continue; }
      if (!inBlow) { blows += 1; inBlow = true; }
    }
  }
  return { blows, typed };
}

/** A key that is not the one being asked for. */
const wrongFor = (k) => (k === 'f' ? 'j' : 'f');

const KEYS = 240;
await openGenesis1();
const clean = countBlows(KEYS, null);
ok(clean.blows > 0, 'typed clean, the opening of the chapter fells monsters',
   `${clean.blows} blow(s) over ${clean.typed} keys`);

await openGenesis1();
const fumbled = countBlows(KEYS, (k) => { press(wrongFor(k)); tick(1); });
ok(fumbled.typed === clean.typed, 'the fumbled run typed the same passage',
   `${fumbled.typed} keys against ${clean.typed}`);
ok(fumbled.blows === 0,
   'A WORD WITH A MISTAKE IN IT FELLS NOTHING: THE MONSTER SURVIVES AND HE WALKS PAST',
   `${fumbled.blows} blow(s) where a clean run landed ${clean.blows}`);

// And nothing happened to him for it. No heart, no block, no second chance: the
// monster still standing is the entire feedback, and this is the assertion that
// says so out loud.
ok(record().position !== undefined && refText().startsWith('Genesis 1'),
   'and he is still walking through the same chapter, having lost nothing but a reward',
   refText());

// The owner's ruling: a word repaired with backspace still fells the monster.
// The WPM lost while repairing is penalty enough.
// docs/decisions/0010-mistakes-may-stand-and-be-deleted.md
await setWrongKeys('stand');
await openGenesis1();
const repaired = countBlows(KEYS, (k) => {
  press(wrongFor(k));
  tick(1);
  press('Backspace');
  tick(1);
});
ok(repaired.blows > 0,
   'BUT A WORD REPAIRED WITH BACKSPACE STILL FELLS IT, WHICH IS THE OWNER\u2019S RULING',
   `${repaired.blows} blow(s) over ${repaired.typed} keys`);

// --- mistakes may stand, and be deleted --------------------------------------
//
// "I found I was getting hung up trying to type the correct letter when I made a
// mistake because I was trying to correct the letter I had typed automatically."
// Everywhere else a keyboard is used a wrong letter appears and is removed with
// backspace; blocking gives that reflex nothing to act on. An opt-in mode, off
// by default. docs/decisions/0010-mistakes-may-stand-and-be-deleted.md
//
// Backspace was reaching the game and being dropped on the floor, so the only
// way to know it is let through is to press it and watch the page.

const ERROR_COLOUR = '#d6524a';
const wrongOnRail = () => rail().filter((c) => c.color === ERROR_COLOUR).map((c) => c.v);

await openGenesis1();
tick(8);
const owed = askedFor();
ok(owed !== null, 'the game is asking for a key to get it wrong', refText());
const beforeStanding = { caret: caretX(), wrong: wrongOnRail().length };

press(wrongFor(owed));
tick(8);
ok(wrongOnRail().length === beforeStanding.wrong + 1,
   'A WRONG KEY LEAVES ITS LETTER ON THE PAGE, MARKED WRONG',
   `${wrongOnRail().join('')} on the rail`);
ok(wrongOnRail().includes(wrongFor(owed)),
   'and the letter on the page is the one he actually typed',
   `${wrongOnRail().join('')} for a struck ${wrongFor(owed)}`);
ok(askedFor() !== null && askedFor() !== owed || owed === wrongFor(owed),
   'and the cursor moved on, so his hands keep the pace they set',
   `${String(owed)} \u2192 ${String(askedFor())}`);
ok(caretX() === beforeStanding.caret && caretX() === FOCAL,
   'AND THE READING COLUMN DID NOT MOVE: A WRONG LETTER IS ONE CELL, LIKE THE RIGHT ONE',
   `${String(caretX())} against ${String(beforeStanding.caret)}`);

press('Backspace');
tick(8);
ok(wrongOnRail().length === beforeStanding.wrong,
   'BACKSPACE REMOVES IT, AS IN ANY TEXT FIELD',
   `${wrongOnRail().join('')} still standing`);
ok(askedFor() === owed, 'and steps back onto the letter it took away',
   `${String(askedFor())} against ${String(owed)}`);
ok(caretX() === FOCAL, 'with the reading column where it always is', String(caretX()));

// Accuracy counts every keypress, so nothing is hidden by letting the mistake
// stand. The error is still in the record after the repair.
const accAfter = calls.fillText.map((c) => c.v).find((v) => v.includes('ACC '));
ok(accAfter !== undefined && !accAfter.includes('ACC 100%'),
   'AND THE ERROR IS STILL IN HIS ACCURACY: A REPAIR CANNOT HIDE A KEYPRESS',
   accAfter ?? '(no accuracy on the HUD)');

// Off -- the default, and the beginner's game -- a wrong key does not move him
// along, and backspace does nothing whatever. The first run says so in those
// words, and it has to stay true.
await setWrongKeys('block');
await openGenesis1();
tick(8);
const blockOwed = askedFor();
const blockRail = railAt();
press(wrongFor(blockOwed));
tick(8);
ok(askedFor() === blockOwed,
   'OFF BY DEFAULT, A WRONG KEY STILL DOES NOT MOVE YOU ALONG',
   `${String(askedFor())} against ${String(blockOwed)}`);
ok(wrongOnRail().length <= 1,
   'and nothing is left standing on the page behind him',
   wrongOnRail().join(''));
press('Backspace');
tick(8);
ok(askedFor() === blockOwed && railAt() === blockRail,
   'AND BACKSPACE DOES NOTHING AT ALL, WHICH IS WHAT THE FIRST RUN PROMISES',
   `${String(askedFor())} against ${String(blockOwed)}`);

await openGenesis1();

// --- the mode is marked on the progress curve --------------------------------
//
// Gilded and ungilded stretches shared one line with nothing between them, and
// they are not comparable: one asks for the characters a stage has taught and
// the other asks for every character on the page. The owner went from 22 wpm to
// 75 across that switch in one sitting, and later to 102 -- which on the curve
// draws a cliff that reads as a breakthrough and is not one.
// docs/design/08-stats.md#the-mode-is-marked-on-the-curve-because-a-mode-change-is-not-progress
//
// Only the running game can see this end to end: the flag is written by a
// finished stretch, the boundary is found between two of them, and the mark and
// its explanation are assembled in the platform.

const SWITCH_MARK = '│';
const historyOf = () => record().history ?? [];
const historyBefore = historyOf().length;
ok(historyBefore > 0, 'there are finished stretches to mark a boundary between',
   `${historyBefore} in the record`);
ok(historyOf().every((e) => e.gilding === false),
   'and every one of them so far was typed with the dim letters left alone', '');

// Ask for every character instead, and finish one stretch that way.
stubEl('menu-open').click();
tick(2);
stubEl('menu-gilding').value = 'on';
stubEl('menu-gilding').dispatchEvent({ type: 'change' });
await waitFor(() => record().gilding === true);
await pump();
stubEl('menu-resume').click();
await waitFor(() => !panel('overlay') && rail().length > 0);
tick(20);
ok(record().gilding === true, 'the mode really is on', String(record().gilding));

/**
 * The character sitting on the focal column.
 *
 * `askedFor` cannot be used here: with every character required the overlay
 * lights nothing while the cursor rests on one the stage has not taught, which
 * is deliberate -- pointing at it would show a beginner where an untaught key
 * lives. So the harness reads the page instead of the hint. A column with no
 * glyph on it is a space, which prints nothing by design.
 */
const underCaret = () => rail().find((c) => Math.round(c.x) === FOCAL)?.v ?? ' ';

let gilded = 0;
for (let i = 0; i < 4000; i++) {
  if (historyOf().length > historyBefore) break;
  const before = railAt();
  press(underCaret());
  gilded += 1;
  // Long enough for the ribbon to settle on the next column, since the column
  // is what is being read back.
  tick(12);
  if (railAt() === before) break;
}
ok(historyOf().length > historyBefore,
   'a stretch was typed with every character of it asked for',
   `${gilded} keys, ${historyOf().length - historyBefore} stretch(es) recorded`);

const marked = historyOf();
const lastEntry = marked[marked.length - 1];
const beforeEntry = marked[marked.length - 2];
ok(lastEntry !== undefined && lastEntry.gilding === true,
   'AND THE RECORD KEEPS WHICH MODE THE STRETCH WAS TYPED IN',
   JSON.stringify(lastEntry ?? null));
ok(beforeEntry !== undefined && beforeEntry.gilding === false,
   'while the stretch before it kept the other one, which is what makes a boundary',
   JSON.stringify(beforeEntry ?? null));

await takeCardForward();
stubEl('menu-open').click();
tick(4);
const marks = rowsOf('menu-history').map(textOf);
ok(marks.some((t) => t.includes(SWITCH_MARK)),
   'THE HISTORY MARKS THE ROW WHERE WHAT THE PAGE ASKS FOR CHANGED',
   marks.slice(0, 3).join(' / '));
ok(marks.some((t) => t.includes(SWITCH_MARK) && t.includes('every letter asked for')),
   'and says which way it changed',
   marks.find((t) => t.includes(SWITCH_MARK)) ?? '');
const noteText = String(stubEl('history-note').textContent);
ok(noteText.includes(SWITCH_MARK) && /two different jobs/.test(noteText),
   'AND SAYS THE TWO SIDES ARE NOT THE SAME TEST, IN THE PROMOTION DIP\u2019S OWN REGISTER',
   noteText.slice(-160));

stubEl('menu-hands').click();
tick(4);
const curveNote = String(stubEl('hands-curve-note').textContent);
ok(/rule between/.test(curveNote) && /two different jobs/.test(curveNote),
   'AND THE CURVE UNDER THE REPORT CARD EXPLAINS ITS OWN MARK',
   curveNote.slice(0, 160));
press('Escape');
tick(4);

// Back to the letters the stage teaches, because everything below expects the
// game it had -- and because a mode nobody can leave is not a mode.
stubEl('menu-open').click();
tick(2);
stubEl('menu-gilding').value = 'off';
stubEl('menu-gilding').dispatchEvent({ type: 'change' });
await waitFor(() => record().gilding === false);
await pump();
stubEl('menu-resume').click();
await waitFor(() => !panel('overlay') && askedFor() !== null);
ok(record().gilding === false, 'and it goes back the way it came', String(record().gilding));

await openGenesis1();

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

// --- the scribe at his lectern -----------------------------------------------
//
// The keyboard overlay is a scaffold, and the curriculum retires it a key at a
// time as each one's accuracy passes the threshold. What fills the band it
// vacates is the scribe at his lectern: quill moving as the player types, page
// filling as he copies. It is the best reward the game has, because it is the
// thing the game is about -- he stops needing the keys drawn for him and gets to
// watch himself write. docs/design/02-rail.md#the-scribe-at-his-lectern
//
// Nothing here is reachable from a core test in the way that matters: what has
// to be true is that the board really does empty for a player who has typed,
// and the only way to know that is to have typed.

const { overlayLayout } = await import(
  pathToFileURL(resolve(ROOT, 'build/core/keyboard.js')).href
);
const BOARD_KEYS = overlayLayout('ansi', 'rt').length;
const KB_TOP = 210;
// A key face is one key unit tall less its padding: `M.kbUnit` minus twice
// `M.keyPad`. Nothing the lectern draws is exactly that tall, which is what
// lets the two be told apart in a flat list of rectangles.
const KEY_H = 26 - 2 * 2;
/** Key faces: every rect in the band exactly one key unit tall. */
const keyFaces = () => calls.fills.filter((f) => f.y >= KB_TOP && f.h === KEY_H);
/** Everything else drawn down there, which is the lectern and nothing but. */
const lectern = () => calls.fills.filter((f) => f.y >= KB_TOP && f.h !== KEY_H);
const lecternShape = () => lectern().map((f) => `${f.x},${f.y},${f.w},${f.h}`).join(' ');
/** The written lines on the page: wide and two pixels tall. */
const written = () => lectern().filter((f) => f.h === 2 && f.w > 10).length;

/** How solid the board is being drawn: the brightest key face on it. */
const boardPresence = () => Math.max(...keyFaces().map((f) => f.alpha ?? 1));

tick(4);
// Earned fade-out once dropped a mastered key out of the display list, and the
// board grew holes as the player improved. He reported it the same evening:
// "why are some keys missing from the keyboard?" The overlay must match the
// board under his hands exactly or it teaches the wrong finger
// (docs/design/06-curriculum.md#keyboard-layout), and a reward that reads as
// damage is not a reward. So the board is *whole* at every level of mastery,
// and what it gives back it gives back by receding.
ok(keyFaces().length === BOARD_KEYS,
   'EVERY KEY IS STILL ON THE BOARD, HOWEVER MUCH OF IT HE HAS EARNED',
   `${keyFaces().length} of ${BOARD_KEYS} keys drawn`);
ok(boardPresence() < 1,
   'AND WHAT MASTERY TOOK IS THE BOARD\u2019S PRESENCE, NOT ITS KEYS',
   `brightest key face at alpha ${boardPresence().toFixed(3)}`);
ok(lectern().length > 0,
   'AND WHAT IS BEHIND IT IS THE SCRIBE AT HIS LECTERN',
   `${lectern().length} shapes in the band`);
ok(lectern().every((f) => f.y >= KB_TOP && f.y + f.h <= 360),
   'HE IS BELOW THE RAIL AND NEVER ENTERS IT',
   `lowest ${Math.max(...lectern().map((f) => f.y + f.h))}, highest ${Math.min(...lectern().map((f) => f.y))}`);

// Nothing announced. The band gains a picture and not a sentence: no text is
// drawn below the rail that was not there before, and in particular nothing
// congratulates him. The tone sweep at the foot of this file reads everything
// the game ever said, so this only has to check that the band stayed quiet.
// A key face carries a label and the hint line names the next key; a *sentence*
// is the thing that must not appear. So: nothing below the rail says more than
// one word, except the line that was always there.
const said = calls.fillText.filter(
  (c) => c.y >= KB_TOP && c.v.includes(' ') && !/^next:/.test(c.v),
);
ok(said.length === 0, 'and nothing down there says anything about it',
   said.map((c) => c.v).join(' | ').slice(0, 120));

// It moves only when the player types. A quill scratching while somebody is
// thinking is the same lie as a world that scrolls without them, which is
// docs/decisions/0004-idle-threat-not-speed-timer.md applied to the one picture
// in the game that is *about* typing.
const restingQuill = lecternShape();
tick(200);
ok(lecternShape() === restingQuill,
   'THE QUILL DOES NOT MOVE WHILE THE PLAYER IS THINKING',
   lecternShape() === restingQuill ? '' : 'it moved with nobody typing');

const writtenBefore = written();
let quillMoved = false;
for (let i = 0; i < 60; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick(2);
  if (lecternShape() !== restingQuill) quillMoved = true;
}
ok(quillMoved, 'AND IT MOVES THE MOMENT HE DOES', '');
ok(written() >= writtenBefore,
   'and the page fills as he copies, rather than emptying',
   `${writtenBefore} lines to ${written()}`);

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

// --- the sound control reports the device, not the setting -------------------
//
// "it says 'on' for sound, but no sound." The control read `audio.on` -- the
// *setting* -- and never asked whether the browser had actually started an
// `AudioContext`. Every assertion above passes against a stub, and a stub cannot
// prove a browser made a noise, so the control was asserting a state nobody had
// verified: degraded operation wearing the look of normal operation, which is
// docs/decisions/0009-fallbacks-must-announce-themselves.md in a third costume.
//
// What can be driven here is the gap itself: suspend the device the way a
// browser does and watch the label. It must stop saying "on".

const audioLabel = () => String(stubEl('audio-toggle').textContent ?? '');
const audioNoteUp = () => stubEl('audio-note').hidden === false;

ok(audio.ctx.state === 'running' && /sound: on$/.test(audioLabel()),
   'A RUNNING DEVICE IS REPORTED AS ON, PLAINLY', audioLabel());
ok(!audioNoteUp(), 'and nothing else is said, because nothing is wrong');

// Suspended. Nothing about the setting changed; the sound stopped anyway.
audio.ctx.state = 'suspended';
tick(60);
ok(/sound: on$/.test(audioLabel()) === false && /sound: on/.test(audioLabel()),
   'A SUSPENDED DEVICE IS NOT REPORTED AS ON',
   audioLabel());
ok(/press a key/.test(audioLabel()),
   'AND THE LABEL SAYS THE ONE THING THAT FIXES IT', audioLabel());
ok(audioNoteUp(),
   'AND IT IS SAID BESIDE THE CONTROL, WHERE HE IS ALREADY LOOKING',
   `#audio-note hidden=${String(stubEl('audio-note').hidden)}`);

// And the diagnostic: the browser's own account of the device, reachable from
// the menu. We have twice had to guess at why one machine was silent. This is
// the game answering instead.
stubEl('menu-open').click();
tick(2);
const audioSaid = String(stubEl('menu-audio-state').textContent ?? '');
const audioDiag = String(stubEl('menu-audio-detail').textContent ?? '');
ok(/^Sound is on, but the browser has not started/.test(audioSaid),
   'THE MENU SAYS WHAT IS TRUE OF THE DEVICE, NOT WHAT THE SETTING SAYS', audioSaid);
ok(/Device: suspended/.test(audioDiag),
   'AND IT SURFACES THE REAL AudioContext STATE', audioDiag);
ok(/opened this sitting: [1-9]/.test(audioDiag) && /notes sent: [1-9]/.test(audioDiag),
   'AND HOW MANY DEVICES WERE OPENED AND WHETHER A NOTE WAS EVER SCHEDULED', audioDiag);

// Out of the menu, and back to a device that plays -- the run below is entitled
// to the state it would have had.
press('Escape');
tick(4);
const resumedFrom = audio.notes;
const backKey = askedFor();
if (backKey !== null) press(backKey);
await waitFor(() => audio.ctx.state === 'running', 20);
tick(60);
ok(/sound: on$/.test(audioLabel()) && audio.notes > resumedFrom,
   'AND IT GOES BACK TO SAYING ON THE MOMENT THE DEVICE IS ACTUALLY RUNNING',
   `${audioLabel()} · ${audio.notes - resumedFrom} notes`);

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

/**
 * Let every game booted so far finish whatever it was doing.
 *
 * Each boot leaves the one before it listening for keys, and a stretch it was
 * opening when it last saw an Enter writes the record when its fetch resolves --
 * *after* the next record has been forged into storage, which is how a boot ends
 * up reading somebody else's bookmark. Nothing here presses anything; it only
 * gives the pending promises somewhere to land.
 */
async function quiesce() {
  await pump(20);
}

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
// Counted over the roster's rows rather than over the route's nodes, because the
// two stopped being the same thing: Genesis 1 and Genesis 3 hand over nobody, and
// Genesis 2 hands over two -- Adam at 2:7 and Eve at 2:24.
// docs/design/11-followers.md#who-joins-after-what
const ROSTER_ROWS = JSON.parse(
  await readFile(resolve(ROOT, 'data/followers.json'), 'utf8'),
).followers;
const ROUTED = new Set(FINISHED);
const MET = ROSTER_ROWS.filter((f) => ROUTED.has(f.passage)).length;
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
ok(overflow !== undefined && Number(overflow.v.slice(1)) === MET - CAP,
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
ok(wholeParty.length === MET,
   'THE MAP NAMES EVERYONE, INCLUDING THE ONES THE SCREEN IS NOT SHOWING',
   `${wholeParty.length} named, ${MET} met`);
ok(/walk on ahead/.test(String(stubEl('map-party-note').textContent)),
   'and says why some of them are not on the screen',
   String(stubEl('map-party-note').textContent));

// And the other end of the lectern: a player who has earned nothing is shown
// none of it. The record booted above has an empty key table, so the board is
// whole and there is nothing behind it -- the reward *is* the crutch leaving,
// and it cannot arrive before the crutch has been earned away.
// docs/design/02-rail.md#the-scribe-at-his-lectern
press('Escape');
tick(6);
ok(keyFaces().length === BOARD_KEYS,
   'A PLAYER WHO HAS EARNED NOTHING STILL HAS THE WHOLE BOARD',
   `${keyFaces().length} of ${BOARD_KEYS} keys drawn`);
ok(boardPresence() === 1,
   'and it is at full strength, because he has earned none of it away',
   `brightest key face at alpha ${boardPresence()}`);
ok(lectern().length === 0,
   'AND NOTHING OF THE LECTERN IS BEHIND IT YET, BECAUSE NOTHING HAS BEEN GIVEN UP',
   `${lectern().length} shapes in the band`);

// --- one strip, two things to say, and neither of them lost ------------------
//
// Psalm 23 both hands over a figure and has a thread leaving it, so the strip is
// asked for two sentences at one keystroke. The rarer wins it -- a thread is
// offered five times in a player's life and a follower arrives twenty times --
// and the other one *waits* rather than being counted down under it and lost.
// That is not the tutorial wall arriving late: a coaching note is queued behind
// nothing because its occasion comes round again, and a passage is finished once.
// docs/design/11-followers.md#arriving-with-a-line
await quiesce();
store.set('scriptorium.progress', JSON.stringify({
  version: 6, stage: 1, translation: 'WEB', route: 'pilgrimage',
  position: { book: 'Psalms', chapter: 23, unit: 6 },
  completed: [], discovered: [],
  keyStats: {}, recent: {}, history: [],
  gilding: false, gildOffered: true, firstRun: false, cloudEnabled: true,
  notesSeen: ['space', 'error', 'dim'],
}));
await import(`${pathToFileURL(resolve(ROOT, 'build/platform/web/main.js')).href}?both`);
await new Promise((r) => setTimeout(r, 400));
const lastOfPsalm23 = () => /^Psalms 23:(6|\d+-6)$/.test(refText());
await waitFor(() => lastOfPsalm23() && askedFor() !== null);
tick(4);
ok(lastOfPsalm23(), 'the harness is standing on the last stretch of Psalm 23', refText());
await typeOutPart();
await takeCardForward();
tick(2);
ok((offerNow() ?? '').includes('John 10'),
   'A PASSAGE THAT DOES BOTH OFFERS ITS THREAD FIRST',
   offerNow() ?? `strip: ${stripText().join(' | ') || '(empty)'}`);
ok(arrivalNow() === undefined, 'and the arrival is not saying anything over the top of it',
   stripText().join(' | '));
for (let i = 0; i < HOLD + 2; i++) {
  const k = askedFor();
  if (k === null) break;
  press(k);
  tick();
}
ok(offerNow() === undefined && arrivalNow() === 'The shepherd walks with you.',
   'AND THE ARRIVAL TAKES THE STRIP WHEN THE OFFER GOES, RATHER THAN BEING LOST',
   stripText().join(' | ') || '(empty)');

// --- taking the offer is one key, and it is the same crossing ----------------
//
// The strip says `tab:`, and the whole claim is that the key does what the
// sentence says. It is the same thread the route screen travels -- `travelTo`
// finds the edge again from the record rather than being handed one -- so this
// is a shortcut onto the graph and not a second way onto it.
//
// A record with Genesis 1 behind it and nothing else, standing on the chapter's
// last stretch: finishing it offers John 1, exactly as it did on the long run
// above, and Tab takes it.
await quiesce();
store.set('scriptorium.progress', JSON.stringify({
  version: 6, stage: 1, translation: 'WEB', route: 'pilgrimage',
  position: { book: 'Genesis', chapter: 1, unit: 31 },
  completed: ['Genesis 1'], discovered: [],
  keyStats: {}, recent: {}, history: [],
  gilding: false, gildOffered: true, firstRun: false, cloudEnabled: true,
  notesSeen: ['space', 'error', 'dim'],
}));
await import(`${pathToFileURL(resolve(ROOT, 'build/platform/web/main.js')).href}?taken`);
await new Promise((r) => setTimeout(r, 400));
// Wait for *this* boot's level rather than for whichever game is still drawing:
// every game booted above is still listening for keys, and typing into the one
// on the way out is how a run measures the game it was trying to leave.
await waitFor(() => refText() === 'Genesis 1:31' && askedFor() !== null);
tick(4);
ok(refText() === 'Genesis 1:31', 'the harness is standing on the last stretch of Genesis 1',
   refText());
await typeOutPart();
ok(offerNow() !== undefined, 'the offer is standing over the report card, waiting',
   offerNow() ?? `strip: ${stripText().join(' | ') || '(empty)'}`);
await takeCardForward();
tick(2);
ok(offerNow() !== undefined,
   'AND IT IS STILL THERE ON THE NEXT STRETCH OF VERSES, WHERE HE IS LOOKING',
   offerNow() ?? `strip: ${stripText().join(' | ') || '(empty)'}`);
const leftFrom = refText();
press('Tab');
const crossed = await waitFor(() => refText().startsWith('John 1'));
ok(crossed, 'TAB TAKES THE THREAD THE STRIP IS NAMING', `${leftFrom} -> ${refText()}`);
tick(4);
ok(offerNow() === undefined, 'and the offer is spent by being taken',
   offerNow() ?? '(nothing in the strip)');

// --- and the offer is silent on a passage already travelled from --------------
//
// An offer that came back every time a chapter was finished would be nagging,
// and this game has a rule about a tip that returns after you have understood
// it. So one more boot, onto a record that has travelled the whole route and is
// standing on the *last* stretch of Genesis 1 -- finishing which re-completes a
// passage every thread out of which is already behind him.
//
// The positive case is asserted four hundred lines above, on a record that had
// travelled nothing: the offer appeared, named John 1 and named the echo. This
// is the silence being tested, not the wiring being absent.
// docs/design/04-route.md#it-is-silent-on-a-passage-already-travelled-from
await quiesce();
store.set('scriptorium.progress', JSON.stringify({
  version: 6, stage: 1, translation: 'WEB', route: 'pilgrimage',
  position: { book: 'Genesis', chapter: 1, unit: 31 },
  completed: FINISHED, discovered: FINISHED,
  keyStats: {}, recent: {}, history: [],
  gilding: false, gildOffered: true, firstRun: false, cloudEnabled: true,
  notesSeen: ['space', 'error', 'dim'],
}));
await import(`${pathToFileURL(resolve(ROOT, 'build/platform/web/main.js')).href}?travelled`);
await new Promise((r) => setTimeout(r, 400));
await waitFor(() => refText() === 'Genesis 1:31' && askedFor() !== null);
tick(4);
const againAt = refText();
await typeOutPart();
const wentOnTo = record().position ?? {};
ok(againAt === 'Genesis 1:31' && wentOnTo.book === 'Genesis' && wentOnTo.chapter === 2,
   'the harness really did finish the last stretch of Genesis 1 again',
   `${againAt} -> ${String(wentOnTo.book)} ${String(wentOnTo.chapter)}`);
ok(offerNow() === undefined,
   'THE OFFER IS SILENT ON A PASSAGE ALREADY TRAVELLED FROM',
   offerNow() ?? '(nothing in the strip)');


// --- a chapter with no verse rows still plays exactly one tune ----------------
//
// The other half of the crossfade, and the one that matters most: 1,158 of the
// Bible's 1,189 chapters have no verse rows at all, so almost the whole book
// must sound exactly as it did before any of this existed -- one tune, at full,
// from the first verse to the last. Genesis 2 is such a chapter: `Genesis 2-3`
// is a chapter row, and the verse rows in that range are all in Genesis 3.
// docs/design/09-music.md#the-music-follows-the-scenery
stubEl('menu-open').click();
tick(2);
stubEl('menu-book').value = 'Genesis';
stubEl('menu-chapter').value = '2';
stubEl('menu-go').click();
await waitFor(() => refText().startsWith('Genesis 2') && askedFor() !== null);
tick(4);

const settledFrom = graph.writes.length;
await typeOutPart();
let settledFrames = 0;
let doubled = 0;
let dipped = 0;
watchMix((level) => {
  const up = [...level.values()].filter((gain) => gain > 0);
  settledFrames += 1;
  if (up.length !== 1) doubled += 1;
  else if (up[0] !== 1) dipped += 1;
}, settledFrom);
ok(settledFrames > 0 && doubled === 0 && dipped === 0,
   'A CHAPTER WITH NO VERSE ROWS PLAYS ONE TUNE, AT FULL, ALL THE WAY THROUGH',
   `${settledFrames} frames, ${doubled} with two tunes, ${dipped} below full`);

// And the device is asked which one, rather than it being inferred from the
// number of faders: the menu's diagnostic reads the gain off the node itself.
stubEl('menu-open').click();
tick(2);
const playing = String(stubEl('menu-audio-detail').textContent);
ok(/playing: [a-z-]+ 100%/.test(playing) && !/\+/.test(playing),
   'and the device says which tune, and names exactly one',
   playing);
press('Escape');
tick(4);

// --- Jerusalem has landmarks in it, and they stay out of the reading band -----
//
// The third face of the resolution problem in
// docs/design/05-scenery-warps.md#a-chapter-is-not-one-place, and the owner's
// own words: "Later on like moving through jerusalem and stuff might be
// tricky." A city is a place you arrive at rather than a texture that repeats,
// so the gate has to come up, pass and be left behind -- and, being the largest
// thing this game draws, it has to do all of that behind the scribe and above
// the words. John 19:17 is where he is taken out of the city.
const { worldFor: builtWorldFor } = await import(
  pathToFileURL(resolve(ROOT, 'build/core/worlds.js')).href
);
const { PALETTE_ROLES: ROLES } = await import(
  pathToFileURL(resolve(ROOT, 'build/core/sprites.js')).href
);
const CITY = builtWorldFor('city');
const cityInk = (role) => `#${CITY.palette[ROLES.indexOf(role)].toString(16).padStart(6, '0')}`;
// Everything the city is painted in. A themed `rect` is the only kind of fill
// that speaks this vocabulary -- tiles and sprites arrive through `drawImage` --
// so a fill in one of these colours *is* a piece of the scenery.
const CITY_INK = new Set(CITY.palette.map(
  (colour) => `#${colour.toString(16).padStart(6, '0')}`,
));
// The way through the gate: the only thing in a city frame drawn in the
// theme's own outline, so where it is is where the gate is.
const GATEWAY = cityInk('outline');

await quiesce();
store.set('scriptorium.progress', JSON.stringify({
  version: 6, stage: 1, translation: 'WEB', route: 'pilgrimage',
  position: { book: 'John', chapter: 19, unit: 17 },
  completed: FINISHED, discovered: FINISHED,
  keyStats: {}, recent: {}, history: [],
  gilding: false, gildOffered: true, firstRun: false, cloudEnabled: true,
  notesSeen: ['space', 'error', 'dim'],
}));
await import(`${pathToFileURL(resolve(ROOT, 'build/platform/web/main.js')).href}?city`);
await new Promise((r) => setTimeout(r, 400));
const inTheCity = await waitFor(() => refText().startsWith('John 19') && askedFor() !== null);
tick(4);
ok(inTheCity, 'the harness is standing where he is taken out of the city', refText());

/** The reading band: `M.bandTop` to `M.bandTop + M.bandH`, where the words are. */
const READING_BAND_BOTTOM = RAIL_BAND_TOP + 62;
const gateXs = [];
let cityRects = 0;
let intoTheBand = null;
for (let part = 0; part < 2; part++) {
  for (let i = 0; i < 4000; i++) {
    const k = askedFor();
    if (k === null) break;
    press(k);
    tick();
    for (const fill of calls.fills) {
      if (!CITY_INK.has(fill.color)) continue;
      cityRects += 1;
      // Above the rail, always. The clamp is in `core/draw.ts`; this is the
      // built renderer being watched execute it.
      // The reading band, which is what all of this is in service of. Below it
      // is the keyboard, and the lectern the scribe writes at is themed and
      // stands there on purpose (docs/design/02-rail.md#the-scribe-at-his-lectern)
      // -- so this is the strip the words are on, not simply "anything lower".
      if (fill.y < READING_BAND_BOTTOM && fill.y + fill.h > RAIL_BAND_TOP && intoTheBand === null) {
        intoTheBand = `${fill.color} at y ${fill.y}..${fill.y + fill.h}`;
      }
      // The gate, and only in the band: below the rail the same ink paints the
      // lectern the scribe writes at, which is furniture and not scenery.
      if (fill.color === GATEWAY && fill.y + fill.h <= RAIL_BAND_TOP) gateXs.push(fill.x);
    }
  }
  tick(2);
  await takeCardForward();
}

ok(cityRects > 0, 'the city is actually painted while he is in it',
   `${cityRects} pieces of scenery drawn`);
ok(gateXs.length > 2, 'A CITY GATE STANDS IN THE BAND AND IS PASSED',
   `${gateXs.length} frames with the gate on screen`);
ok(gateXs.length > 2 && gateXs[gateXs.length - 1] < gateXs[0],
   'AND IT IS LEFT BEHIND: IT CROSSES THE BAND AS THE VERSES ARE WRITTEN',
   `x ${gateXs[0]} -> ${gateXs[gateXs.length - 1]}`);
ok(intoTheBand === null,
   'AND NOTHING OF THE CITY EVER ENTERS THE READING BAND',
   intoTheBand ?? `${cityRects} pieces of scenery, none of them on the words`);


console.log('');
if (fails.length > 0) {
  console.error(`smoke FAILED (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('smoke passed — the built game boots, renders, types and saves.');
