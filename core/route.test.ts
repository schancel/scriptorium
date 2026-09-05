/**
 * The route graph, asserted against the real table and the real text.
 *
 * @doc docs/design/04-route.md#edges
 *
 * Three claims are worth a test rather than a reading. Every edge must land on a
 * passage that actually exists in both shipped translations, because a mistyped
 * chapter is a warp into an empty level. The graph must have no orphan and no
 * dead end, because a hand-edited table grows both silently. And skipping every
 * flashback must still finish the route -- "a secret room that eats progress or
 * gates the exit is worse than no secret room" -- which is a property of the
 * graph, not of the level code, so it is checked here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ROUTE_OPTIONS,
  GENEALOGIES,
  arriveAt,
  chronicleLevels,
  completePassage,
  createMap,
  deadEnds,
  discoverSecret,
  edgeById,
  edgesFrom,
  entryRefs,
  flashbacksFrom,
  isGenealogy,
  isUnlocked,
  itinerary,
  loadRoute,
  mapThreads,
  mapView,
  nodeRefs,
  offerLine,
  orphans,
  requiredRefs,
  returnTargetFor,
  routeComplete,
  routeNodes,
  standingOffRoute,
  threadOffer,
  unresolvedRefs,
  type Route,
} from './route.js';
import { bookFileName, loadBook, parseReference, sectionFor } from './corpus.js';

function dataUrl(name: string): URL | null {
  for (const rel of ['../../data/', '../data/']) {
    const url = new URL(rel + name, import.meta.url);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

function loadDataFile(name: string): unknown {
  const url = dataUrl(name);
  if (url === null) throw new Error(`test: cannot locate data/${name}`);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

const route: Route = loadRoute(loadDataFile('routes/pilgrimage.json'));

/** Both shipped translations. docs/decisions/0002-web-and-kjv-not-net.md. */
const EDITIONS: readonly string[] = ['web', 'kjv'];

/** The chapter of a citation in one edition, or null when the book is absent. */
function chapterUnits(edition: string, ref: string): readonly string[] | null {
  const parsed = parseReference(ref);
  const url = dataUrl(`texts/${edition}/${bookFileName(parsed.book)}`);
  if (url === null) return null;
  const book = loadBook(JSON.parse(readFileSync(url, 'utf8')) as unknown);
  return sectionFor(book, parsed.chapter)?.units ?? null;
}

/** Facts about the table, not tunables: changing one would make a claim wrong. */
const EDGE_COUNT = 13;        // tuning-exempt: rows in docs/design/04-route.md#edges
const PROGRESSION_COUNT = 8;  // tuning-exempt: likewise
const FLASHBACK_COUNT = 5;    // tuning-exempt: likewise

test('the real route file parses, with both kinds of edge', () => {
  assert.equal(route.id, 'pilgrimage');
  assert.equal(route.edges.length, EDGE_COUNT);
  assert.equal(route.edges.filter((e) => e.kind === 'progression').length, PROGRESSION_COUNT);
  assert.equal(route.edges.filter((e) => e.kind === 'flashback').length, FLASHBACK_COUNT);
  assert.equal(edgeById(route, 'beginning')?.from, 'Genesis 1');
  assert.equal(edgeById(route, 'nothing-of-the-sort'), null);
});

test('every edge resolves to a passage that exists, in both translations', () => {
  let checked = 0;
  for (const edition of EDITIONS) {
    const missing = unresolvedRefs(route, (ref) => {
      const units = chapterUnits(edition, ref);
      if (units === null) return false;
      checked += 1;
      return units.length > 0;
    });
    assert.deepEqual(missing, [], `${edition}: edges landing on a passage that is not there`);
  }
  assert.ok(checked > 0, 'no text was actually consulted');
});

test('the graph has no orphans and no dead ends', () => {
  assert.deepEqual(orphans(route), []);
  assert.deepEqual(deadEnds(route), []);
  for (const node of routeNodes(route).values()) {
    if (node.kind === 'secret') {
      assert.equal(typeof returnTargetFor(route, node.ref), 'string');
    }
  }
});

test('orphan detection has teeth: a component nothing arrives at is reported', () => {
  const stranded: Route = {
    id: 'stranded',
    edges: [
      ...route.edges,
      { id: 'a-b', kind: 'progression', from: 'Amos 1', to: 'Amos 2', echo: 'x', echoKjv: null, note: '' },
      { id: 'b-a', kind: 'progression', from: 'Amos 2', to: 'Amos 1', echo: 'x', echoKjv: null, note: '' },
    ],
  };
  assert.deepEqual([...orphans(stranded)].sort(), ['Amos 1', 'Amos 2']);
});

