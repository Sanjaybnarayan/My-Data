#!/usr/bin/env node
/**
 * Draw the native launcher icons and launch screens.
 *
 *   node tools/native-icons.mjs
 *
 * `npx cap add` ships Capacitor's own logo as placeholder branding. An app on
 * somebody's home screen wearing the framework's mark is not a small blemish —
 * it is the one image a household sees every day.
 *
 * FamilyOS already owns its mark twice over: `assets/icon.svg`, and
 * `tools/make-icons.mjs`, which draws the same geometry with signed distance
 * functions and writes a PNG through zlib. So this imports that rather than
 * describing the shapes a third time, and adds no dependency — not
 * `@capacitor/assets`, not an image library.
 *
 * ## What gets written
 *
 *   Android  mipmap-DENSITY/ic_launcher.png            legacy square, 48…192
 *            mipmap-DENSITY/ic_launcher_round.png      legacy round, 48…192
 *            mipmap-DENSITY/ic_launcher_foreground.png adaptive layer, 108…432
 *            values/ic_launcher_background.xml         the colour beneath it
 *            drawable[-night]-DENSITY/splash.png       launch screens, both themes
 *   iOS      AppIcon.appiconset/AppIcon-512@2x.png
 *            Splash.imageset/splash-2732x2732*.png
 *
 * ## Why the launch screens come in two themes
 *
 * The application goes to some trouble not to flash white at a dark-mode user:
 * `index.html` reads the stored theme in an inline script before the first
 * paint, precisely so that does not happen. A launch screen that is white
 * regardless would put the flash back one layer down, before any of the
 * application's own code has run.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawIcon, encodePng } from './make-icons.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android/app/src/main/res');
const IOS = join(ROOT, 'ios/App/App/Assets.xcassets');

/** The two backgrounds `manifest.webmanifest` and `css/tokens.css` already use. */
const LIGHT = [0xfb, 0xfb, 0xfc];
const DARK = [0x0e, 0x10, 0x14];

/** The mark's own blue, for the flat layer under the adaptive icon. */
const BRAND = '#1A73E8';

/** @type {[string, number][]} */
const DENSITIES = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];

function write(path, png) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return png.length;
}

/**
 * A launch screen: flat background, the mark centred at a quarter of the
 * shorter edge. Composited rather than drawn, because the mark's rasteriser
 * only knows how to fill a square.
 */
function splash(width, height, background) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = background[0];
    pixels[i * 4 + 1] = background[1];
    pixels[i * 4 + 2] = background[2];
    pixels[i * 4 + 3] = 255;
  }

  const size = Math.round(Math.min(width, height) * 0.25);
  const mark = drawIcon(size, {});
  const left = Math.round((width - size) / 2);
  const top = Math.round((height - size) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const alpha = mark[from + 3] / 255;
      if (!alpha) continue;
      const to = ((top + y) * width + (left + x)) * 4;
      for (let c = 0; c < 3; c++) {
        pixels[to + c] = Math.round(mark[from + c] * alpha + pixels[to + c] * (1 - alpha));
      }
    }
  }
  return encodePng(pixels, width, height);
}

/* --------------------------------------------------------------- android */

function android() {
  if (!existsSync(ANDROID)) return { files: 0, bytes: 0, skipped: 'android/ has not been added' };
  let files = 0;
  let bytes = 0;

  for (const [density, scale] of DENSITIES) {
    const legacy = Math.round(48 * scale);
    bytes += write(join(ANDROID, `mipmap-${density}/ic_launcher.png`),
      encodePng(drawIcon(legacy, {}), legacy));
    bytes += write(join(ANDROID, `mipmap-${density}/ic_launcher_round.png`),
      encodePng(drawIcon(legacy, { maskable: true }), legacy));

    const adaptive = Math.round(108 * scale);
    bytes += write(join(ANDROID, `mipmap-${density}/ic_launcher_foreground.png`),
      encodePng(drawIcon(adaptive, { foreground: true }), adaptive));
    files += 3;

    /*
     * Portrait and landscape, light and dark. The dimensions are the ones
     * `cap add` laid down; only the pixels change.
     *
     * The qualifier order is not a style choice. Android fixes it — orientation
     * before night mode before density — and rejects anything else outright
     * with "Invalid resource directory name", failing the whole build at
     * mergeResources. This first shipped as `drawable-night-port-hdpi` and
     * every check in this repository passed it, because none of them knew what
     * Android calls a directory. The build on a runner that could actually
     * compile is what found it.
     */
    const [w, h] = [Math.round(320 * scale), Math.round(480 * scale)];
    /** @type {[string, number[]][]} */
    const themes = [['', LIGHT], ['-night', DARK]];
    for (const [night, background] of themes) {
      bytes += write(join(ANDROID, `drawable-port${night}-${density}/splash.png`), splash(w, h, background));
      bytes += write(join(ANDROID, `drawable-land${night}-${density}/splash.png`), splash(h, w, background));
      files += 2;
    }
  }

  // The default-density fallback `cap add` writes, in both themes.
  bytes += write(join(ANDROID, 'drawable/splash.png'), splash(480, 320, LIGHT));
  bytes += write(join(ANDROID, 'drawable-night/splash.png'), splash(480, 320, DARK));
  files += 2;

  writeFileSync(join(ANDROID, 'values/ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    + `    <color name="ic_launcher_background">${BRAND}</color>\n</resources>\n`);
  files += 1;

  return { files, bytes };
}

/* ------------------------------------------------------------------- ios */

function ios() {
  if (!existsSync(IOS)) return { files: 0, bytes: 0, skipped: 'ios/ has not been added' };
  let files = 0;
  let bytes = 0;

  // The App Store refuses an icon that *has* an alpha channel, not merely one
  // with transparent pixels, so flattening to opaque is not enough — this is
  // written as RGB. `drawIcon` fills a rounded tile and leaves the corners
  // outside it transparent, so they are composited onto white first, which is
  // what iOS would have shown behind them anyway.
  const size = 1024;
  const icon = drawIcon(size, {});
  for (let i = 0; i < size * size; i++) {
    const alpha = icon[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      icon[i * 4 + c] = Math.round(icon[i * 4 + c] * alpha + 255 * (1 - alpha));
    }
    icon[i * 4 + 3] = 255;
  }
  bytes += write(join(IOS, 'AppIcon.appiconset/AppIcon-512@2x.png'),
    encodePng(icon, size, size, { alpha: false }));
  files += 1;

  // One square image at three scales, which is how `cap add` sets it up.
  const launch = splash(2732, 2732, LIGHT);
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    bytes += write(join(IOS, `Splash.imageset/${name}`), launch);
    files += 1;
  }

  return { files, bytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  /** @type {[string, {files: number, bytes: number, skipped?: string}][]} */
  const done = [['android', android()], ['ios', ios()]];
  for (const [name, result] of done) {
    if (result.skipped) console.log(`${name}: skipped — ${result.skipped}`);
    else console.log(`${name}: ${result.files} files, ${(result.bytes / 1024).toFixed(0)} kB`);
  }
}
