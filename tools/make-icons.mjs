#!/usr/bin/env node
/**
 * Rasterise the app icon to PNG.
 *
 *   node tools/make-icons.mjs
 *
 * `assets/icon.svg` is the source of truth and covers every modern browser,
 * but Android's install banner and iOS's home screen still want raster files,
 * and a maskable icon has to be a bitmap. Rather than commit binaries nobody
 * can review, the shapes are described once here and drawn with signed
 * distance functions — the same geometry as the SVG, in about a hundred lines.
 *
 * PNG is written directly: a filtered scanline stream through zlib, which is
 * in the standard library. No image dependency for four files.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/* -------------------------------------------------------------- geometry */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Distance from a point to a line segment — the basis of every stroke here. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function roundedRectDistance(px, py, size, radius) {
  const half = size / 2;
  const dx = Math.abs(px - half) - (half - radius);
  const dy = Math.abs(py - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

const BLUE = [0x1a, 0x73, 0xe8];
const PURPLE = [0x7b, 0x4f, 0xd8];

/**
 * @param {number} size pixels
 * @param {{maskable?: boolean, foreground?: boolean}} options a maskable icon
 *   keeps its content inside the safe circle, because the platform may crop
 *   the corners off; a foreground draws the mark alone, for the upper layer of
 *   an Android adaptive icon.
 */
export function drawIcon(size, { maskable = false, foreground = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size / 512;                       // scale from the SVG's grid

  /*
   * Three framings of one drawing.
   *
   *   plain       the mark on its gradient tile, corner to corner
   *   maskable    the same inside the circle a launcher may crop to
   *   foreground  the mark alone on transparency, for an Android adaptive
   *               icon whose background is a flat colour underneath it
   *
   * The adaptive foreground is 108dp of which only the middle 72dp is
   * guaranteed to survive the mask, so the content is scaled to two thirds and
   * centred rather than filling the file.
   */
  const inset = maskable ? size * 0.1 : foreground ? size * (18 / 108) : 0;
  const contentScale = maskable ? 0.8 : foreground ? 72 / 108 : 1;
  const shift = (v) => inset + v * s * contentScale;
  const width = (v) => v * s * contentScale;

  // The SVG's shapes, in its own 512 coordinate space.
  const roof = [[116, 244], [256, 140], [396, 244]];
  const heads = [[196, 308, 30], [316, 308, 30], [256, 366, 24]];
  const shoulders = [[196, 402, 54], [316, 402, 54]];

  const coverage = (x, y) => {
    // 3×3 supersampling: enough to keep a 30px circle's edge clean at 192px
    // without the cost of a proper analytic rasteriser.
    let inShape = 0;
    let inBackground = 0;

    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        const px = x + (sx + 0.5) / 3;
        const py = y + (sy + 0.5) / 3;

        if (!foreground) {
          const bg = maskable
            ? Math.hypot(px - size / 2, py - size / 2) - size / 2
            : roundedRectDistance(px, py, size, size * (112 / 512));
          if (bg <= 0) inBackground++;
        }

        let hit = false;

        for (let i = 0; i < roof.length - 1 && !hit; i++) {
          const d = distanceToSegment(
            px, py,
            shift(roof[i][0]), shift(roof[i][1]),
            shift(roof[i + 1][0]), shift(roof[i + 1][1]),
          );
          if (d <= width(13)) hit = true; // stroke-width 26, so half is 13
        }

        for (const [cx, cy, r] of heads) {
          if (hit) break;
          if (Math.hypot(px - shift(cx), py - shift(cy)) <= width(r)) hit = true;
        }

        for (const [cx, cy, r] of shoulders) {
          if (hit) break;
          const dist = Math.hypot(px - shift(cx), py - shift(cy));
          // Upper half of the ring only: a shoulder line, not a full circle.
          if (py <= shift(cy) && Math.abs(dist - width(r)) <= width(11)) hit = true;
        }

        if (hit) inShape++;
      }
    }
    return { shape: inShape / 9, background: inBackground / 9 };
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { shape, background } = coverage(x, y);
      const t = (x + y) / (2 * size); // the SVG's diagonal gradient
      const base = [
        Math.round(BLUE[0] + (PURPLE[0] - BLUE[0]) * t),
        Math.round(BLUE[1] + (PURPLE[1] - BLUE[1]) * t),
        Math.round(BLUE[2] + (PURPLE[2] - BLUE[2]) * t),
      ];

      const i = (y * size + x) * 4;
      if (foreground) {
        /*
         * White, over nothing.
         *
         * The plain icon paints a white mark onto the gradient tile. An
         * adaptive icon splits those two layers apart: this file is the mark,
         * and the flat colour underneath it is the tile. Drawing the mark in
         * the gradient instead — which is what this did first — puts brand
         * blue on top of brand blue, and the launcher shows a blank square.
         * Caught by looking at the file rather than at its byte count.
         */
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = Math.round(255 * shape);
      } else {
        pixels[i] = Math.round(base[0] + (255 - base[0]) * shape);
        pixels[i + 1] = Math.round(base[1] + (255 - base[1]) * shape);
        pixels[i + 2] = Math.round(base[2] + (255 - base[2]) * shape);
        pixels[i + 3] = Math.round(255 * background);
      }
    }
  }

  return pixels;
}

/* ------------------------------------------------------------------- PNG */

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * @param {Buffer} pixels RGBA, four bytes per pixel
 * @param {number} width
 * @param {number} height
 * @param {{alpha?: boolean}} options `alpha: false` drops the channel and
 *   writes RGB. App Store Connect refuses an app icon that has an alpha
 *   channel at all — not merely one with transparent pixels in it — so the
 *   iOS icon cannot simply be flattened and left four bytes wide.
 */
export function encodePng(pixels, width, height = width, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // bit depth
  header[9] = alpha ? 6 : 2;   // colour type: RGBA or RGB
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlace

  // One filter byte per scanline. Filter 0 (none) keeps this readable; the
  // gradient compresses well enough that a smarter filter is not worth it.
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const line = y * (stride + 1);
    raw[line] = 0;
    if (alpha) {
      pixels.copy(raw, line + 1, y * width * 4, (y + 1) * width * 4);
    } else {
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 4;
        raw[line + 1 + x * 3] = pixels[from];
        raw[line + 2 + x * 3] = pixels[from + 1];
        raw[line + 3 + x * 3] = pixels[from + 2];
      }
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ main */

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });

  /** @type {[string, number, {maskable?: boolean, foreground?: boolean}][]} */
  const targets = [
    ['icon-192.png', 192, {}],
    ['icon-512.png', 512, {}],
    ['icon-maskable.png', 512, { maskable: true }],
  ];

  for (const [name, size, options] of targets) {
    const png = encodePng(drawIcon(size, options), size);
    writeFileSync(join(OUT, name), png);
    console.log(`${name}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
  }
}