test('dead-end detection has teeth: a secret with a way onward is reported', () => {
  const trap: Route = {
    id: 'trap',
    edges: [
      ...route.edges,
      { id: 'onward', kind: 'progression', from: 'Numbers 21', to: 'Judges 1', echo: 'x', echoKjv: null, note: '' },
    ],
  };
  assert.equal(routeNodes(trap).get('Numbers 21')?.kind, 'secret');
  assert.deepEqual(deadEnds(trap), ['Numbers 21'], 'a room with its own exit abandons the level');
  assert.deepEqual(deadEnds(route), [], 'and the real route has none');
});

test('a malformed route is a load error, not a warp into nothing', () => {
  assert.throws(() => loadRoute({ edges: [] }), /no edges/);
  assert.throws(
    () => loadRoute({ id: 'x', edges: [{ id: 'a', kind: 'sideways', from: 'Genesis 1', to: 'John 1', echo: 'e', note: '' }] }),
    /unknown kind/,
  );
  assert.throws(
    () => loadRoute({ id: 'x', edges: [
      { id: 'a', kind: 'progression', from: 'Genesis 1', to: 'John 1', echo: 'e', note: '' },
      { id: 'a', kind: 'progression', from: 'Genesis 1', to: 'John 1', echo: 'e', note: '' },
    ] }),
    /duplicate edge id/,
  );
  assert.throws(
    () => loadRoute({ id: 'x', edges: [{ id: 'a', kind: 'progression', from: 'Genesis', to: 'John 1', echo: 'e', note: '' }] }),
    /unparseable reference/,
  );
});

test('nodes come back in canonical order, not table order', () => {
  const refs = nodeRefs(route);
  assert.equal(refs[0], 'Genesis 1');
  assert.equal(refs[refs.length - 1], 'Revelation 22');
  assert.ok(refs.indexOf('Exodus 3') < refs.indexOf('Psalm 22'));
  assert.ok(refs.indexOf('Matthew 12') < refs.indexOf('John 1'));
});

test('a progression destination unlocks when its origin is completed', () => {
  const fresh = createMap(route);
  assert.equal(fresh.current, '');
  assert.equal(isUnlocked(route, fresh, 'Genesis 1'), true);
  assert.equal(isUnlocked(route, fresh, 'John 1'), false);
  const done = completePassage(fresh, 'Genesis 1');
  assert.equal(isUnlocked(route, done, 'John 1'), true);
});

test('THE MAP MARKS NO NODE WHEN THE PLAYER IS NOT ON ONE', () => {
  // docs/design/04-route.md#standing-off-the-route. Reading straight on out of
  // Genesis 3 reaches Genesis 4, which the graph does not name -- and the map
  // used to answer that by marking the route's first entry, telling a player he
  // was somewhere he was not. A fresh map marks nothing either, for the same
  // reason. (The example used to be Genesis 2, which ADR 0012 made a node.)
  const fresh = createMap(route);
  assert.equal(mapView(route, fresh).filter((n) => n.current).length, 0);
  assert.equal(standingOffRoute(route, fresh), null, 'nowhere yet is not off the route');

  const off = arriveAt(completePassage(fresh, 'Genesis 1'), 'Genesis 4');
  assert.equal(mapView(route, off).filter((n) => n.current).length, 0);
  assert.equal(standingOffRoute(route, off), 'Genesis 4', 'and it can say where he is');
  // The thread he left is still there to get back to.
  assert.equal(mapView(route, off).find((n) => n.ref === 'Genesis 1')?.completed, true);
  // And Genesis 2 is now *on* the route, so reading straight on out of Genesis 1
  // no longer walks off it at the first step. That is what ADR 0012 bought.
  assert.equal(standingOffRoute(route, arriveAt(fresh, 'Genesis 2')), null);

  const on = arriveAt(off, 'John 1');
  assert.deepEqual(mapView(route, on).filter((n) => n.current).map((n) => n.ref), ['John 1']);
  assert.equal(standingOffRoute(route, on), null);
});

