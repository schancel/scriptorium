/**
 * The chrome outside the canvas: the promotion notice, the menu, and the two
 * always-visible controls beside them.
 *
 * Everything here is DOM. It holds no rule -- what a promotion *is* comes from
 * `core/progress.ts`, and what a passage *is* comes from `core/corpus.ts`. This
 * file only says it out loud.
 *
 * Why DOM and not the display list: both panels are prose the player has to
 * read and controls they have to click, in a window that is not 640x360. The
 * canvas is for the rail.
 */

import { CANON } from '../../core/corpus.js';
import { countStretches } from '../../core/draw.js';
import type { FingerRow, GateView, Trend, WorstKey } from '../../core/draw.js';
import { isMotionSetting, type MotionSetting } from '../../core/motion.js';
import { OPENING } from '../../core/onboarding.js';
import type { HistoryEntry, Promotion } from '../../core/progress.js';
import type { Finger, KeyboardLayout, Thumb } from '../../core/types.js';
import type { PlayingTune } from './web_audio.js';

/** What the caller must be able to do when a button is pressed. */
export interface OverlayHandlers {
  /** The player asked for the menu; the caller builds the view and opens it. */
  requestMenu(): void;
  resume(): void;
  restart(): void;
  jump(book: string, chapter: number): void;
  /**
   * The player chose which of the two translations to type.
   *
   * Its own control rather than a second field in the go-somewhere-else row,
   * because it is a difficulty step and not a preference about wording -- see
   * docs/design/04-route.md#two-texts-and-the-second-act. It changes the prose
   * and nothing else: the same keys are lit in either text and the mastery gate
   * asks the same of them, and nothing here may ever reach the gate.
   */
  setEdition(edition: string): void;
  setKeyboard(layout: KeyboardLayout, spaceThumb: Thumb): void;
  /**
   * The player asked for the blot-cloud on or off.
   *
   * ADR 0004 requires this switch to exist and to stay. The cloud is the only
   * pressure in the game and it is there to motivate; if it turns out to stress
   * this player instead, the game must still be playable, and a switch nothing
   * exposes is a switch that does not exist.
   */
  setCloud(enabled: boolean): void;
  /**
   * The player chose a presentation of the rail.
   *
   * ADR 0011 requires this switch to exist alongside the operating system's own,
   * and `auto` -- which follows the system -- is what a record arrives with. The
   * other two are here because the aftereffect can reach somebody who has never
   * had reason to turn the system setting on, and because a machine is not a
   * person: he may want it on one and not another.
   */
  setMotion(setting: MotionSetting): void;
  /**
   * The player set their own stage.
   *
   * ADR 0008 names this as the honest route for someone who already types:
   * gilding deliberately does not open the mastery gate, so skipping ahead has
   * to be a control the player operates out loud rather than a side effect of
   * a difficulty mode.
   */
  setStage(stage: number): void;
  /**
   * The player asked for gilding on or off.
   *
   * The only other caller of this rule is the player's answer to the offer.
   * Nothing in the game may turn the mode on by itself: silently removing a
   * scaffold from someone having a good day is the failure ADR 0008 exists to
   * avoid.
   */
  setGilding(on: boolean): void;
  /**
   * The player asked for wrong keys to stand, or to block.
   *
   * A separate handler from `setGilding` and not a flag on it, because the two
   * are separate axes over the same population: typing every letter and
   * correcting your own mistakes are different requests. Nothing in the game
   * calls this but the player's own choice -- offer, never impose, exactly as
   * ADR 0008 established and ADR 0010 inherits.
   */
  setMistakesStand(on: boolean): void;
  /**
   * The player asked to see the opening again.
   *
   * For someone who clicked past it, and for someone handing the game to a
   * friend for an evening. It is the only way back to it -- nothing in the game
   * re-arms the first run by itself. See docs/design/10-first-run.md.
   */
  replayFirstRun(): void;
  startOver(): void;
  exportFile(): void;
  importFile(file: File): void;
  /**
   * The player asked to see the report card away from the end of a stretch.
   *
   * docs/design/08-stats.md#the-report-card. The card is a history of his hands,
   * and a history reachable only by finishing something is one he cannot consult
   * on the evening he wants to look at it. Same data, same judgements, different
   * moment.
   */
  requestHands(): void;
  /**
   * The player asked to see the route.
   *
   * The map is the only place the graph in `core/route.ts` is visible: which
   * passages are joined to which, and by what echo. It is a panel and not a
   * canvas screen for the same reason the menu is -- it is a list of passages
   * with a sentence beside each thread, and the canvas is for the rail.
   */
  requestMap(): void;
  /** The player chose a passage on the map. */
  travel(ref: string): void;
  /**
   * The player asked to read rather than type.
   *
   * Reading: the same passage on the same rail, shown one word at a time with an
   * anchor letter on the focal column and nothing asked of him. It is "the mode
   * available on a day he does not want to drill", so it is in the menu rather
   * than behind anything. See docs/design/02-rail.md#reading-mode.
   */
  startReading(): void;
  /**
   * The player asked for sound on or off.
   *
   * Called from inside the click, and it must stay that way: a browser will not
   * let an `AudioContext` start outside a user gesture, and one constructed
   * anywhere else sits suspended while the first notes are swallowed -- which
   * reads as "the sound is broken" rather than "the sound is blocked".
   */
  toggleAudio(): void;
}

/** The menu is a view of the record; the caller supplies the record's summary. */
/**
 * What the sound control is allowed to say, which is a fact about the device.
 *
 * Three states and not two, because "on" was two states wearing one label and
 * the owner met the difference: *"it says 'on' for sound, but no sound."* The
 * setting being on is not the sound being on -- a browser will not run an
 * `AudioContext` until the page has been typed on or clicked, and suspends it
 * again the moment the tab goes to the background. `waiting` is that gap, said
 * out loud instead of asserted away.
 * See docs/decisions/0009-fallbacks-must-announce-themselves.md.
 */
