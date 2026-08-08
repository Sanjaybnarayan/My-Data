/**
 * Theme.
 *
 * Three states, not two: light, dark, and *follow the system*. The third is
 * the default and the one most people want; an app that forces a choice at
 * first run has already got it wrong.
 *
 * The stored preference is read by the inline script in `index.html` before
 * the stylesheet paints, so a dark-mode user never sees a white flash. This
 * module keeps that in step afterwards.
 */

import { bus, TOPIC } from '../core/bus.js';

const KEY = 'familyos.theme';
export const THEMES = ['system', 'light', 'dark'];

export function storedTheme(storage = globalThis.localStorage) {
  const value = storage?.getItem(KEY);
  return THEMES.includes(value) ? value : 'system';
}

export function effectiveTheme(preference = storedTheme()) {
  if (preference !== 'system') return preference;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference, { storage = globalThis.localStorage, root = document.documentElement } = {}) {
  if (!THEMES.includes(preference)) preference = 'system';
  storage?.setItem(KEY, preference);

  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }

  // The browser chrome — address bar, status bar — should match the app, or
  // an installed PWA has a stripe of the wrong colour at the top.
  const dark = effectiveTheme(preference) === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0e1014' : '#fbfbfc');

  bus.emit(TOPIC.theme, { preference, effective: effectiveTheme(preference) });
  return preference;
}

/** Re-apply when the system flips, but only while following the system. */
export function watchSystemTheme() {
  const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!query) return () => {};
  const onChange = () => {
    if (storedTheme() === 'system') applyTheme('system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function nextTheme(current = storedTheme()) {
  return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
}
