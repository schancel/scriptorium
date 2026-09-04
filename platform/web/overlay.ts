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
import type { HistoryEntry, Promotion } from '../../core/progress.js';
import type { KeyboardLayout, Thumb } from '../../core/types.js';

/** What the caller must be able to do when a button is pressed. */
export interface OverlayHandlers {
  /** The player asked for the menu; the caller builds the view and opens it. */
  requestMenu(): void;
  resume(): void;
  restart(): void;
  jump(edition: string, book: string, chapter: number): void;
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
  startOver(): void;
  exportFile(): void;
  importFile(file: File): void;
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
  /** The stage the player is on, and every stage they could choose instead. */
  readonly stage: number;
  readonly stages: readonly { readonly stage: number; readonly description: string }[];
  /** Whether gilding is on. See `OverlayHandlers.setGilding`. */
  readonly gilding: boolean;
  readonly history: readonly HistoryEntry[];
}

export interface Overlay {
  isOpen(): boolean;
  openMenu(view: MenuView): void;
  showPromotion(promotion: Promotion, onDismiss: () => void): void;
  /**
   * Ask whether the player wants gilding. `onAnswer` is called with their
   * answer -- including `false`, which is a real answer and is remembered, so
   * the question is asked once rather than after every good session.
   */
  showGildOffer(onAnswer: (accept: boolean) => void): void;
  showError(message: string): void;
  /** Say out loud whether the sound is on. The control is the only indicator. */
  showAudio(on: boolean): void;
  close(): void;
}

const PERCENT = 100;
/** Most recent sessions shown in the menu. Enough to see a trend, few enough to scan. */
const HISTORY_SHOWN = 14;
const PROMOTED_MARK = '▲';

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
  const stageSelect = need('menu-stage-select', HTMLSelectElement);
  const gildingSelect = need('menu-gilding', HTMLSelectElement);
  const errorLine = need('menu-error', HTMLParagraphElement);
  const resumeButton = need('menu-resume', HTMLButtonElement);
  const restartButton = need('menu-restart', HTMLButtonElement);
  const exportButton = need('menu-export', HTMLButtonElement);
  const importInput = need('menu-import', HTMLInputElement);
  const resetButton = need('menu-reset', HTMLButtonElement);
  const historyList = need('menu-history', HTMLOListElement);
  const historyNote = need('history-note', HTMLParagraphElement);

  const promotionTitle = need('promotion-title', HTMLHeadingElement);
  const promotionDescription = need('promotion-description', HTMLParagraphElement);
  const promotionKeys = need('promotion-keys', HTMLParagraphElement);
  const promotionDip = need('promotion-dip', HTMLParagraphElement);
  const promotionCoverage = need('promotion-coverage', HTMLParagraphElement);
  const promotionOk = need('promotion-ok', HTMLButtonElement);

  const gildPanel = need('panel-gild', HTMLDivElement);
  const gildYes = need('gild-yes', HTMLButtonElement);
  const gildNo = need('gild-no', HTMLButtonElement);

  for (const entry of CANON) {
    const option = document.createElement('option');
    option.value = entry.title;
    option.textContent = entry.title;
    bookSelect.append(option);
  }

  let dismissPromotion: (() => void) | null = null;
  let answerGild: ((accept: boolean) => void) | null = null;

  function isOpen(): boolean {
    return !overlay.hidden;
  }

  function close(): void {
    overlay.hidden = true;
    menuPanel.hidden = true;
    promotionPanel.hidden = true;
    gildPanel.hidden = true;
    dismissPromotion = null;
    answerGild = null;
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
  function showAudio(on: boolean): void {
    audioButton.textContent = on ? '\u266a sound: on' : '\u266a sound: off';
    audioButton.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function renderHistory(history: readonly HistoryEntry[]): void {
    historyList.replaceChildren();
    if (history.length === 0) {
      historyNote.textContent = 'Nothing yet. Finish your first passage and it lands here.';
      return;
    }
    historyNote.textContent =
      `Sessions marked ${PROMOTED_MARK} unlocked a stage. Expect the WPM *after* one to be ` +
      'lower than the WPM before it: a new stage lights up more of the page, so there ' +
      'are more characters to type per verse. That dip is the curriculum moving, not ' +
      'you going backwards, and it comes back within a few sessions.';

    for (const entry of [...history].slice(-HISTORY_SHOWN).reverse()) {
      const row = document.createElement('li');
      if (entry.promoted) row.classList.add('promoted');

      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = entry.date;

      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = entry.promoted
        ? `${PROMOTED_MARK} ${entry.ref} - stage ${String(entry.stage + 1)} unlocked`
        : entry.ref;

      const how = document.createElement('span');
      how.className = 'how';
      how.textContent = `${String(Math.round(entry.wpm))} wpm  ${pct(entry.accuracy)}`;

      row.append(when, what, how);
      historyList.append(row);
    }
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
    where.textContent = view.where;
    stageLine.textContent = view.stageLine;
    editionSelect.value = view.edition;
    bookSelect.value = view.book;
    chapterInput.value = String(view.chapter);
    layoutSelect.value = view.layout;
    thumbSelect.value = view.spaceThumb;
    cloudSelect.value = view.cloudEnabled ? 'on' : 'off';
    gildingSelect.value = view.gilding ? 'on' : 'off';
    renderStages(view);
    errorLine.textContent = '';
    renderHistory(view.history);
    promotionPanel.hidden = true;
    gildPanel.hidden = true;
    menuPanel.hidden = false;
    overlay.hidden = false;
    resumeButton.focus();
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
      'page is live now, so there are more characters to type in the same verse — ' +
      'you are being asked for more, not doing worse. It comes back within a few ' +
      'sessions, and the history in the menu marks this session so the dip has a name.';
    promotionCoverage.textContent =
      `Live characters: ${pct(promotion.coverageBefore)} of the text before, ` +
      `${pct(promotion.coverageAfter)} from here.`;
    menuPanel.hidden = true;
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
    gildPanel.hidden = false;
    overlay.hidden = false;
    gildNo.focus();
  }

  function answer(accept: boolean): void {
    const done = answerGild;
    close();
    if (done !== null) done(accept);
  }

  function go(): void {
    const chapter = Number.parseInt(chapterInput.value, 10);
    if (!Number.isInteger(chapter) || chapter < 1) {
      showError('Chapter must be a whole number, 1 or greater.');
      return;
    }
    handlers.jump(editionSelect.value, bookSelect.value, chapter);
  }

  openButton.addEventListener('click', () => {
    handlers.requestMenu();
  });
  audioButton.addEventListener('click', () => {
    handlers.toggleAudio();
  });
  promotionOk.addEventListener('click', dismiss);
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
  cloudSelect.addEventListener('change', () => {
    handlers.setCloud(cloudSelect.value !== 'off');
  });
  gildingSelect.addEventListener('change', () => {
    handlers.setGilding(gildingSelect.value === 'on');
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
    }
  });

  return { isOpen, openMenu, showPromotion, showGildOffer, showError, showAudio, close };
}