export type AudioIndicator = 'off' | 'on' | 'waiting';

/**
 * The audio device as the menu reports it.
 *
 * Facts read off the `AudioContext` this frame, not a memory of what we asked
 * it to do. It is here because we have twice had to guess at why one particular
 * machine was silent, and guessing is not a diagnostic.
 */
export interface AudioMenuView {
  readonly indicator: AudioIndicator;
  /** The context's own `state`, verbatim, or `none`. */
  readonly state: string;
  readonly contexts: number;
  readonly notesScheduled: number;
  readonly sampleRate: number;
  readonly lastError: string;
  /**
   * What is audible and how loud, read off the device's own faders.
   *
   * Two entries is a tune crossfading into another, which is what a scene
   * boundary sounds like; none, with notes being sent, is the shape of a game
   * that is doing everything right into a fader nobody turned up.
   */
  readonly music: readonly PlayingTune[];
}

export interface MenuView {
  readonly where: string;
  readonly stageLine: string;
  readonly edition: string;
  readonly book: string;
  readonly chapter: number;
  readonly layout: KeyboardLayout;
  readonly spaceThumb: Thumb;
  /** Whether the blot-cloud is armed. See `OverlayHandlers.setCloud`. */
  readonly cloudEnabled: boolean;
  /** Which presentation of the rail is chosen. See `OverlayHandlers.setMotion`. */
  readonly motion: MotionSetting;
  /**
   * What the operating system is currently asking for.
   *
   * Said out loud beside the control, because `auto` is the default and a player
   * on it has no other way to find out which of the two he is getting. A setting
   * whose effect cannot be observed is a setting nobody can trust.
   */
  readonly systemReduced: boolean;
  /** The stage the player is on, and every stage they could choose instead. */
  readonly stage: number;
  readonly stages: readonly { readonly stage: number; readonly description: string }[];
  /** Whether gilding is on. See `OverlayHandlers.setGilding`. */
  readonly gilding: boolean;
  /**
   * Whether a wrong key leaves its letter standing and backspace removes it.
   * See `OverlayHandlers.setMistakesStand`.
   */
  readonly mistakesStand: boolean;
  /**
   * Whether the player has reached the last stage the curriculum has.
   *
   * The one place the second translation is named as what it is: the answer to
   * "I have finished, what now". It is said and never enforced -- the King James
   * is offered from the first evening to anyone who wants it, because locking it
   * would make it invisible again, which is the whole problem.
   */
  readonly curriculumFinished: boolean;
  readonly history: readonly HistoryEntry[];
  /** The audio device, so the menu can say why a machine is silent. */
  readonly audio: AudioMenuView;
}

/**
 * The report card as the menu shows it.
 *
 * Every field is computed by `core/draw.ts` from the record -- the same
 * functions the canvas card draws with -- so the two readings of the same
 * hands cannot disagree. Nothing is judged in this file; it is said out loud
 * here and decided there.
 */
export interface HandsView {
  /** What the table is a reading of, in one sentence. */
  readonly scope: string;
  readonly fingers: readonly FingerRow[];
  readonly worst: readonly WorstKey[];
  /** The quickest finger, which the latency column is read against. */
  readonly quickest: Finger | null;
  /** The finding: what the shape of the table means. One sentence. */
  readonly note: string;
  /** The one thing to work on next. One sentence. */
  readonly advice: string;
  readonly gate: GateView | null;
  readonly trend: Trend;
}

/** One passage on the map. Every judgement in it is made by `core/route.ts`. */
export interface RouteNodeView {
  readonly ref: string;
  readonly kind: 'stop' | 'secret';
  readonly unlocked: boolean;
  readonly completed: boolean;
  readonly current: boolean;
}

/** One thread on the map: two passages, and the echo that joins them. */
export interface RouteThreadView {
  readonly from: string;
  readonly to: string;
  readonly kind: 'progression' | 'flashback';
  /** The phrase held lit across the crossing, in the translation in use. */
  readonly echo: string;
  /** One line about what the later passage does with the earlier one. */
  readonly note: string;
  readonly travelled: boolean;
}

/**
 * One figure walking with the player, as the map names it.
 *
 * The *only* place a follower is named. Nothing is ever written over one in the
 * world -- they are silhouettes that walk, and a label is the beginning of a
 * HUD. See docs/design/11-followers.md#on-the-map.
 */
export interface RoutePartyView {
  /**
   * Where the figure joined, with the verse when the row names one:
   * `Genesis 2:7`. It is the citation and not the chapter, because Genesis 2
   * hands over two people and two rows both reading "Genesis 2" would lose
   * exactly what the verse column added.
   */
  readonly ref: string;
  readonly who: string;
  /** False for a figure the capped line is not currently showing. */
  readonly walking: boolean;
}

export interface RouteView {
  readonly routeId: string;
  readonly complete: boolean;
  /** Stops finished, out of the stops the route requires. Secrets are not counted. */
  readonly finished: number;
  readonly stops: number;
  readonly nodes: readonly RouteNodeView[];
  readonly threads: readonly RouteThreadView[];
  /**
   * The passage the player is actually in, when the route does not name it.
   *
   * Null while he is standing on a node, in which case that node is marked and
   * the map has already answered "where am I". Non-null is the honest answer to
   * the same question when nothing on the screen is where he is; see
   * docs/design/04-route.md#standing-off-the-route.
   */
  readonly standing: string | null;
  /**
   * Who is walking with him, in the map's own order.
   *
   * Derived from the passages finished and the rooms found, so it cannot say
   * anything the list of passages above it does not already say. Empty is the
   * honest state of a player who has finished nothing yet.
   */
  readonly party: readonly RoutePartyView[];
  /** Non-null when the route file itself could not be read. */
  readonly error: string | null;
}