test('a secret stays off the map until it is found, and stays on it afterwards', () => {
  const fresh = createMap(route);
  const hidden = mapView(route, fresh).find((n) => n.ref === 'Genesis 22');
  assert.equal(hidden?.kind, 'secret');
  assert.equal(hidden?.visible, false);
  assert.equal(hidden?.unlocked, false);

  const found = discoverSecret(fresh, 'Genesis 22');
  const shown = mapView(route, found).find((n) => n.ref === 'Genesis 22');
  assert.equal(shown?.visible, true);
  assert.equal(shown?.unlocked, true);

  const thread = mapThreads(route, found).find((t) => t.edge.id === 'only-son');
  assert.equal(thread?.visible, true);
  assert.equal(mapThreads(route, fresh).find((t) => t.edge.id === 'only-son')?.visible, false);
});

test('SKIPPING EVERY FLASHBACK STILL COMPLETES THE ROUTE', () => {
  const required = requiredRefs(route);
  for (const edge of route.edges) {
    if (edge.kind !== 'flashback') continue;
    assert.ok(required.includes(edge.from), `${edge.from} is a stop`);
    assert.ok(!required.includes(edge.to), `${edge.to} is a secret, never required`);
  }
  let state = createMap(route);
  for (const ref of required) state = completePassage(state, ref);
  assert.equal(state.discovered.length, 0, 'no doorway was ever entered');
  assert.equal(routeComplete(route, state), true);
});

test('every doorway is optional and belongs to a passage on the route', () => {
  const stops = new Set(requiredRefs(route));
  const doorways = route.edges.filter((e) => e.kind === 'flashback');
  for (const edge of doorways) {
    assert.ok(stops.has(edge.from));
    assert.ok(flashbacksFrom(route, edge.from).some((e) => e.id === edge.id));
  }
  assert.equal(flashbacksFrom(route, 'John 19').length, 2, 'John 19 holds two doorways');
  assert.equal(edgesFrom(route, 'Revelation 22').length, 0);
});

test('genealogies are skipped by default on every route, and offered back', () => {
  assert.equal(DEFAULT_ROUTE_OPTIONS.skipGenealogies, true);
  assert.equal(isGenealogy('Genesis 5'), true);
  assert.equal(isGenealogy('1 Chronicles 4'), true, 'inside the 1-9 span');
  assert.equal(isGenealogy('Genesis 1'), false);
  assert.equal(isGenealogy('Genesis 11'), false, 'Babel is not a genealogy');
  assert.equal(isGenealogy('Matthew 1'), false, 'the nativity is not a genealogy');

  for (const ref of itinerary(route)) assert.equal(isGenealogy(ref), false);
  assert.deepEqual(chronicleLevels(route), [], 'the pilgrimage names none to begin with');

  const withNames: Route = {
    id: 'names',
    edges: [
      ...route.edges,
      { id: 'begat', kind: 'progression', from: 'Genesis 1', to: 'Genesis 5', echo: 'x', echoKjv: null, note: '' },
    ],
  };
  assert.ok(!itinerary(withNames).includes('Genesis 5'));
  assert.deepEqual(chronicleLevels(withNames), ['Genesis 5'], 'available, not deleted');
  assert.ok(itinerary(withNames, { skipGenealogies: false }).includes('Genesis 5'));
  assert.ok(GENEALOGIES.includes('Genesis 5'));
});

test('entries are the passages a player opens rather than warps into', () => {
  const entries = new Set(entryRefs(route));
  assert.ok(entries.has('Genesis 1'));
  assert.ok(!entries.has('John 1'), 'John 1 is arrived at');
  for (const ref of entries) assert.equal(routeNodes(route).get(ref)?.inbound.length, 0);
});

// --- the thread a finished passage offers ------------------------------------
//
// docs/design/04-route.md#finishing-a-passage-offers-the-thread-it-leads-to.
// Taking a thread used to require opening the route screen, so a player could
// finish Genesis 1, read straight on into Genesis 2, and never learn that any
// of this existed. The offer is the signpost that was missing, and everything
// worth getting wrong about it is a rule over the graph and the record.

function standing(done: readonly string[] = []): ReturnType<typeof createMap> {
  let state = createMap(route);
  for (const ref of done) state = completePassage(state, ref);
  return state;
}

