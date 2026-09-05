/**
 * `keydown` -> normalised core input events.
 *
 * The core is handed characters and command names, never key codes, modifier
 * state or DOM events -- see docs/architecture/core-purity.md#the-injected-seams.
 * Normalising here is also what lets a Flutter port reuse every typing test.
 */

import type { InputEvent } from '../../core/types.js';

/** Non-printing keys the game listens for, by their DOM `key` name. */
const COMMANDS: Readonly<Record<string, string>> = {
  Enter: 'enter',
  Escape: 'escape',
  Backspace: 'backspace',
  Tab: 'tab',
  // Up and down are a pace, not a direction: reading mode brings the pace down
  // with them and nothing else in the game listens for them. They are named for
  // the key rather than for what one mode does with it, because a command
  // called `slower` would be a mode's opinion sitting in the input layer.
  ArrowDown: 'down',
  ArrowUp: 'up',
};

/**
 * Keys the browser would otherwise steal mid-verse: space and the arrows scroll
 * the page, Tab walks the focus ring, and `/` and `'` open quick-find in
 * Firefox. All but the arrows are characters the curriculum teaches, and the
 * arrows set the reading pace -- so none of them may reach the browser.
 */
function stealsFocus(key: string): boolean {
  return key === ' ' || key === 'Tab' || key === '/' || key === "'" || key === 'Backspace'
    || key === 'ArrowUp' || key === 'ArrowDown';
}

/**
 * Listen for typing. Returns a function that detaches again.
 *
 * A keystroke held with Ctrl, Alt or Meta is left to the browser: reload,
 * switch tab and copy must keep working while the game has focus.
 */
export function attachKeyboard(
  target: Window,
  onEvent: (event: InputEvent) => void,
): () => void {
  const handler = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const command = COMMANDS[event.key];
    if (command !== undefined) {
      if (stealsFocus(event.key)) event.preventDefault();
      onEvent({ type: 'command', value: command });
      return;
    }

    // `key.length === 1` is the printable test: it admits letters, digits,
    // punctuation and space, and rejects 'Shift', 'ArrowLeft' and the rest.
    if ([...event.key].length === 1) {
      if (stealsFocus(event.key)) event.preventDefault();
      onEvent({ type: 'key', value: event.key });
    }
  };

  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}
