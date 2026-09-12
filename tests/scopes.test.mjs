import { test, describe, assert, setSuite } from './harness.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCOPES, BASE_SCOPES, UNLOCK_SCOPES, MAIL_SCOPES, IDENTITY_SCOPES,
  APPDATA_SCOPE, GMAIL_SCOPE, consentScreen, backendScopes,
} from '../js/core/scopes.js';
import { config } from '../js/core/config.js';
import { t } from '../js/core/locale.js';
import { scopeGap } from '../js/modules/settings/connection.js';

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
      // Through `t()`, because a routed entry holds a key and the sentence
      // somebody reads is what this is about. An unrouted one comes back
      // unchanged, so both kinds are measured the same way.
      assert.ok(t(scope.title)?.length > 3, `${scope.id} has no title`);
      assert.ok(t(scope.why)?.length > 20, `${scope.id} does not say what it is for`);
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

  test('an ordinary sign-in asks for no Google API at all', () => {
    // It exists to say who is asking. Every Sheet this application writes is
    // written by the Apps Script backend under the backend's own permission,
    // and documents go the same way — so the browser has no call to make and
    // no business holding a scope for one.
    for (const scope of BASE_SCOPES) {
      assert.not(/drive|spreadsheets|gmail|calendar|contacts/.test(scope),
        `an ordinary sign-in asks for ${scope} and never uses it`);
    }
  });

  test('the browser never asks for spreadsheets, sensitive and unused', () => {
    // It grants access to *every* spreadsheet a person owns, and nothing in
    // js/ calls the Sheets API. Asking for a permission and not using it is
    // the plainest breach of "narrowest scope that does the job".
    const sheets = 'https://www.googleapis.com/auth/spreadsheets';
    assert.not(BASE_SCOPES.includes(sheets));
    assert.not(UNLOCK_SCOPES.includes(sheets));
    assert.not(MAIL_SCOPES.includes(sheets));
    assert.not(consentScreen().required.some((scope) => scope.id === sheets),
      'the consent screen still asks a person to grant spreadsheets to the browser');
  });

  test('Drive is asked for only by the button that needs it', () => {
    const drive = 'https://www.googleapis.com/auth/drive.file';
    assert.not(BASE_SCOPES.includes(drive), 'every sign-in asks for Drive');
    assert.includes(UNLOCK_SCOPES, drive);
  });

  test('the unlock path is the base list plus Drive, and nothing more', () => {
    const extra = UNLOCK_SCOPES.filter((scope) => !BASE_SCOPES.includes(scope));
    assert.deep(extra.sort(), [
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/drive.file',
    ]);
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

/**
 * A permission Google withheld, named where somebody will see it.
 *
 * `GoogleAuth.missingScopes()` had **no caller anywhere in `js/`**. Its header
 * says what it was written for:
 *
 *     Google returns a perfectly good token after somebody unticks a
 *     permission on the consent screen, and after a Cloud project that never
 *     listed a scope drops it. Both then surface as a refusal from whichever
 *     API call needed it — which names the wrong problem, and sends people
 *     looking at their Drive rather than at their consent screen.
 *
 * Nothing asked it, so it named nothing, and the misdiagnosis it exists to
 * prevent went on happening. A diagnostic with no reader is not a diagnostic.
 *
 * `scopeGap` is a function rather than four lines inside the card because the
 * mutation catalogue has refused screen-level entries five times in this work:
 * a decision taken inside a render is a decision no check can reach.
 */
describe('telling somebody which Google permission is missing', () => {
  /** Just enough of `GoogleAuth` for the thing under test. */
  const signedIn = (missing) => ({ isSignedIn: true, missingScopes: () => missing });

  test('says nothing when everything asked for was granted', () => {
    assert.equal(scopeGap(signedIn([])), null);
  });

  test('and says nothing before anybody has signed in', () => {
    // An empty grant claims nothing. Warning about permissions that have not
    // been asked for yet would be a warning nobody can act on.
    assert.equal(scopeGap({ isSignedIn: false, missingScopes: () => ['openid'] }), null);
    assert.equal(scopeGap(null), null);
  });

  test('names the permission by its title, not its URL', () => {
    const drive = SCOPES.find((scope) => scope.id.includes('drive.file'));
    assert.ok(drive, 'the scope catalogue no longer lists drive.file — this check is stale');

    const gap = scopeGap(signedIn([drive.id]));
    assert.ok(gap, 'a withheld permission was not reported at all');
    assert.includes(gap.text, drive.title);
    assert.not(gap.text.includes('googleapis.com'),
      'the message shows a scope URL, which is not a thing anybody can act on');
  });

  test('and says what stops working, in the catalogue’s own words', () => {
    // `without` is already written per scope in `js/core/scopes.js`. A second
    // phrasing here would be a second thing to keep true.
    const drive = SCOPES.find((scope) => scope.id.includes('drive.file'));
    assert.includes(scopeGap(signedIn([drive.id])).text, drive.without);
  });

  test('and where to fix it, which is not where the failure appears', () => {
    /*
     * The whole point of the diagnostic. Without this the first sign is a
     * refusal from Drive or Sheets, and the answer is on a consent screen in
     * a different console.
     */
    const drive = SCOPES.find((scope) => scope.id.includes('drive.file'));
    assert.includes(scopeGap(signedIn([drive.id])).text, 'consent screen');
  });

  test('a scope this build does not describe is still named', () => {
    // Saying "one permission is missing" without saying which would be the
    // same failure one level up.
    const gap = scopeGap(signedIn(['https://www.googleapis.com/auth/something.new']));
    assert.ok(gap);
    assert.includes(gap.text, 'something.new');
  });

  test('two missing permissions are counted, not listed as one', () => {
    const two = SCOPES.slice(0, 2).map((scope) => scope.id);
    const gap = scopeGap(signedIn(two));
    assert.equal(gap.ids.length, 2);
    assert.includes(gap.text, '2');
    for (const id of two) {
      assert.includes(gap.text, SCOPES.find((scope) => scope.id === id).title);
    }
  });
});
