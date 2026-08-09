import { test, describe, assert, setSuite } from './harness.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCOPES, BASE_SCOPES, MAIL_SCOPES, IDENTITY_SCOPES,
  APPDATA_SCOPE, GMAIL_SCOPE, consentScreen, backendScopes,
} from '../js/core/scopes.js';
import { config } from '../js/core/config.js';

setSuite('scopes');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A registry nothing checks is another thing to drift.
 *
 * The scopes lived in four files and were described in a fifth, in prose. By
 * the time anyone asked "so which do I add?", the setup document was saying
 * the browser never talks to Gmail — which stopped being true the moment a
 * mailbox could be attached by signing in. These checks are what stop that
 * happening again.
 */

describe('the registry describes every scope', () => {
  test('each one says what it is for and what is lost without it', () => {
    for (const scope of SCOPES) {
      assert.ok(scope.id.length, 'a scope with no id');
      assert.ok(scope.title?.length > 3, `${scope.id} has no title`);
      assert.ok(scope.why?.length > 20, `${scope.id} does not say what it is for`);
      assert.ok(scope.without?.length > 15, `${scope.id} does not say what is lost`);
      assert.includes(['browser', 'backend'], scope.where, `${scope.id} belongs nowhere`);
    }
  });

  test('every scope is a real Google scope or a standard OpenID one', () => {
    for (const scope of SCOPES) {
      assert.ok(
        ['openid', 'email', 'profile'].includes(scope.id)
          || scope.id.startsWith('https://www.googleapis.com/auth/'),
        `${scope.id} is not a scope Google would recognise`,
      );
    }
  });

  test('the two consent surfaces are kept apart', () => {
    // Conflating them is why somebody adds a scope in the Cloud Console and
    // nothing changes: the backend authorises itself from its own manifest.
    assert.ok(consentScreen().required.length);
    assert.ok(backendScopes().length);
    assert.not(consentScreen().required.some((scope) => scope.where === 'backend'));
  });

  test('what is optional is genuinely optional', () => {
    // If losing a scope broke the application, calling it optional on a setup
    // page would be the most expensive kind of wrong.
    for (const scope of consentScreen().optional) {
      assert.not(/cannot sync|no backup at all|refused/i.test(scope.without),
        `${scope.id} is described as optional but breaks something`);
    }
  });
});

/* ------------------------------------------------------- against the code */

describe('the registry matches what the code actually asks for', () => {
  test('an ordinary sign-in asks for the base list and nothing else', () => {
    assert.deep([...config().scopes], [...BASE_SCOPES]);
  });

  test('the base list is exactly the required browser scopes, plus the name', () => {
    const required = consentScreen().required.map((scope) => scope.id);
    for (const scope of required) assert.includes(BASE_SCOPES, scope, `${scope} is not requested`);
    assert.includes(BASE_SCOPES, 'profile');
  });

  test('a mailbox sign-in asks for identity and mail, never Drive or Sheets', () => {
    // The whole argument for attaching a mailbox by signing in: that consent
    // covers reading mail and proving who is asking, and nothing else.
    assert.deep([...MAIL_SCOPES], [...IDENTITY_SCOPES, GMAIL_SCOPE]);
    assert.not(MAIL_SCOPES.some((scope) => /drive|spreadsheets/.test(scope)),
      MAIL_SCOPES.join(' '));
  });

  test('the app-folder scope is optional, since the app works without it', () => {
    const entry = SCOPES.find((scope) => scope.id === APPDATA_SCOPE && scope.where === 'browser');
    assert.not(entry.required);
    assert.not(BASE_SCOPES.includes(APPDATA_SCOPE),
      'an ordinary sign-in must not ask for a scope most consent screens lack');
  });

  test('the Gmail scope is never in an ordinary sign-in', () => {
    // Somebody who never opens Shops should never be asked for their mail.
    assert.not(BASE_SCOPES.includes(GMAIL_SCOPE));
  });
});

/* ---------------------------------------------------- against the backend */

describe('the registry matches the deployed manifest', () => {
  test('appsscript.json asks for exactly what the registry says it does', async () => {
    // The manifest is what Google actually authorises. If these two disagree,
    // one of them is lying to whoever is reading it.
    const manifest = JSON.parse(await readFile(join(ROOT, 'apps-script', 'appsscript.json'), 'utf8'));
    const declared = backendScopes().map((scope) => scope.id).sort();

    assert.deep([...manifest.oauthScopes].sort(), declared);
  });

  test('the backend reads mail and the browser can too, which the docs must not deny', async () => {
    // The exact sentence that went stale: "the browser never talks to Gmail".
    // It does, for a mailbox attached by signing in — so the registry lists
    // the scope under both surfaces, and the setup page may not say otherwise.
    const browserGmail = SCOPES.find((s) => s.id === GMAIL_SCOPE && s.where === 'browser');
    const backendGmail = SCOPES.find((s) => s.id === GMAIL_SCOPE && s.where === 'backend');
    assert.ok(browserGmail, 'the browser Gmail scope is undeclared');
    assert.ok(backendGmail, 'the backend Gmail scope is undeclared');

    // Whitespace-tolerant, because the first version of this check was a
    // false pass: the sentence was still in the file, wrapped across a line
    // break, and a single-line pattern sailed straight past it.
    const setup = await readFile(join(ROOT, 'docs', 'SETUP.md'), 'utf8');
    assert.not(/browser\s+never\s+talks\s+to\s+Gmail/i.test(setup),
      'SETUP.md still claims the browser never reads mail');
  });
});
