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
 * Usage: node tools/smoke.mjs        (after `make build`)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const calls = { fillText: [], lines: [], fillRect: 0, stroke: 0, ready: null };

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
  fillText(v, x, y) { calls.fillText.push({ v: String(v), x, y, style: this.font, color: this.fillStyle }); }
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

/** Type this part out, then take whatever screen comes next forward. */
async function finishPart() {
  for (let i = 0; i < 4000; i++) {
    const k = askedFor();
    if (k === null) break;
    press(k);
    tick();
  }
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
press('Escape');
tick(4);
ok(calls.fillText.some((c) => c.v.startsWith('next:')), 'Escape hands the rail back');

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

console.log('');
if (fails.length > 0) {
  console.error(`smoke FAILED (${fails.length}):`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('smoke passed — the built game boots, renders, types and saves.');
