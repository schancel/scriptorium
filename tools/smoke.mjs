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
const calls = { fillText: [], lines: [], fillRect: 0, stroke: 0, ready: null };
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
  setTransform() {} translate() {} scale() {} save() {} restore() {}
  clearRect() {} fillRect() { calls.fillRect += 1; }
  beginPath() {} rect() {} clip() {}
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
  putImageData() {} drawImage() {}
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
class AudioCtxShim {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.sampleRate = 48000; }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createOscillator() { return { frequency: { value: 0, setValueAtTime() {} }, type: 'square', connect() {}, disconnect() {}, start() {}, stop() {}, setPeriodicWave() {} }; }
  createBuffer(c, l) { return { getChannelData: () => new Float32Array(l) }; }
  createBufferSource() { return { buffer: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
  createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {}, disconnect() {} }; }
  createPeriodicWave() { return {}; }
  resume() { return Promise.resolve(); }
}
globalThis.AudioContext = AudioCtxShim; globalThis.webkitAudioContext = AudioCtxShim;
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
const frameNow = () => { calls.fillText = []; calls.lines = []; step(1000 + frames * 16); };

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
  for (let i = 0; i < n; i++) { calls.fillText = []; calls.lines = []; step(clock += 16); }
}

/** The caret: the one vertical line in a frame. Null when nothing is being asked for. */
function caretX() {
  const up = calls.lines.filter((l) => l.x1 === l.x2);
  return up.length === 0 ? null : up[0].x1;
}

/** Type this part out and stop, with the report card up. */
async function typeOutPart() {
  for (let i = 0; i < 4000; i++) {
    const k = askedFor();
    if (k === null) break;
    press(k);
    tick();
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
   'a chapter typed to the end is recorded as completed', `after ${parts + 1} parts`);

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
ok(card().some((v) => /^last \d+ parts? - /.test(v)), 'the curve is drawn and labelled',
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
// question this mode never puts (docs/design/02-rail.md#lectio-mode).
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

const exclaimed = spoken.find((t) => t.includes('!'));
ok(exclaimed === undefined, 'NOTHING THE GAME SAYS IS EXCLAIMED', exclaimed ?? '');

const praise = ['great', 'well done', 'nice work', 'awesome', 'perfect', 'excellent',
                'good job', 'congratulations', 'brilliant', 'amazing', 'fantastic'];
const flattered = spoken.find((t) => praise.some((w) => t.toLowerCase().includes(w)));
ok(flattered === undefined, 'and nothing praises him for typing a letter', flattered ?? '');

// Words that name a thing in the source tree and nothing on his screen. `candle`
// is the precedent: excellent internal vocabulary, and it reached the HUD as
// `candle 1/11` before a player had ever seen one drawn.
const ours = [/\bcandles?\b/i, /\blectio\b/i, /\bchunks?\b/i, /\bglyphs?\b/i,
              /\bribbon\b/i, /\bblot\b/i, /\billuminat(e|ed|ion|ing)\b/i,
              /\bgreyed\b/i, /\blive\b/i, /\bmastery gate\b/i, /\bkey ?set\b/i];
const jargon = spoken.find((t) => ours.some((re) => re.test(t)));
ok(jargon === undefined, 'AND NOTHING SAYS A WORD ONLY THE SOURCE TREE KNOWS', jargon ?? '');

console.log('');
if (fails.length > 0) {
  console.error(`smoke FAILED (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('smoke passed — the built game boots, renders, types and saves.');
