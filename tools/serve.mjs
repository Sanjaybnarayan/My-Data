#!/usr/bin/env node
/**
 * A static server for development.
 *
 *   node tools/serve.mjs [port]
 *
 * FamilyOS needs a secure context — WebCrypto, service workers and WebAuthn
 * are all unavailable over plain `http://` to anything but `localhost`. So
 * `file://` will not do, and this exists rather than making everyone install
 * one. It serves the directory, sets the right types, and sends no cache
 * headers so an edit is one reload away.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  // `normalize` collapses `..`, and the prefix check refuses anything that
  // still points outside the directory — a dev server is still a server.
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let path = join(ROOT, requested === '/' ? 'index.html' : requested);

  if (!path.startsWith(ROOT)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, 'index.html');

    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      // The same policy the production host should send, so a header problem
      // is found here rather than after deployment.
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // A service worker may only control the scope it is served from.
      'Service-Worker-Allowed': '/',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`FamilyOS  →  http://localhost:${PORT}/`);
  console.log('localhost counts as a secure context, so WebCrypto and service workers work.');
});