export interface Overlay {
  isOpen(): boolean;
  /**
   * The opening screen: where to put your hands, and one button.
   *
   * `onDone` is called however it is dismissed -- the button, Enter or Escape.
   * There is no "skip", because there is nothing to skip: it is one idea and
   * the button is already the way past it.
   */
  showOpening(onDone: () => void): void;
  openMenu(view: MenuView): void;
  /** The map: the passage graph, and the way back out of it. */
  showMap(view: RouteView): void;
  /** The report card, opened from the menu rather than reached by finishing. */
  showHands(view: HandsView): void;
  showPromotion(promotion: Promotion, onDismiss: () => void): void;
  /**
   * Ask whether the player wants gilding. `onAnswer` is called with their
   * answer -- including `false`, which is a real answer and is remembered, so
   * the question is asked once rather than after every good session.
   */
  showGildOffer(onAnswer: (accept: boolean) => void): void;
  showError(message: string): void;
  /**
   * Say out loud what the audio device is doing. The control is the only
   * indicator, so it reports the device and never the setting.
   */
  showAudio(indicator: AudioIndicator): void;
  close(): void;
}

/**
 * What the menu says about the second text once the curriculum is behind the
 * player.
 *
 * Plain, and an offer rather than a reward: it states a fact he can check and
 * names the thing to do with it. It is deliberately not congratulation -- see
 * docs/design/10-first-run.md#tone -- and deliberately not a gate.
 */
const SECOND_ACT =
  'You have reached the last stage this curriculum has. The King James is the '
  + 'second pass: the same keys, in prose that asks more of them. Nothing is '
  + 'lost by switching, and nothing is lost by staying.';

/**
 * What the sound control says, per state of the device.
 *
 * Three labels because there are three things that can be true, and the middle
 * one used to be told as the first: sound on with a device the browser has not
 * started is not sound on. The waiting label carries its own remedy, because
 * the remedy is one keystroke and the player is sitting at a keyboard.
 */
const AUDIO_LABEL: Readonly<Record<AudioIndicator, string>> = {
  off: '\u266a sound: off',
  on: '\u266a sound: on',
  waiting: '\u266a sound: on \u2014 press a key',
};

/** The same three states, said in a sentence for the menu. */
const AUDIO_SENTENCE: Readonly<Record<AudioIndicator, string>> = {
  off: 'Sound is off.',
  on: 'Sound is on, and the audio device is running.',
  waiting:
    'Sound is on, but the browser has not started the audio device yet. Browsers hold '
    + 'audio until the page has been typed on, and suspend it again whenever the tab goes '
    + 'to the background. Press any key with this page in front of you and it starts.',
};

const PERCENT = 100;
/** Most recent sessions shown in the menu. Enough to see a trend, few enough to scan. */
const HISTORY_SHOWN = 14;
const PROMOTED_MARK = '▲';
/**
 * The mark for a row where the mode changed.
 *
 * A rule rather than a second symbol, and deliberately not another triangle:
 * the triangle means *a stage opened on this row* and is an event, while this
 * means *the question changed here* and is a boundary between two runs of rows.
 * See docs/design/08-stats.md#history.
 */
const SWITCHED_MARK = '│';

function need<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof kind)) throw new Error(`overlay: #${id} is missing or the wrong element`);
  return found;
}

/** `<space>` reads as a key name, not as markup, once the brackets come off. */
function keyName(key: string): string {
  return key.startsWith('<') && key.endsWith('>') ? key.slice(1, -1) : key;
}

function pct(fraction: number): string {
  return `${String(Math.round(fraction * PERCENT))}%`;
}

/**
 * Wire the panels up once. Returns the handle `main.ts` drives them through.
 *
 * The caller is responsible for detaching the typing listener while a panel is
 * open: `keyboard_input.ts` swallows space, Tab, `/` and `'`, all of which the
 * chapter field and the buttons need back.
 */
