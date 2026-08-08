/**
 * Icons.
 *
 * Inline SVG paths on a 24×24 grid, drawn with `currentColor` so they follow
 * the text colour in both themes without a second asset. No icon font, no
 * sprite sheet, no network request — the whole set is smaller than one webfont
 * and cannot arrive late and reflow the page.
 */

import { h } from './dom.js';

const PATHS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  family: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2 20a6 6 0 0 1 12 0M15 20a5 5 0 0 1 7 0',
  wallet: 'M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 12h3M3 9h18',
  bank: 'M3 10h18L12 4zM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  car: 'M5 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 15h10M3 15v-4l2-5h14l2 5v4',
  health: 'M12 21s-8-4.7-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 11c0 5.3-8 10-8 10z',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6z',
  home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  school: 'M12 4L2 9l10 5 10-5zM6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5',
  check: 'M4 12l5 5L20 6',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9h16M8 3v4M16 3v4',
  note: 'M5 4a1 1 0 0 1 1-1h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 10h8M8 14h6',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3M12 15v2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  report: 'M6 3h9l4 4v14H6zM9 12h6M9 16h6M9 8h3',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.5-4.5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  download: 'M12 4v11M8 12l4 4 4-4M4 20h16',
  upload: 'M12 20V9M8 12l4-4 4 4M4 4h16',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  repeat: 'M4 9V7a2 2 0 0 1 2-2h12l-3-3M20 15v2a2 2 0 0 1-2 2H6l3 3',
  cloud: 'M7 18a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17.5 18z',
  cloudOff: 'M7 18a4 4 0 0 1 .6-8M18.2 11.5A5.5 5.5 0 0 0 9 8M3 3l18 18M17.5 18H8',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.3A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.7A17 17 0 0 0 2 12s3.6 7 10 7c1.2 0 2.2-.2 3.2-.5',
  copy: 'M9 9h10v12H9zM5 15V3h10v2',
  badge: 'M12 3l2.5 1.7 3-.3 1 2.8 2.5 1.6-1 2.9 1 2.9-2.5 1.6-1 2.8-3-.3L12 21l-2.5-1.7-3 .3-1-2.8L3 15.2l1-2.9-1-2.9 2.5-1.6 1-2.8 3 .3z',
  briefcase: 'M3 8h18v12H3zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 13h18',
  cake: 'M4 21h16v-7H4zM6 14v-3h12v3M12 8V5M9 8V6M15 8V6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3L11.6 6.7M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.4-1.4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  loan: 'M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5h-4a2.5 2.5 0 0 0 0 5h6',
  swap: 'M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5L21 10a6 6 0 0 1-8.2 7L6 23l-3-3 6-6.8A6 6 0 0 1 16 5z',
  fuel: 'M4 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M3 20h11M13 10h4a1 1 0 0 1 1 1v5a1.5 1.5 0 0 0 3 0V9l-3-3M6 8h5',
  pill: 'M8.5 15.5l7-7a4.95 4.95 0 0 0-7-7l-7 7a4.95 4.95 0 0 0 7 7zM5 12l7 7',
  syringe: 'M17 3l4 4M18.5 5.5L21 3M14 6l4 4M4 20l1-4 8-8 3 3-8 8zM11 9l-2 2',
  award: 'M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 14l-2 7 5-3 5 3-2-7',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  phone: 'M5 3h4l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.5',
  print: 'M7 8V3h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  logout: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h11',
  key: 'M15 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13.5 7.5L3 18v3h3l1-1v-2h2v-2h2l1.5-1.5',
  fingerprint: 'M12 4a8 8 0 0 1 8 8v2M4 12a8 8 0 0 1 4-6.9M8 20a12 12 0 0 0 1.5-6 2.5 2.5 0 0 1 5 0c0 1.5-.2 3-.6 4.4M16.5 20a17 17 0 0 0 1-6 5.5 5.5 0 0 0-10.6-2',
  drag: 'M9 6h.5M15 6h.5M9 12h.5M15 12h.5M9 18h.5M15 18h.5',
  camera: 'M4 8a2 2 0 0 1 2-2h1.5l1.2-2h6.6l1.2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  tree: 'M12 3v4M12 11v3M6 21v-4M18 21v-4M6 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15h12',
  bell: 'M18 16v-5a6 6 0 0 0-12 0v5l-2 3h16zM10 22a2 2 0 0 0 4 0',
};

/**
 * @param {string} name
 * @param {{size?: number, class?: string, title?: string}} [options]
 */
export function icon(name, { size = 20, class: className = '', title } = {}) {
  const path = PATHS[name] ?? PATHS.info;
  return h('svg', {
    class: ['icon', className],
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.75,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    // Decorative unless it is the only label, in which case a title makes it
    // an image with an accessible name rather than noise.
    ...(title ? { role: 'img' } : { 'aria-hidden': 'true', focusable: 'false' }),
  }, [
    title ? h('title', {}, title) : null,
    h('path', { d: path }),
  ]);
}

export function hasIcon(name) {
  return Object.hasOwn(PATHS, name);
}

export const iconNames = Object.keys(PATHS);
