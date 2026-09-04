/**
 * The route: a graph of passages joined by textual echo, and the map over it.
 *
 * @doc docs/design/04-route.md#two-kinds-of-edge
 *
 * `data/routes/pilgrimage.json` is compiled from the table in
 * docs/design/04-route.md; this module is the graph that table describes. The
 * platform parses the file -- `core/` never reaches out, per
 * docs/architecture/core-purity.md -- and hands the object to `loadRoute`.
 *
 * ## Two kinds of edge, two kinds of node
 *
 * A **progression** edge moves the player onward and they stay at the
 * destination. A **flashback** edge is a round trip: a doorway mid-level that
 * phases backwards into an older passage and then forward again to the verse it
 * left. So a node reached only by flashback is not a stop on the pilgrimage at
 * all; it is a secret room, hidden on the map until it is found, and nothing on
 * the route may ever require it. `requiredRefs` is that rule expressed as a
 * function, and it is what makes "skipping a flashback still leaves the level
 * completable" a property of the graph rather than a hope about the code.
 *
 * ## What "dead end" means here
 *
 * A progression destination with no outgoing edge -- John 1, Revelation 22 --
 * is *not* a dead end. Finishing a passage returns to the map; staying is what
 * a progression edge is for. The node a player could genuinely be stuck in is a
 * flashback destination whose return is missing, so that is what `deadEnds`
 * looks for. `orphans` is the other half: a node no thread can be reached
 * along, which is how a route edited by hand grows a component nobody can visit.
 */

import { CANON, canonicalBook, parseReference } from './corpus.js';

// --- the file shape ---------------------------------------------------------

export type EdgeKind = 'progression' | 'flashback';

/** One row of the edges table in docs/design/04-route.md. */
export interface RouteEdge {
  readonly id: string;
  readonly kind: EdgeKind;
  /** Citation, e.g. `Genesis 1`. */
  readonly from: string;
  readonly to: string;
  /** The phrase held lit across the warp. Authored, never matched at runtime. */
  readonly echo: string;
  /**
   * The King James wording, where it differs. WEB reads "your son" and KJV
   * reads "thy son" in both halves of the `only-son` edge, and the possessive
   * pronoun is precisely what the translations disagree about -- a single
   * shared string would have to collapse to the bare noun, too common a word to
   * read as a deliberate echo when it stays lit through a warp.
   */
  readonly echoKjv: string | null;
  readonly note: string;
}

export interface Route {
  readonly id: string;
  readonly edges: readonly RouteEdge[];
}