export function createOverlay(handlers: OverlayHandlers): Overlay {
  const overlay = need('overlay', HTMLDivElement);
  const menuPanel = need('panel-menu', HTMLDivElement);
  const promotionPanel = need('panel-promotion', HTMLDivElement);

  const openButton = need('menu-open', HTMLButtonElement);
  const audioButton = need('audio-toggle', HTMLButtonElement);
  const where = need('menu-where', HTMLParagraphElement);
  const stageLine = need('menu-stage', HTMLParagraphElement);
  const editionSelect = need('menu-edition', HTMLSelectElement);
  const bookSelect = need('menu-book', HTMLSelectElement);
  const chapterInput = need('menu-chapter', HTMLInputElement);
  const goButton = need('menu-go', HTMLButtonElement);
  const layoutSelect = need('menu-layout', HTMLSelectElement);
  const thumbSelect = need('menu-thumb', HTMLSelectElement);
  const cloudSelect = need('menu-cloud', HTMLSelectElement);
  const motionSelect = need('menu-motion', HTMLSelectElement);
  const motionNote = need('menu-motion-note', HTMLParagraphElement);
  const stageSelect = need('menu-stage-select', HTMLSelectElement);
  const gildingSelect = need('menu-gilding', HTMLSelectElement);
  const mistakesSelect = need('menu-mistakes', HTMLSelectElement);
  const editionNext = need('menu-edition-next', HTMLParagraphElement);
  // The sound control's honesty, in two places: a line beside the toggle that
  // is up only while the device is not doing what the toggle claims, and the
  // menu's diagnostic, which is the thing to read out when a machine is silent.
  const audioNote = need('audio-note', HTMLParagraphElement);
  const audioState = need('menu-audio-state', HTMLParagraphElement);
  const audioDetail = need('menu-audio-detail', HTMLParagraphElement);
  const errorLine = need('menu-error', HTMLParagraphElement);
  const resumeButton = need('menu-resume', HTMLButtonElement);
  const restartButton = need('menu-restart', HTMLButtonElement);
  const exportButton = need('menu-export', HTMLButtonElement);
  const importInput = need('menu-import', HTMLInputElement);
  const resetButton = need('menu-reset', HTMLButtonElement);
  const firstRunButton = need('menu-first-run', HTMLButtonElement);
  const mapButton = need('menu-map', HTMLButtonElement);
  const handsButton = need('menu-hands', HTMLButtonElement);
  const readButton = need('menu-read', HTMLButtonElement);
  const historyList = need('menu-history', HTMLOListElement);
  const historyNote = need('history-note', HTMLParagraphElement);

  const promotionTitle = need('promotion-title', HTMLHeadingElement);
  const promotionDescription = need('promotion-description', HTMLParagraphElement);
  const promotionKeys = need('promotion-keys', HTMLParagraphElement);
  const promotionDip = need('promotion-dip', HTMLParagraphElement);
  const promotionCoverage = need('promotion-coverage', HTMLParagraphElement);
  const promotionOk = need('promotion-ok', HTMLButtonElement);

  const handsPanel = need('panel-hands', HTMLDivElement);
  const handsScope = need('hands-scope', HTMLParagraphElement);
  const handsTable = need('hands-table', HTMLUListElement);
  const handsNote = need('hands-note', HTMLParagraphElement);
  const handsAdvice = need('hands-advice', HTMLParagraphElement);
  const handsWorst = need('hands-worst', HTMLUListElement);
  const handsGate = need('hands-gate', HTMLUListElement);
  const handsCurve = need('hands-curve', HTMLDivElement);
  const handsCurveNote = need('hands-curve-note', HTMLParagraphElement);
  const handsMenu = need('hands-menu', HTMLButtonElement);
  const handsResume = need('hands-resume', HTMLButtonElement);

  const mapPanel = need('panel-map', HTMLDivElement);
  const mapNodes = need('map-nodes', HTMLUListElement);
  const mapThreadList = need('map-threads', HTMLUListElement);
  const mapError = need('map-error', HTMLParagraphElement);
  const mapProgress = need('map-progress', HTMLParagraphElement);
  const mapParty = need('map-party', HTMLUListElement);
  const mapPartyNote = need('map-party-note', HTMLParagraphElement);
  const mapStanding = need('map-standing', HTMLParagraphElement);
  const mapMenu = need('map-menu', HTMLButtonElement);
  const mapResume = need('map-resume', HTMLButtonElement);

  const gildPanel = need('panel-gild', HTMLDivElement);
  const gildYes = need('gild-yes', HTMLButtonElement);
  const gildNo = need('gild-no', HTMLButtonElement);

  // The opening screen. Its words come from `core/onboarding.ts` and are
  // written in once, here, rather than spelled into index.html: the wording is
  // the feature, and a string that lives only in a markup file is a string
  // nothing tests.
  const openingPanel = need('panel-first-run', HTMLDivElement);
  const openingOk = need('first-run-ok', HTMLButtonElement);
  need('first-run-title', HTMLHeadingElement).textContent = OPENING.title;
  need('first-run-lead', HTMLParagraphElement).textContent = OPENING.lead;
  need('first-run-bumps', HTMLParagraphElement).textContent = OPENING.bumps;
  need('first-run-body', HTMLParagraphElement).textContent = OPENING.body;
  need('first-run-rest', HTMLParagraphElement).textContent = OPENING.rest;
  need('first-run-home', HTMLParagraphElement).textContent = OPENING.homeRow;
  openingOk.textContent = OPENING.button;

  for (const entry of CANON) {
    const option = document.createElement('option');
    option.value = entry.title;
    option.textContent = entry.title;
    bookSelect.append(option);
  }

  let dismissPromotion: (() => void) | null = null;
  let answerGild: ((accept: boolean) => void) | null = null;
  let finishOpening: (() => void) | null = null;

  function isOpen(): boolean {
    return !overlay.hidden;
  }

  function close(): void {
    overlay.hidden = true;
    menuPanel.hidden = true;
    promotionPanel.hidden = true;
    gildPanel.hidden = true;
    openingPanel.hidden = true;
    mapPanel.hidden = true;
    handsPanel.hidden = true;
    dismissPromotion = null;
    answerGild = null;
    finishOpening = null;
  }

  function showError(message: string): void {
    errorLine.textContent = message;
  }

  /**
   * The mute control's label.
   *
   * It states the *current* state rather than the action, because a beginner
   * reading "mute" on a silent game cannot tell whether he is about to turn the
   * sound on or has already turned it off.
   */
  /**
   * The sound control, reporting the device rather than the setting.
   *
   * It used to say `on` the instant the setting was flipped, whatever the
   * browser had done about it, and the owner met the difference the only way
   * anyone does: *"it says 'on' for sound, but no sound."* An `AudioContext` is
   * not running until a gesture has been made on the page, and stops running
   * again whenever the tab is backgrounded, so `on` was two states in one word
   * and one of them was silent.
   *
   * `waiting` is that state, named. And because sound on with a device that is
   * not running is degraded operation wearing the look of normal operation, the
   * line beside the control says so where the player is already looking --
   * quietly, and with the one thing that fixes it, which is to type.
   * docs/decisions/0009-fallbacks-must-announce-themselves.md
   */
  function showAudio(indicator: AudioIndicator): void {
    audioButton.textContent = AUDIO_LABEL[indicator];
    // `aria-pressed` is the *setting*, because that is what the button toggles
    // and what pressing it will change. The label carries the device.
    audioButton.setAttribute('aria-pressed', indicator === 'off' ? 'false' : 'true');
    audioButton.setAttribute('data-audio', indicator);
    audioNote.hidden = indicator !== 'waiting';
  }

  /**
   * The diagnostic, in the menu, in the browser's own words.
   *
   * We have twice had to guess at why one machine was silent -- once a deploy
   * that 404'd every tune, once a context nothing resumed -- and both times the
   * game knew and could not say. This is the game answering instead: the
   * context's own `state`, how many devices this session opened, and whether a
   * single note has actually been handed to one. A running device with no notes
   * is a different fault from a device that never started.
   */
  function renderAudio(view: AudioMenuView): void {
    audioState.textContent = AUDIO_SENTENCE[view.indicator];
    const playing = view.music
      .map((tune) => `${tune.tune} ${String(Math.round(tune.gain * PERCENT))}%`)
      .join(' + ');
    const parts = [
      `Device: ${view.state}`,
      `opened this sitting: ${String(view.contexts)}`,
      `notes sent: ${String(view.notesScheduled)}`,
      `playing: ${playing === '' ? 'nothing' : playing}`,
      `sample rate: ${view.sampleRate === 0 ? 'none' : `${String(Math.round(view.sampleRate))} Hz`}`,
    ];
    if (view.lastError !== '') parts.push(`last refusal: ${view.lastError}`);
    audioDetail.textContent = parts.join(' · ');
  }

  function renderHistory(history: readonly HistoryEntry[]): void {
    historyList.replaceChildren();
    if (history.length === 0) {
      historyNote.textContent = 'Nothing yet. Finish your first few verses and it lands here.';
      return;
    }
    // Where what the page asks for changed. Computed over the whole record and
    // not over the fourteen rows shown, so a boundary is never claimed at the
    // top of the list merely because the list starts there.
    const switched = new Set<number>();
    history.forEach((entry, i) => {
      const before = history[i - 1];
      if (before !== undefined && before.gilding !== entry.gilding) switched.add(i);
    });
    const shown = history.length - Math.min(history.length, HISTORY_SHOWN);
    const anySwitch = [...switched].some((i) => i >= shown);

    historyNote.textContent =
      `A row marked ${PROMOTED_MARK} opened a stage. Expect the WPM after one to be ` +
      'lower than the WPM before it: a new stage lights up more of the page, so there ' +
      'are more characters to type per verse. That dip is the curriculum moving, not ' +
      'you going backwards, and it comes back within a few rows.' +
      (anySwitch
        ? ` A row marked ${SWITCHED_MARK} is where you changed what the page asks for. `
          + 'The rows either side of it are two different jobs, so a step across one is '
          + 'the question moving rather than your hands.'
        : '');

    [...history].slice(-HISTORY_SHOWN).reverse().forEach((entry, back) => {
      const index = history.length - 1 - back;
      const row = document.createElement('li');
      if (entry.promoted) row.classList.add('promoted');
      if (switched.has(index)) row.classList.add('switched');

      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = entry.date;

      const what = document.createElement('span');
      what.className = 'what';
      const marked = entry.promoted
        ? `${PROMOTED_MARK} ${entry.ref} - stage ${String(entry.stage + 1)} unlocked`
        : entry.ref;
      what.textContent = switched.has(index)
        ? `${SWITCHED_MARK} ${marked} - ${entry.gilding
          ? 'every letter asked for from here'
          : 'back to the letters your stage teaches'}`
        : marked;

      const how = document.createElement('span');
      how.className = 'how';
      how.textContent = `${String(Math.round(entry.wpm))} wpm  ${pct(entry.accuracy)}`;

      row.append(when, what, how);
      historyList.append(row);
    });
  }

  /**
   * The stage picker.
   *
   * Built from the curriculum the game actually loaded rather than from a list
   * spelled here, so a stage cannot appear in the menu that the gate and the
   * illumination sets have never heard of.
   */
  function renderStages(view: MenuView): void {
    stageSelect.replaceChildren();
    for (const row of view.stages) {
      const option = document.createElement('option');
      option.value = String(row.stage);
      option.textContent = `${String(row.stage)} — ${row.description}`;
      stageSelect.append(option);
    }
    stageSelect.value = String(view.stage);
  }

  function openMenu(view: MenuView): void {
    // Walking off the opening screen into the menu counts as having read it.
    // Leaving it unanswered would bring it back on the next reload, which is
    // the one thing it must never do -- and the menu has it back on purpose.
    if (!openingPanel.hidden) opened();
    where.textContent = view.where;
    stageLine.textContent = view.stageLine;
    editionSelect.value = view.edition;
    editionNext.textContent = view.curriculumFinished ? SECOND_ACT : '';
    bookSelect.value = view.book;
    chapterInput.value = String(view.chapter);
    layoutSelect.value = view.layout;
    thumbSelect.value = view.spaceThumb;
    cloudSelect.value = view.cloudEnabled ? 'on' : 'off';
    motionSelect.value = view.motion;
    motionNote.textContent = view.systemReduced
      ? 'Your system is asking for reduced movement.'
      : 'Your system is not asking for reduced movement.';
    gildingSelect.value = view.gilding ? 'on' : 'off';
    mistakesSelect.value = view.mistakesStand ? 'stand' : 'block';
    renderStages(view);
    renderAudio(view.audio);
    errorLine.textContent = '';
    renderHistory(view.history);
    promotionPanel.hidden = true;
    gildPanel.hidden = true;
    openingPanel.hidden = true;
    mapPanel.hidden = true;
    handsPanel.hidden = true;
    menuPanel.hidden = false;
    overlay.hidden = false;
    resumeButton.focus();
  }

  /**
   * The map.
   *
   * Every judgement on it is `core/route.ts`'s: which passages exist, which are
   * unlocked, which are finished, and which secret rooms have been found. This
   * only says it out loud -- and the thing it exists to say is the *thread*: not
   * that Genesis 1 comes before John 1, but that John 1 opens by quoting it.
   * Without the notes the map is a reading order; with them it is a route.
   */
  function renderMap(view: RouteView): void {
    mapError.textContent = view.error ?? '';
    // Secrets are not counted, and that is the point: a player who never finds
    // a single doorway still finishes the pilgrimage.
    mapProgress.textContent = view.error !== null
      ? ''
      : view.complete
        ? `Every passage on the ${view.routeId} route is finished.`
        : `${String(view.finished)} of ${String(view.stops)} passages finished. ` +
          'Secret rooms are not counted \u2014 you can finish without ever finding one.';
    // Standing somewhere the route does not name, the map marks nothing and
    // says so. It used to mark the route's first entry instead, which told a
    // player reading Genesis 2 that he was in Genesis 1 -- and being off the
    // route is a normal thing to do rather than a mistake, so the wording is a
    // statement and not a correction.
    mapStanding.textContent = view.standing === null
      ? ''
      : `You are reading ${view.standing}, which is not on the ${view.routeId} route. `
        + 'Nothing is wrong \u2014 the route is a set of threads, not a fence.'
        // Only when there is one. A card that told him where he left off with
        // nothing finished would be asserting something the record does not say.
        + (view.finished > 0
          ? ' What you have finished is still marked below, so you can pick a thread'
            + ' back up whenever you want one.'
          : '');
    mapNodes.replaceChildren();
    mapThreadList.replaceChildren();
    renderParty(view);

    for (const node of view.nodes) {
      const row = document.createElement('li');
      if (node.current) row.classList.add('here');
      if (node.completed) row.classList.add('done');
      if (!node.unlocked) row.classList.add('locked');

      const name = document.createElement('span');
      name.className = 'what';
      name.textContent = node.ref;

      const state = document.createElement('span');
      state.className = 'how';
      // A locked passage says what unlocks it rather than only that it is shut:
      // "not yet" with no reason reads as a bug in a graph the player can see.
      state.textContent = node.current
        ? 'you are here'
        : node.completed
          ? 'finished'
          : node.kind === 'secret'
            ? 'a room you found'
            : node.unlocked
              ? 'open'
              : 'finish a passage that leads here';

      row.append(name, state);
      if (node.unlocked && !node.current) {
        const go = document.createElement('button');
        go.type = 'button';
        go.textContent = 'Go';
        go.addEventListener('click', () => {
          handlers.travel(node.ref);
        });
        row.append(go);
      }
      mapNodes.append(row);
    }

    for (const thread of view.threads) {
      const row = document.createElement('li');
      if (thread.travelled) row.classList.add('done');
      const ends = document.createElement('span');
      ends.className = 'ends';
      ends.textContent = thread.kind === 'flashback'
        ? `${thread.from} \u21a9 ${thread.to}`
        : `${thread.from} \u2192 ${thread.to}`;
      const note = document.createElement('span');
      note.className = 'what';
      note.textContent = thread.note;
      const echo = document.createElement('span');
      echo.className = 'echo';
      echo.textContent = `\u201c${thread.echo}\u201d`;
      row.append(ends, note, echo);
      mapThreadList.append(row);
    }
  }

  /**
   * Who is with him.
   *
   * The map is where the company is named and the only place it is: a follower
   * in the world carries a mark and nothing else, and a name over a walking
   * figure would be the first line of a second HUD.
   *
   * A figure past the cap is marked rather than dropped. The line on screen is
   * capped so that a crowd cannot compete with the text; the record of who he
   * has met is not capped at all, and saying so here is the difference between
   * a limit and a loss.
   */
  function renderParty(view: RouteView): void {
    mapParty.replaceChildren();
    const walked = view.party.filter((p) => !p.walking).length;
    mapPartyNote.textContent = view.party.length === 0
      ? 'Nobody yet. Finish a passage and its figure walks behind you.'
      : walked === 0
        ? 'They walk behind you while you type, and do nothing else.'
        : `${String(walked)} of them walk on ahead, out of shot, so the page stays clear.`;
    for (const member of view.party) {
      const row = document.createElement('li');
      if (!member.walking) row.classList.add('locked');
      const name = document.createElement('span');
      name.className = 'what';
      name.textContent = member.who;
      const where = document.createElement('span');
      where.className = 'how';
      where.textContent = member.ref;
      row.append(where, name);
      mapParty.append(row);
    }
  }

  /**
   * The report card, on demand.
   *
   * The same nine rows and the same one sentence the canvas card carries,
   * with the room a window has and the canvas does not. It is a diagnosis and
   * never an accusation, and the whole of that difference is in the wording: an
   * empty row says which kind of empty it is, and the latency column -- the one
   * signal the game can honestly read about technique -- is what marks a finger
   * being reached for rather than rested on.
   */
  function renderHands(view: HandsView): void {
    handsScope.textContent = view.scope;
    handsNote.textContent = view.note;
    handsAdvice.textContent = view.advice;

    handsTable.replaceChildren();
    for (const row of view.fingers) {
      const li = document.createElement('li');
      if (row.untaught) li.classList.add('untaught');
      if (row.idle) li.classList.add('idle');

      const name = document.createElement('span');
      name.className = 'finger';
      name.textContent = row.label;

      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = row.untaught ? '—' : String(row.hits + row.errors);

      const share = document.createElement('span');
      share.className = 'share';
      const fill = document.createElement('i');
      fill.style.width = `${String(Math.round(row.share * PERCENT))}%`;
      share.append(fill);

      const acc = document.createElement('span');
      acc.className = 'acc';
      const mean = document.createElement('span');
      mean.className = 'mean';
      if (row.hits === 0) {
        // The two kinds of empty, kept apart. "This stage has not given the
        // finger a key yet" is a fact about the curriculum and it fills itself
        // in; "the finger has keys and has struck none of them" is a fact about
        // the player, and it is the only one of the two he can act on.
        acc.textContent = '';
        mean.textContent = row.untaught ? 'no keys at this stage' : 'not used yet';
      } else {
        acc.textContent = pct(row.accuracy);
        mean.textContent = `${String(Math.round(row.meanMs))} ms`;
        if (row.reaching) mean.classList.add('reaching');
        else if (row.finger === view.quickest) mean.classList.add('quickest');
      }

      li.append(name, count, share, acc, mean);
      handsTable.append(li);
    }

    handsWorst.replaceChildren();
    if (view.worst.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Nothing above the noise yet.';
      handsWorst.append(li);
    }
    for (const key of view.worst) {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = keyName(key.key);
      const how = document.createElement('span');
      how.className = 'how';
      how.textContent = key.confusedWith === ''
        ? `${pct(key.errorRate)} wrong`
        : `${pct(key.errorRate)} wrong, ${keyName(key.confusedWith)} instead`;
      li.append(what, how);
      handsWorst.append(li);
    }

    handsGate.replaceChildren();
    const gate = view.gate;
    if (gate !== null) {
      // Nothing measured yet -- where a player stands the moment after a
      // promotion -- reports no accuracy and no median. "0% against 95%" there
      // would be a failure invented out of an empty table.
      const measured = gate.samples > 0;
      const rows: readonly (readonly [string, string, boolean])[] = [
        ['new keys', gate.newKeys.map(keyName).join('   '), true],
        ...(measured
          ? ([
            [
              'accuracy',
              `${pct(gate.accuracy)} — the stage opens at ${pct(gate.requiredAccuracy)}`,
              gate.accuracyMet,
            ],
            [
              'speed',
              `${String(Math.round(gate.medianMs))} ms a key — the stage opens at `
                + `${String(Math.round(gate.allowedLatencyMs))} ms`,
              gate.latencyMet,
            ],
          ] as const)
          : []),
        [
          'keystrokes',
          `${String(gate.samples)} of ${String(Math.round(gate.requiredSamples))} `
            + 'on the new keys',
          gate.samples >= gate.requiredSamples,
        ],
      ];
      for (const [label, value, met] of rows) {
        const li = document.createElement('li');
        if (!met) li.classList.add('owed');
        const what = document.createElement('span');
        what.className = 'what';
        what.textContent = label;
        const how = document.createElement('span');
        how.className = 'how';
        how.textContent = value;
        li.append(what, how);
        handsGate.append(li);
      }
    }

    handsCurve.replaceChildren();
    const { trend } = view;
    // A stretch typed at nought words a minute is not one; the floor keeps the
    // scale off a division by zero without inventing a number for the chart.
    const top = Math.max(1, trend.bestWpm);
    const switchAt = new Set(trend.switches);
    trend.points.forEach((point, i) => {
      const bar = document.createElement('i');
      if (point.promoted) bar.classList.add('promoted');
      // The rule stands on the left edge of the first bar of the new run, which
      // is what makes it read as a division between two stretches rather than
      // as a mark on one of them.
      if (switchAt.has(i)) bar.classList.add('switched');
      bar.style.height = `${String(Math.max(2, Math.round((point.wpm / top) * PERCENT)))}%`;
      bar.title = `${String(Math.round(point.wpm))} wpm`;
      handsCurve.append(bar);
    });
    // The mode note goes first when there is one, for the reason the promotion
    // note goes first on the card: the step across a mode boundary is far larger
    // than the dip after a promotion, and it is the one a player is most likely
    // to read as a breakthrough. The owner went from 22 wpm to 75 across one,
    // and later to 102, without typing any faster.
    const curveNote = trend.switches.length > 0
      ? `Your last ${countStretches(trend.points.length)}, oldest first. The rule between `
        + 'two bars is where you changed what the page asks for. Typing every character '
        + 'of a verse and typing the characters your stage teaches are two different '
        + 'jobs, so the step across that line is the question changing rather than your '
        + 'hands.'
      : trend.promotions > 0
        ? `Your last ${countStretches(trend.points.length)}, oldest first. A gold bar is a `
          + 'stretch that opened a stage: more of the page is lit there, so the same '
          + 'verse costs more keystrokes and the bars after it are shorter. That dip is '
          + 'the curriculum moving, not you going backwards.'
        : `Your last ${countStretches(trend.points.length)}, oldest first — `
          + `${String(Math.round(trend.avgWpm))} wpm on average over `
          + `${countStretches(trend.parts)} in all.`;
    handsCurveNote.textContent = trend.parts === 0
      ? 'Nothing yet. Finish a few verses and it lands here.'
      : curveNote;
  }

  function showHands(view: HandsView): void {
    renderHands(view);
    menuPanel.hidden = true;
    promotionPanel.hidden = true;
    gildPanel.hidden = true;
    openingPanel.hidden = true;
    mapPanel.hidden = true;
    handsPanel.hidden = false;
    overlay.hidden = false;
    handsResume.focus();
  }

  function showMap(view: RouteView): void {
    renderMap(view);
    menuPanel.hidden = true;
    promotionPanel.hidden = true;
    gildPanel.hidden = true;
    openingPanel.hidden = true;
    handsPanel.hidden = true;
    mapPanel.hidden = false;
    overlay.hidden = false;
    mapResume.focus();
  }

  /**
   * The promotion moment.
   *
   * It says the coming WPM drop out loud, before the player sees it. An
   * unexplained dip after a stage unlock is the single most likely reason a
   * beginner concludes the game is broken -- docs/design/08-stats.md#history --
   * and the fix is one sentence delivered at the right moment.
   */
  function showPromotion(promotion: Promotion, onDismiss: () => void): void {
    dismissPromotion = onDismiss;
    promotionTitle.textContent = `Stage ${String(promotion.to)} unlocked`;
    promotionDescription.textContent = promotion.description;
    promotionKeys.textContent = promotion.newKeys.map(keyName).join('   ');
    promotionDip.textContent =
      'Your WPM is about to drop, and that is the promotion working. More of the ' +
      'page is lit now, so there are more characters to type in the same verse — ' +
      'you are being asked for more, not doing worse. It comes back within a few ' +
      'verses, and the history in the menu marks this one so the dip has a name.';
    promotionCoverage.textContent =
      `Lit characters: ${pct(promotion.coverageBefore)} of the text before, ` +
      `${pct(promotion.coverageAfter)} from here.`;
    menuPanel.hidden = true;
    gildPanel.hidden = true;
    openingPanel.hidden = true;
    mapPanel.hidden = true;
    handsPanel.hidden = true;
    promotionPanel.hidden = false;
    overlay.hidden = false;
    promotionOk.focus();
  }

  function dismiss(): void {
    const done = dismissPromotion;
    close();
    if (done !== null) done();
  }

  /**
   * The offer.
   *
   * It states what the mode does and what it does *not* do -- it will not move
   * the player's stage -- because the one thing a player might reasonably hope
   * for here is a shortcut through the curriculum, and letting them find out
   * otherwise by playing would be a worse way to say it. The stage control is
   * named in the same breath, since that is the honest route.
   */
  function showGildOffer(onAnswer: (accept: boolean) => void): void {
    answerGild = onAnswer;
    menuPanel.hidden = true;
    promotionPanel.hidden = true;
    openingPanel.hidden = true;
    mapPanel.hidden = true;
    handsPanel.hidden = true;
    gildPanel.hidden = false;
    overlay.hidden = false;
    gildNo.focus();
  }

  function answer(accept: boolean): void {
    const done = answerGild;
    close();
    if (done !== null) done(accept);
  }

  /**
   * The opening screen.
   *
   * One idea -- the bumps on F and J -- and one button. It says nothing about
   * stages, hearts, the ink cloud or anything else the player will meet on his
   * own, because he should be typing real words inside fifteen seconds and
   * every extra sentence here is a sentence between him and that.
   */
  function showOpening(onDone: () => void): void {
    finishOpening = onDone;
    menuPanel.hidden = true;
    promotionPanel.hidden = true;
    gildPanel.hidden = true;
    mapPanel.hidden = true;
    handsPanel.hidden = true;
    openingPanel.hidden = false;
    overlay.hidden = false;
    openingOk.focus();
  }

  function opened(): void {
    const done = finishOpening;
    close();
    if (done !== null) done();
  }

  function go(): void {
    const chapter = Number.parseInt(chapterInput.value, 10);
    if (!Number.isInteger(chapter) || chapter < 1) {
      showError('Chapter must be a whole number, 1 or greater.');
      return;
    }
    handlers.jump(bookSelect.value, chapter);
  }

  openButton.addEventListener('click', () => {
    handlers.requestMenu();
  });
  mapMenu.addEventListener('click', () => {
    handlers.requestMenu();
  });
  mapResume.addEventListener('click', () => {
    close();
    handlers.resume();
  });
  audioButton.addEventListener('click', () => {
    handlers.toggleAudio();
  });
  promotionOk.addEventListener('click', dismiss);
  openingOk.addEventListener('click', opened);
  firstRunButton.addEventListener('click', () => {
    handlers.replayFirstRun();
  });
  mapButton.addEventListener('click', () => {
    handlers.requestMap();
  });
  handsButton.addEventListener('click', () => {
    handlers.requestHands();
  });
  handsMenu.addEventListener('click', () => {
    handlers.requestMenu();
  });
  handsResume.addEventListener('click', () => {
    close();
    handlers.resume();
  });
  readButton.addEventListener('click', () => {
    handlers.startReading();
  });
  resumeButton.addEventListener('click', () => {
    close();
    handlers.resume();
  });
  restartButton.addEventListener('click', () => {
    close();
    handlers.restart();
  });
  goButton.addEventListener('click', go);
  const onKeyboardChange = (): void => {
    handlers.setKeyboard(
      layoutSelect.value === 'iso' ? 'iso' : 'ansi',
      thumbSelect.value === 'lt' ? 'lt' : 'rt',
    );
  };
  layoutSelect.addEventListener('change', onKeyboardChange);
  thumbSelect.addEventListener('change', onKeyboardChange);
  editionSelect.addEventListener('change', () => {
    handlers.setEdition(editionSelect.value);
  });
  cloudSelect.addEventListener('change', () => {
    handlers.setCloud(cloudSelect.value !== 'off');
  });
  motionSelect.addEventListener('change', () => {
    const chosen = motionSelect.value;
    handlers.setMotion(isMotionSetting(chosen) ? chosen : 'auto');
  });
  gildingSelect.addEventListener('change', () => {
    handlers.setGilding(gildingSelect.value === 'on');
  });
  mistakesSelect.addEventListener('change', () => {
    handlers.setMistakesStand(mistakesSelect.value === 'stand');
  });
  stageSelect.addEventListener('change', () => {
    const stage = Number.parseInt(stageSelect.value, 10);
    if (Number.isInteger(stage)) handlers.setStage(stage);
  });
  gildYes.addEventListener('click', () => {
    answer(true);
  });
  gildNo.addEventListener('click', () => {
    answer(false);
  });
  chapterInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') go();
  });
  exportButton.addEventListener('click', () => {
    handlers.exportFile();
  });
  importInput.addEventListener('change', () => {
    const file = importInput.files?.item(0) ?? null;
    importInput.value = '';
    if (file !== null) handlers.importFile(file);
  });
  resetButton.addEventListener('click', () => {
    const sure = confirm(
      'Start over? This erases your stage, your key statistics and your whole ' +
        'practice history on this browser. Export first if you might want it back.',
    );
    if (sure) {
      close();
      handlers.startOver();
    }
  });

  // Escape closes whichever panel is up; Enter takes the promotion's one button.
  // Both are added at the document level because the panels are not always the
  // focused element, and neither fires while the typing listener is attached --
  // main.ts detaches that before opening anything.
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!openingPanel.hidden) {
        // Escaping the opening screen is dismissing it, not deferring it. He
        // has found the bumps or he has decided not to; either way it has been
        // offered, and offering it again tomorrow would say the game had not
        // noticed. The menu has it back on purpose.
        opened();
        return;
      }
      if (!gildPanel.hidden) {
        // Escaping the offer is "not now", and it is remembered like any other
        // answer. Leaving it unanswered would bring it back tomorrow.
        answer(false);
        return;
      }
      if (!promotionPanel.hidden) {
        dismiss();
        return;
      }
      close();
      handlers.resume();
      return;
    }
    if (event.key === 'Enter' && !promotionPanel.hidden) {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === 'Enter' && !openingPanel.hidden) {
      event.preventDefault();
      opened();
    }
  });

  return {
    isOpen, showOpening, openMenu, showMap, showHands, showPromotion, showGildOffer,
    showError, showAudio, close,
  };
}
