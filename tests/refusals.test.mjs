/**
 * Two compliance controls that assert an absence, tested rather than asserted.
 *
 * `UIDAI/no-authentication` and `PROPERTY/no-legal-effect-claim` both say the
 * application does **not** do something. Both sat at `IMPLEMENTED` citing a
 * file and a document — which is somebody's word for it, and the two were the
 * only controls below `TESTED` carrying no stated gap. A refusal is the
 * easiest kind of claim to test and the easiest kind to let rot, because
 * nothing breaks the day it stops being true.
 *
 * These read the shipped source, the same sources `tools/architecture.mjs`
 * probes. A refusal that only holds in the module that documents it is not a
 * refusal — the whole point is that it holds everywhere.
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test, describe, assert, setSuite } from './harness.mjs';
import { REGIMES, STATUS } from '../js/domain/compliance.js';

setSuite('refusals');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Everything that ships to a browser, plus the backend. */
async function shipped() {
  const out = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (/\.(js|gs)$/.test(entry.name)) out.push([full, await readFile(full, 'utf8')]);
    }
  };
  await walk(join(ROOT, 'js'));
  await walk(join(ROOT, 'apps-script'));
  return out;
}

/** Source with comments and doc blocks removed — a refusal is about code. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const control = (regimeId, controlId) => REGIMES
  .find((r) => r.id === regimeId)?.controls
  .find((c) => c.id === controlId);

describe('UIDAI — no Aadhaar authentication or e-KYC is performed', () => {
  test('nothing calls an authentication or e-KYC endpoint', async () => {
    // The words themselves are everywhere and should be: `identityDocument`
    // carries an Aadhaar number and `kycRecord` models what an institution
    // holds. What must not exist is a *call*: a UIDAI host, an auth or e-KYC
    // API, an OTP-to-Aadhaar flow, a demographic or biometric verify.
    const forbidden = [
      /uidai(?!\s|\.gov\.in\/?["']?\s*(?:is|are|does|has))[\w.]*\.(?:gov\.in|in)\b/i,
      /\b(?:auth|ekyc|e-kyc)[\w-]*\.uidai\b/i,
      /resident\.uidai/i,
      /\bAadhaar\s*(?:Auth|Authentication)Api\b/i,
      /\bdemoAuth\b|\bbioAuth\b|\botpAuth\b/i,
      /\baadhaar[\w]*\s*(?:authenticate|verify)\s*\(/i,
    ];
    const hits = [];
    for (const [path, text] of await shipped()) {
      const code = codeOnly(text);
      for (const pattern of forbidden) {
        if (pattern.test(code)) hits.push(`${path.replace(`${ROOT}/`, '')} matches ${pattern}`);
      }
    }
    assert.deep(hits, []);
  });

  test('and no request is ever addressed to UIDAI', async () => {
    // Narrower and stronger than the words: a fetch, an XHR or a URL literal
    // pointed at the authority. This is the shape an integration would have
    // to take, whatever it called its variables.
    const hits = [];
    for (const [path, text] of await shipped()) {
      const code = codeOnly(text);
      for (const [, url] of code.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)) {
        if (/uidai|aadhaar/i.test(url)) hits.push(`${path.replace(`${ROOT}/`, '')} → ${url}`);
      }
    }
    assert.deep(hits, []);
  });

  test('the control says so, and cites a file that exists', async () => {
    const row = control('UIDAI', 'no-authentication');
    assert.equal(row.requirement, 'No Aadhaar authentication or e-KYC performed');
    const cited = await readFile(join(ROOT, row.evidence.file), 'utf8').catch(() => null);
    assert.ok(cited, `${row.evidence.file} is cited and missing`);
  });
});

describe('PROPERTY — no generated document claims legal effect', () => {
  /** What a document must never tell somebody about itself. */
  const CLAIMS = [
    /legally\s+(?:binding|valid|enforceable)/i,
    /has\s+legal\s+(?:effect|force|standing)/i,
    /\bis\s+a\s+legal\s+document\b/i,
    /constitutes\s+a\s+(?:contract|deed|agreement)/i,
    /\bnotaris|notarised\s+by\s+this\b/i,
    /admissible\s+in\s+(?:court|evidence)/i,
  ];

  test('nothing the report builders emit claims legal effect', async () => {
    const hits = [];
    for (const [path, text] of await shipped()) {
      if (!/\/js\/reports\/|\/js\/domain\/(?:docx|estate|legal)/.test(path)) continue;
      const code = codeOnly(text);
      for (const pattern of CLAIMS) {
        if (pattern.test(code)) hits.push(`${path.replace(`${ROOT}/`, '')} matches ${pattern}`);
      }
    }
    assert.deep(hits, []);
  });

  test('and nothing anywhere in what ships does either', async () => {
    // Widened deliberately. A claim of legal effect made on a *screen* about
    // a document is the same claim; confining the check to the generator
    // would let the sentence move one file to the left and survive.
    const hits = [];
    for (const [path, text] of await shipped()) {
      const code = codeOnly(text);
      for (const pattern of CLAIMS) {
        if (pattern.test(code)) hits.push(`${path.replace(`${ROOT}/`, '')} matches ${pattern}`);
      }
    }
    assert.deep(hits, []);
  });

  test('the document that records the decision still says it', async () => {
    const row = control('PROPERTY', 'no-legal-effect-claim');
    const doc = await readFile(join(ROOT, row.evidence.doc), 'utf8');
    assert.ok(/not a record|no legal effect|does not sign|the original does/i.test(doc),
      `${row.evidence.doc} no longer states the refusal it is cited for`);
  });
});

describe('what these two controls may now say about themselves', () => {
  test('both are TESTED, and cite this suite', () => {
    for (const [regime, id] of [['UIDAI', 'no-authentication'],
      ['PROPERTY', 'no-legal-effect-claim']]) {
      const row = control(regime, id);
      assert.equal(row.status, STATUS.TESTED, `${regime}/${id}`);
      assert.equal(row.evidence.test, 'tests/refusals.test.mjs', `${regime}/${id}`);
    }
  });

  test('and neither has become VERIFIED on the strength of a test', () => {
    // A test is evidence that the code does what it says. Verification is a
    // person qualified to judge signing their name, and running a suite is
    // not that. `claimingVerified` stays empty and this is one more place
    // saying why.
    for (const [regime, id] of [['UIDAI', 'no-authentication'],
      ['PROPERTY', 'no-legal-effect-claim']]) {
      assert.equal(control(regime, id).status === STATUS.VERIFIED, false);
    }
  });
});