test('FINISHING A PASSAGE OFFERS ONE THREAD, NOT A MENU OF THREE', () => {
  // Genesis 1 has three progression edges leaving it, and three of anything in
  // one sentence under the rail is a menu rather than an invitation.
  const out = edgesFrom(route, 'Genesis 1').filter((e) => e.kind === 'progression');
  assert.equal(out.length, 3); // tuning-exempt: rows in docs/design/04-route.md#edges
  const offer = threadOffer(route, standing(['Genesis 1']), 'Genesis 1');
  assert.equal(offer?.edge.id, 'beginning');
  assert.equal(offer?.edge.to, 'John 1');
  // The other two are the route screen's to show, and the offer says how many.
  assert.equal(offer?.others, 2); // tuning-exempt: the other two rows
});

test('AND NEVER THE THREAD THAT LANDS WHERE READING ON LANDS', () => {
  // `living-creature` runs Genesis 1 -> Genesis 2, and the keystroke after the
  // last one of Genesis 1 is Genesis 2:1. An offer to go where the default
  // already goes is not an offer, it is a description of the default -- so it
  // is skipped even though it is not the first row in the table.
  const offer = threadOffer(route, standing(['Genesis 1']), 'Genesis 1');
  assert.notEqual(offer?.edge.id, 'living-creature');
  assert.ok(!offerLine(offer!).includes('Genesis 2'));
});

test('IT IS SILENT ON A PASSAGE ALREADY TRAVELLED FROM', () => {
  // An offer that came back every time a chapter was finished would be nagging.
  // He has been where the signpost points, whether he travelled the thread or
  // read his way there, and a signpost to somewhere you have been is not one.
  assert.equal(threadOffer(route, standing(['Genesis 1', 'John 1']), 'Genesis 1'), null);
  assert.equal(threadOffer(route, standing(['Genesis 1', 'Genesis 2']), 'Genesis 1'), null);
  assert.equal(threadOffer(route, standing(['Genesis 1', 'John 20']), 'Genesis 1'), null);
  // And it is derived from `completed` alone, so it survives a reload without a
  // field and cannot disagree with the route screen about what is finished.
  assert.notEqual(threadOffer(route, standing(['Genesis 1', 'Psalm 23']), 'Genesis 1'), null);
});

test('a passage no thread leaves offers nothing at all', () => {
  // John 1 and Revelation 22 are the ends of threads, not dead ends -- and
  // there is nothing for the strip to say when a passage finishes there.
  assert.equal(threadOffer(route, standing(['John 1']), 'John 1'), null);
  assert.equal(threadOffer(route, standing(['Revelation 22']), 'Revelation 22'), null);
  // A passage the route does not name has no threads either, and asking is safe.
  assert.equal(threadOffer(route, standing([]), 'Genesis 4'), null);
  // A doorway is not a thread to be offered: a flashback is a round trip found
  // inside a passage, and finishing the passage is not finding it.
  assert.equal(threadOffer(route, standing(['John 19']), 'John 19'), null);
});

test('THE OFFER NAMES THE ECHO, AND SAYS THAT READING ON IS THE OTHER ANSWER', () => {
  const offer = threadOffer(route, standing(['Genesis 1']), 'Genesis 1');
  const line = offerLine(offer!);
  assert.ok(line.startsWith('tab: '), line);
  assert.ok(line.includes('John 1'), line);
  // The route's own note, so the strip and the route screen say the same thing
  // about the same thread rather than two authored sentences that can drift.
  assert.ok(line.includes(edgeById(route, 'beginning')?.note ?? '!'), line);
  assert.ok(line.includes('or read on'), line);
  assert.ok(line.includes('2 more on the route'), line);
  // Every offer the graph can produce is one line, and never exclaims: it is
  // copy about the world, and the world is not congratulating anybody.
  for (const ref of nodeRefs(route)) {
    const found = threadOffer(route, standing([ref]), ref);
    if (found === null) continue;
    const said = offerLine(found);
    assert.ok(!said.includes('\n'), said);
    assert.ok(!said.includes('!'), said);
    assert.ok(said.length < 120, `${String(said.length)} characters: ${said}`); // tuning-exempt: the strip is one line
  }
});

test('and a passage with one thread out of it does not point at a route screen for nothing', () => {
  const offer = threadOffer(route, standing(['Exodus 3']), 'Exodus 3');
  assert.equal(offer?.edge.to, 'John 8');
  assert.equal(offer?.others, 0);
  assert.ok(!offerLine(offer!).includes('more on the route'));
});