const EDGE_KINDS: ReadonlySet<string> = new Set<string>(['progression', 'flashback']);

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`route: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`route: ${what} is not a string`);
  return value;
}

/**
 * Parse a route file.
 *
 * Strict for the same reason `core/corpus.ts` is strict about a book: an edge
 * with a mistyped reference would surface as a warp into an empty passage,
 * which reads to the player as the game losing its place rather than as a bad
 * row in a table.
 *
 * @throws if the object is not shaped like a route file
 */
export function loadRoute(parsed: unknown): Route {
  const doc = asRecord(parsed, 'parsed file');
  const rawEdges = doc['edges'];
  if (!Array.isArray(rawEdges)) throw new Error('route: parsed file has no "edges" array');
  const seen = new Set<string>();
  const edges: RouteEdge[] = rawEdges.map((raw, index) => {
    const row = asRecord(raw, `edges[${String(index)}]`);
    const id = asString(row['id'], `edges[${String(index)}].id`);
    if (seen.has(id)) throw new Error(`route: duplicate edge id "${id}"`);
    seen.add(id);
    const kind = asString(row['kind'], `edge "${id}".kind`);
    if (!EDGE_KINDS.has(kind)) throw new Error(`route: edge "${id}" has unknown kind "${kind}"`);
    const from = asString(row['from'], `edge "${id}".from`);
    const to = asString(row['to'], `edge "${id}".to`);
    parseReference(from);
    parseReference(to);
    const echoKjv = row['echo_kjv'];
    if (echoKjv !== null && echoKjv !== undefined && typeof echoKjv !== 'string') {
      throw new Error(`route: edge "${id}".echo_kjv is neither a string nor null`);
    }
    return {
      id,
      kind: kind as EdgeKind,
      from,
      to,
      echo: asString(row['echo'], `edge "${id}".echo`),
      echoKjv: typeof echoKjv === 'string' ? echoKjv : null,
      note: asString(row['note'], `edge "${id}".note`),
    };
  });
  if (edges.length === 0) throw new Error('route: no edges');
  return { id: asString(doc['id'], 'id'), edges };
}

// --- canonical order --------------------------------------------------------

const CANON_INDEX: ReadonlyMap<string, number> = new Map(
  CANON.map((entry, index) => [entry.title, index]),
);

/**
 * Sort key for a citation: canonical book order, then chapter. A book outside
 * the canon -- an imported Gutenberg text -- sorts after the whole Bible rather
 * than at the front, so importing a novel does not reorder the pilgrimage.
 */
function orderOf(ref: string): { book: number; chapter: number } {
  const parsed = parseReference(ref);
  const title = canonicalBook(parsed.book);
  const book = title === null ? CANON.length : (CANON_INDEX.get(title) ?? CANON.length);
  return { book, chapter: parsed.chapter };
}

function compareRefs(a: string, b: string): number {
  const left = orderOf(a);
  const right = orderOf(b);
  return left.book === right.book ? left.chapter - right.chapter : left.book - right.book;
}

// --- the graph --------------------------------------------------------------

/**
 * A **stop** is a passage on the pilgrimage. A **secret** is reached only
 * through a flashback doorway, so it stays off the map until it is found.
 */
export type NodeKind = 'stop' | 'secret';

export interface RouteNode {
  /** Citation as the route table spells it. */
  readonly ref: string;
  readonly book: string;
  readonly chapter: number;
  readonly kind: NodeKind;
  /** Ids of edges arriving here. */
  readonly inbound: readonly string[];
  /** Ids of edges leaving here. */
  readonly outbound: readonly string[];
}

/** Every node the route names, keyed by citation, in canonical order. */
export function routeNodes(route: Route): ReadonlyMap<string, RouteNode> {
  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  const secret = new Set<string>();
  const refs = new Set<string>();

  const push = (into: Map<string, string[]>, key: string, id: string): void => {
    const list = into.get(key);
    if (list === undefined) into.set(key, [id]);
    else list.push(id);
  };

  for (const edge of route.edges) {
    refs.add(edge.from);
    refs.add(edge.to);
    push(outbound, edge.from, edge.id);
    push(inbound, edge.to, edge.id);
    if (edge.kind === 'flashback') secret.add(edge.to);
  }
  /*
   * A secret is a passage the pilgrimage only ever *drops into*: something
   * flashes back to it and nothing travels to it. Classification reads inbound
   * edges alone. A passage holding a doorway is a stop -- John 19 is where the
   * player already stands when the altar appears -- and a passage a progression
   * edge arrives at is a stop even if a flashback also lands there.
   *
   * Reading outbound edges here would be the mistake: it would quietly promote a
   * secret that had grown a way onward into a stop, which is precisely the trap
   * `deadEnds` exists to report.
   */
  for (const edge of route.edges) {
    if (edge.kind === 'progression') secret.delete(edge.to);
  }

  const out = new Map<string, RouteNode>();
  for (const ref of [...refs].sort(compareRefs)) {
    const parsed = parseReference(ref);
    out.set(ref, {
      ref,
      book: parsed.book,
      chapter: parsed.chapter,
      kind: secret.has(ref) ? 'secret' : 'stop',
      inbound: inbound.get(ref) ?? [],
      outbound: outbound.get(ref) ?? [],
    });
  }
  return out;
}

/** Every citation the route names, in canonical order. */
export function nodeRefs(route: Route): readonly string[] {
  return [...routeNodes(route).keys()];
}

export function edgeById(route: Route, id: string): RouteEdge | null {
  return route.edges.find((edge) => edge.id === id) ?? null;
}

/** Edges leaving `ref`, in table order. */
export function edgesFrom(route: Route, ref: string): readonly RouteEdge[] {
  return route.edges.filter((edge) => edge.from === ref);
}

/**
 * The optional doorways inside `ref`. Every one of these may be walked straight
 * past; see `requiredRefs`.
 */
export function flashbacksFrom(route: Route, ref: string): readonly RouteEdge[] {
  return edgesFrom(route, ref).filter((edge) => edge.kind === 'flashback');
}

/** Where a flashback into `ref` came from, or null when `ref` is not a secret. */
export function returnTargetFor(route: Route, ref: string): string | null {
  return route.edges.find((edge) => edge.kind === 'flashback' && edge.to === ref)?.from ?? null;
}

/**
 * Where a pilgrimage can begin: a node no thread arrives at. These are the
 * passages the player opens on their own rather than warps into.
 */
export function entryRefs(route: Route): readonly string[] {
  const nodes = routeNodes(route);
  return [...nodes.values()].filter((node) => node.inbound.length === 0).map((node) => node.ref);
}

/**
 * Nodes no thread can reach: unreachable from every entry.
 *
 * Empty on a well-formed route, and the check has teeth -- a component wired
 * only to itself, which is what a hand-edited table grows, is reachable from
 * nothing and shows up here.
 */
export function orphans(route: Route): readonly string[] {
  const nodes = routeNodes(route);
  const seen = new Set<string>(entryRefs(route));
  const queue = [...seen];
  while (queue.length > 0) {
    const ref = queue.pop();
    if (ref === undefined) break;
    for (const edge of edgesFrom(route, ref)) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return [...nodes.keys()].filter((ref) => !seen.has(ref));
}

/**
 * Nodes a player could enter and not come back from.
 *
 * Only a secret can be one. A progression destination with no outgoing edge --
 * John 1, Revelation 22 -- is the end of a thread, not a trap: the passage
 * finishes and the map comes back, which is what "travel and stay" means.
 *
 * Two things make a secret a trap, and both are reachable by editing the table:
 *
 *  - **No return.** Nothing records where the round trip started, so the player
 *    is left in the older passage with the interrupted level abandoned.
 *  - **A way onward.** A progression edge leaving a secret takes the player
 *    forward *out of the flashback*, and the level the doorway interrupted is
 *    never returned to. A room with its own exit is not a room, it is a
 *    diversion of the route, and the verse the player left is lost.
 */
export function deadEnds(route: Route): readonly string[] {
  const nodes = routeNodes(route);
  return [...nodes.values()]
    .filter(
      (node) =>
        node.kind === 'secret' &&
        (returnTargetFor(route, node.ref) === null ||
          node.outbound.some((id) => edgeById(route, id)?.kind === 'progression')),
    )
    .map((node) => node.ref);
}

/**
 * Edge endpoints that name no passage the corpus can produce.
 *
 * `exists` is injected because loading a book is the platform's job; the test
 * hands in a lookup over the real `data/texts/`.
 */
export function unresolvedRefs(route: Route, exists: (ref: string) => boolean): readonly string[] {
  return nodeRefs(route).filter((ref) => !exists(ref));
}

// --- genealogies ------------------------------------------------------------

/**
 * Skipped by default on every route.
 *
 * "Genesis 5 is forty lines of *and Mahalalel lived eight hundred and thirty
 * years* -- miserable typing and unreadable prose for a beginner." They remain
 * available as optional Chronicle bonus levels, so this is a default and not a
 * deletion; `chronicleLevels` hands back exactly what `itinerary` left out.
 *
 * Only chapters that are genealogy end to end are listed. Genesis 11, Matthew 1
 * and Luke 3 each open or close with something else -- Babel, the nativity, the
 * baptism -- and skipping the whole chapter to avoid its list of names would
 * cost the player the part they came for. Partial-chapter skipping is a verse
 * range, not a chapter range, and nothing in the route table speaks verses.
 */
export const GENEALOGIES: readonly string[] = [
  'Genesis 5',
  'Genesis 10',
  'Genesis 36',
  'Numbers 1',
  'Numbers 26',
  '1 Chronicles 1-9',
  'Ezra 2',
  'Nehemiah 7',
];

interface Span {
  readonly book: string;
  readonly first: number;
  readonly last: number;
}

const GENEALOGY_SPANS: readonly Span[] = GENEALOGIES.map((range) => {
  const parsed = parseReference(range);
  return { book: parsed.book, first: parsed.chapter, last: parsed.lastChapter };
});

/** True when a citation names a chapter the default route steps over. */
export function isGenealogy(ref: string): boolean {
  const parsed = parseReference(ref);
  return GENEALOGY_SPANS.some(
    (span) =>
      span.book === parsed.book && parsed.chapter >= span.first && parsed.chapter <= span.last,
  );
}

// --- the itinerary ----------------------------------------------------------

export interface RouteOptions {
  /** Default true, on every route. See `GENEALOGIES`. */
  readonly skipGenealogies: boolean;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = { skipGenealogies: true };

/**
 * The stops the pilgrimage is made of: every node a progression edge touches,
 * plus every node holding a flashback doorway. Secrets are excluded by
 * construction, which is what makes skipping one harmless.
 */
export function requiredRefs(route: Route, options: RouteOptions = DEFAULT_ROUTE_OPTIONS): readonly string[] {
  const nodes = routeNodes(route);
  return [...nodes.values()]
    .filter((node) => node.kind === 'stop')
    .map((node) => node.ref)
    .filter((ref) => !(options.skipGenealogies && isGenealogy(ref)));
}

/** The stops, in canonical order: the order the map lays them out in. */
export function itinerary(route: Route, options: RouteOptions = DEFAULT_ROUTE_OPTIONS): readonly string[] {
  return requiredRefs(route, options);
}

/**
 * What the default route stepped over, offered back as Chronicle bonus levels.
 * Skipping is the default, not the only option.
 */
export function chronicleLevels(route: Route): readonly string[] {
  const nodes = routeNodes(route);
  return [...nodes.keys()].filter((ref) => nodes.get(ref)?.kind === 'stop' && isGenealogy(ref));
}

// --- map state --------------------------------------------------------------

/**
 * Where the player is on the graph, and what the map is allowed to show.
 *
 * `discovered` is separate from `completed` because a secret is revealed by
 * being *found* -- stepping through the doorway -- and a player who steps in,
 * turns round and walks out has still found it. Losing the room off the map
 * again would be the same as never having found it.
 */
export interface MapState {
  readonly routeId: string;
  /**
   * The passage the player is actually in -- which the route need not name.
   *
   * A player can stand off the route: the menu jumps anywhere, and reading
   * straight on from Genesis 1 reaches Genesis 2, which is not a node. So this
   * holds the citation itself rather than a node id, and when no node matches
   * it, no node is marked. Empty means "nowhere yet", which is what a map
   * nobody has arrived on is.
   */
  readonly current: string;
  readonly completed: readonly string[];
  readonly discovered: readonly string[];
}

/**
 * A fresh map, standing nowhere.
 *
 * It does **not** fall back to the route's first entry. It used to, and the
 * cost was a small untruth on the one screen whose job is to say where the
 * player is: someone reading Genesis 2 was shown *you are here* against
 * Genesis 1. See docs/design/04-route.md#standing-off-the-route -- the report
 * card's rule holds here too, and the game may not assert what its data does
 * not support.
 */
export function createMap(route: Route): MapState {
  return { routeId: route.id, current: '', completed: [], discovered: [] };
}

function withMember(list: readonly string[], ref: string): readonly string[] {
  return list.includes(ref) ? list : [...list, ref];
}

/**
 * Stand somewhere. `ref` is any citation, on the route or not; the map marks a
 * node only when the route names the passage. See `standingOffRoute`.
 */
export function arriveAt(state: MapState, ref: string): MapState {
  return { ...state, current: ref };
}

/**
 * The passage the player is in, when the route does not name it. Null when it
 * does, and null when they are nowhere yet.
 *
 * This is what the map says instead of marking a node, and being off the route
 * is a normal thing to do rather than an error -- the menu invites it and
 * reading onward from a chapter's end causes it. See
 * docs/design/04-route.md#standing-off-the-route.
 */
export function standingOffRoute(route: Route, state: MapState): string | null {
  if (state.current === '') return null;
  return routeNodes(route).has(state.current) ? null : state.current;
}

export function completePassage(state: MapState, ref: string): MapState {
  return { ...state, completed: withMember(state.completed, ref) };
}

export function discoverSecret(state: MapState, ref: string): MapState {
  return { ...state, discovered: withMember(state.discovered, ref) };
}

/**
 * Unlocked when it is an entry, when a completed passage leads here, or -- for
 * a secret -- when it has been found.
 */
export function isUnlocked(route: Route, state: MapState, ref: string): boolean {
  const node = routeNodes(route).get(ref);
  if (node === undefined) return false;
  if (node.kind === 'secret') return state.discovered.includes(ref);
  if (node.inbound.length === 0) return true;
  return node.inbound.some((id) => {
    const edge = edgeById(route, id);
    return edge !== null && state.completed.includes(edge.from);
  });
}

export function unlockedRefs(route: Route, state: MapState): readonly string[] {
  return nodeRefs(route).filter((ref) => isUnlocked(route, state, ref));
}

/** One node, as the map draws it. */
export interface MapNodeView {
  readonly ref: string;
  readonly kind: NodeKind;
  readonly unlocked: boolean;
  readonly completed: boolean;
  /** Secrets stay off the map until found. */
  readonly visible: boolean;
  readonly current: boolean;
}

export function mapView(route: Route, state: MapState): readonly MapNodeView[] {
  return [...routeNodes(route).values()].map((node) => ({
    ref: node.ref,
    kind: node.kind,
    unlocked: isUnlocked(route, state, node.ref),
    completed: state.completed.includes(node.ref),
    visible: node.kind === 'stop' || state.discovered.includes(node.ref),
    current: state.current === node.ref,
  }));
}

/** One thread, as the map draws it: the echo note is the label. */
export interface MapThreadView {
  readonly edge: RouteEdge;
  readonly visible: boolean;
  readonly travelled: boolean;
}

export function mapThreads(route: Route, state: MapState): readonly MapThreadView[] {
  return route.edges.map((edge) => ({
    edge,
    visible: edge.kind === 'progression' || state.discovered.includes(edge.to),
    travelled: state.completed.includes(edge.from) && state.completed.includes(edge.to),
  }));
}

/**
 * True when every required stop is done.
 *
 * Secrets are not counted, which is the whole point: a player who never finds a
 * single flashback finishes the pilgrimage.
 */
export function routeComplete(
  route: Route,
  state: MapState,
  options: RouteOptions = DEFAULT_ROUTE_OPTIONS,
): boolean {
  return requiredRefs(route, options).every((ref) => state.completed.includes(ref));
}
