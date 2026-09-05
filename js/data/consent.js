/**
 * What a household actually agreed to — recorded, never inferred.
 *
 * ## The distinction this file exists to hold
 *
 * There are three different things that all get called "consent", and treating
 * them as one is how an application ends up sincerely believing it has
 * permission it was never given:
 *
 *   1. **A capability being available.** A client id is configured, so signing
 *      in is possible. Nobody agreed to anything.
 *   2. **A grant at Google.** Somebody pressed Allow on Google's consent
 *      screen. That is Google's record, about Google's scopes, and this
 *      application can read what came back — but it says what Google may do,
 *      not what this application was asked to do with it.
 *   3. **A decision recorded here.** A person was told what would happen, to
 *      which data, involving whom, and said yes.
 *
 * Only the third is consent. The first two are evidence at most.
 *
 * ## `unrecorded` is not a kind of yes
 *
 * The state of a purpose nobody was ever asked about is `UNRECORDED`, and
 * `hasConsent()` returns **false** for it. This matters more than it sounds:
 * an application that already works has a strong pull toward treating existing
 * configuration as agreement, because that is the reading under which nothing
 * has to change. It is also the reading that manufactures a consent record for
 * a conversation that never happened.
 *
 * ## What this does not do, said plainly
 *
 * **It gates almost nothing, and the exception is marked.** For every purpose
 * but one, an unrecorded decision stops nothing: a household already syncing
 * has no record — because there was nothing to record with — and a gate would
 * silently stop their backups on upgrade, which is a data-loss bug wearing a
 * privacy costume. What it does instead is make the gap *visible* and
 * countable, so the screen that asks can be built against something true.
 *
 * `screenTime` is the exception and carries `withoutStops: true`. That
 * argument does not hold for it: screen time is not a record the household
 * already has, it is a reading this application would go and take about a
 * person from a device that hands it over without them noticing. There is
 * nothing to lose by refusing. `js/services/screentime.js` enforces it, and
 * makes no native call at all when the answer is no — a reading taken and
 * then discarded is still a reading that happened.
 *
 * **It is per device.** Consent records live in the local meta store, which
 * does not sync. A second device has its own history and starts with none. That
 * is defensible — a person consents on a device, in front of a screen — but it
 * means "the household's consent history" is not a thing this can show.
 *
 * **It is not a compliance artefact.** No regulation has been assessed. This is
 * a factual record of decisions and a factual list of who touches what.
 */

import { newId } from '../core/ids.js';
import { SCOPES } from '../core/scopes.js';
import { t } from '../core/locale.js';

/** Where the log lives. One key, one array, appended to. */
export const CONSENT_KEY = 'consent.records';

export const DECISIONS = Object.freeze({
  GRANTED: 'granted',
  DENIED: 'denied',
  WITHDRAWN: 'withdrawn',
  /** Never asked. Not a yes, and not a no. */
  UNRECORDED: 'unrecorded',
});

/**
 * Who else touches a household's records, and in what capacity.
 *
 * The capacities are not decoration. "Google" appears once as a name and three
 * times as a relationship, and the differences are the whole point: the account
 * is the household's own, the deployment runs as them rather than as anybody
 * else, and the host serves bytes without ever seeing a record.
 */
export const PROCESSORS = Object.freeze({
  googleAccount: {
    name: 'Your Google account',
    // Not a third party this application handed data to. The household signs
    // in as themselves and the data lands in storage they own and can revoke.
    // Whoever wrote this application cannot read any of it.
    relationship: 'your own storage',
    sees: 'whatever the purpose sends — see each purpose below',
    revoke: 'Remove access at myaccount.google.com, and delete the files.',
  },
  appsScript: {
    name: 'Your Apps Script deployment',
    // Google's servers execute it, under the household's own authorisation,
    // from source they deployed. Not a service operated by anyone else.
    relationship: 'your own code, running as you',
    sees: 'every record it is sent, in order to write it to your sheet',
    revoke: 'Delete the deployment. Sync stops; nothing local is affected.',
  },
  host: {
    name: 'Whoever serves the page',
    // The honest one that usually goes unmentioned. A static host sees that
    // somebody fetched the application, from what address, and when. It never
    // sees a record, because no record is ever sent to it.
    relationship: 'delivers the code, never the data',
    sees: 'that this page was requested, from what address and when. No records.',
    revoke: 'Use the one-file build offline, or self-host.',
  },
});

/**
 * Everything this application can do that involves data leaving the device, and
 * the one thing people assume does and does not.
 *
 * `moment` is the honest field. It names where in the application a person is
 * actually asked — and where it says `null`, nobody is, which is a finding
 * rather than a gap in this table.
 */
export const PURPOSES = Object.freeze({
  /* ------------------------------------------- people who are not the household */

  /**
   * The six purposes below this pair are all the same shape: the household's
   * own data, going to Google, agreed to by the household. These two are a
   * different thing and are first so nobody has to scroll to find them.
   *
   * A member of staff and a child are **other people**. The household holds
   * records about them, and the person the records are about is not the person
   * who decided to keep them. Nothing here leaves the device, so there is no
   * processor — but that emphatically does not make agreement unnecessary, and
   * `hasConsent` treats these differently from the other local-only purposes
   * for exactly that reason.
   */
  staffRecords: {
    title: 'Keep employment records about someone who works for you',
    // Worded to avoid the bare word "agreements": `tools/field-coverage.mjs`
    // matches field names anywhere in the source including string literals —
    // correctly, since `row['agreements']` is a real read — so prose using the
    // plural marked `tenant.agreements` as read when nothing reads it. Second
    // time prose has silenced that ratchet; the answer is to reword, not to
    // loosen the check.
    what: 'Their name and contact details, what they are paid and when, leave '
      + 'taken, and any contract or documents you file against them.',
    processors: [],
    scopes: [],
    localOnly: true,
    aboutAPerson: true,
    moment: 'When you add them, or any time afterwards from their record.',
    without: 'You keep the records anyway. This only says whether they were '
      + 'told and agreed.',
  },

  childRecords: {
    title: 'Keep records about a child in your household',
    what: 'Everything filed against them — health, school, documents, '
      + 'photographs, where they were.',
    processors: [],
    scopes: [],
    localOnly: true,
    aboutAPerson: true,
    // Recorded by an adult, on the child's behalf. That is what a guardian
    // does, and the record says who did it rather than implying the child did.
    moment: 'When an adult records it on their behalf, from the child’s record.',
    without: 'You keep the records anyway. This only says an adult decided, '
      + 'and when.',
  },

  /**
   * Screen time is the sharpest thing in this list.
   *
   * Wages and school records are things a household writes down about
   * somebody. This is a household *watching* somebody — what applications
   * they opened and for how long, collected by the phone whether or not they
   * thought about it. It is the one purpose here where the answer "no" has to
   * actually stop something, and it does: `js/services/screentime.js` refuses
   * to read at all without a recorded decision, rather than reading and
   * noting that nobody agreed.
   *
   * `withoutStops` marks that difference. Every other local purpose keeps the
   * records either way and only records whether anybody was asked, which is
   * honest for data a household already holds. It would not be honest here.
   */
  // The only purpose whose words route through the catalogue. The rest are
  // written here and counted as unroutable by `tools/strings.mjs`; this one
  // arrived after that ratchet existed, and a new purpose that raised the
  // count would have been the application growing English no translator can
  // reach. The others are a separate, larger job.
  screenTime: {
    title: 'consent.screenTime.title',
    what: 'consent.screenTime.what',
    processors: [],
    scopes: [],
    localOnly: true,
    aboutAPerson: true,
    withoutStops: true,
    moment: 'consent.screenTime.moment',
    without: 'consent.screenTime.without',
  },

  identity: {
    title: 'Prove which Google account you are',
    what: 'Your email address, and your name if you allowed it.',
    processors: ['googleAccount'],
    scopes: ['openid', 'email', 'profile'],
    moment: 'Google’s own consent screen, when you sign in.',
    without: 'Nothing can sync — the backend cannot tell who is calling.',
  },

  backup: {
    title: 'Keep a copy of every record in your spreadsheet',
    what: 'Every record in the application. Sealed fields stay ciphertext in '
      + 'the cell; everything else is readable, which is what makes the backup '
      + 'useful if you stop using this application.',
    processors: ['googleAccount', 'appsScript'],
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    // The finding of this tranche. The single most consequential thing the
    // application does with a household's data has no point at which anybody
    // is asked; it follows from a deployment being configured.
    moment: null,
    without: 'No backup. Records exist only on this device.',
  },

  documents: {
    title: 'Store your uploaded files in your Drive',
    what: 'The files themselves, encrypted on this device before they go up.',
    processors: ['googleAccount', 'appsScript'],
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    moment: null,
    without: 'Documents stay on this device and are lost with it.',
  },

  mail: {
    title: 'Read a mailbox for receipts',
    what: 'Message subjects and bodies are read to extract merchant, amount and '
      + 'date. Only the extracted fields are kept — no message bodies.',
    processors: ['googleAccount'],
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    moment: 'Add a Gmail account, in Shops.',
    // One grant per mailbox. Agreeing that one address may be read is not
    // agreeing about another, and collapsing the two would be the exact
    // failure this field exists to prevent.
    perSubject: true,
    without: 'Receipts are entered by hand.',
  },

  escrow: {
    title: 'Keep the key that unlocks everything in your Drive',
    what: 'The unlock key. Anyone who can sign in as you can use it to open '
      + 'every record.',
    processors: ['googleAccount'],
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.appdata',
    ],
    moment: 'Continue with Google, on the lock screen or in Settings.',
    consequential: true,
    without: 'You unlock with a PIN, a fingerprint, or the recovery phrase.',
  },

  assistant: {
    title: 'Answer questions about your records',
    what: 'Nothing leaves the device. Questions are matched against a local '
      + 'intent registry and answered from records already here.',
    // Deliberately empty, and deliberately present. A future change that sent a
    // question to a hosted model would have to edit this line, which is harder
    // to do without noticing than adding a fetch somewhere.
    processors: [],
    scopes: [],
    moment: null,
    localOnly: true,
    without: 'n/a — there is nothing to turn off.',
  },
});

/** Purposes that send data somewhere. The rest need no agreement. */
export function egressing() {
  return Object.keys(PURPOSES).filter((name) => !PURPOSES[name].localOnly);
}

/* ------------------------------------------------------------------ writing */

/**
 * Append a decision. Never rewrites, never removes.
 *
 * A withdrawal does not delete the grant that preceded it: "this was agreed on
 * the 4th and withdrawn on the 9th" is the answer somebody needs, and it is
 * unavailable from a log that keeps only the current state.
 *
 * @param {object} db
 * @param {{purpose: string, decision: string, subject?: string,
 *          grantedScopes?: string[], deviceId?: string, at?: string}} input
 */
export async function record(db, input) {
  const purpose = PURPOSES[input.purpose];
  if (!purpose) throw new Error(`unknown consent purpose: ${input.purpose}`);
  if (!Object.values(DECISIONS).includes(input.decision)
      || input.decision === DECISIONS.UNRECORDED) {
    // `UNRECORDED` is the absence of a record. Writing one saying "unrecorded"
    // would be a record, which is the opposite of what it means.
    throw new Error(`cannot record the decision: ${input.decision}`);
  }
  // `aboutAPerson` implies per-subject rather than requiring both flags to be
  // set. Two flags that must agree is a pair somebody eventually sets one half
  // of — and the half they would forget is this one, which is the guard that
  // stops a consent record naming nobody.
  if ((purpose.perSubject || purpose.aboutAPerson) && !input.subject) {
    throw new Error(`${input.purpose} is per-subject and needs one`);
  }

  const entry = {
    id: newId('cns'),
    purpose: input.purpose,
    decision: input.decision,
    subject: input.subject ?? '',
    at: input.at ?? new Date().toISOString(),
    deviceId: input.deviceId ?? '',
    // What Google actually granted at that moment, if this decision involved a
    // sign-in. Evidence of what was possible, kept beside the decision rather
    // than mistaken for it.
    grantedScopes: [...(input.grantedScopes ?? [])],
  };

  const log = await history(db);
  await db.setMeta(CONSENT_KEY, [...log, entry]);
  return entry;
}

/** Shorthand for the two common cases. */
export const grant = (db, purpose, extra = {}) =>
  record(db, { ...extra, purpose, decision: DECISIONS.GRANTED });

export const withdraw = (db, purpose, extra = {}) =>
  record(db, { ...extra, purpose, decision: DECISIONS.WITHDRAWN });

/* ------------------------------------------------------------------ reading */

/** Every decision ever recorded on this device, oldest first. */
export async function history(db, { purpose, subject } = {}) {
  const log = (await db.meta(CONSENT_KEY, [])) ?? [];
  return log
    .filter((e) => (purpose ? e.purpose === purpose : true))
    .filter((e) => (subject === undefined ? true : (e.subject ?? '') === subject))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * Where a purpose stands now.
 *
 * The **latest** decision wins, by time — not the first grant found, and not
 * the last entry in the array. A grant after a withdrawal is a real thing that
 * happens: somebody turns a mailbox off and later turns it back on.
 */
export async function stateOf(db, purpose, subject = '') {
  const relevant = await history(db, { purpose, subject });
  const last = relevant.at(-1);
  if (!last) return { decision: DECISIONS.UNRECORDED, at: null, entry: null };
  return { decision: last.decision, at: last.at, entry: last };
}

/**
 * Did somebody actually say yes, and is it still yes?
 *
 * The only function that should decide anything. `UNRECORDED` is false here,
 * which is the whole point of it being a separate state.
 */
export async function hasConsent(db, purpose, subject = '') {
  const def = PURPOSES[purpose];

  // A local-only purpose is true without a record because nothing leaves the
  // device: there is no third party for anybody to have agreed with.
  //
  // That reasoning fails completely when the third party is a *person* — a
  // member of staff, a child. Nothing leaves the device and there is still
  // somebody whose records these are, who either was told or was not. Reading
  // "granted" off an empty log there would manufacture a consent record for a
  // conversation that never happened, which is the exact failure the top of
  // this file exists to name.
  if (def?.localOnly && !def?.aboutAPerson) return true;

  return (await stateOf(db, purpose, subject)).decision === DECISIONS.GRANTED;
}

/**
 * Has somebody explicitly said no?
 *
 * This is the one that gates, and it is deliberately **not** `!hasConsent`.
 *
 * An absent record must not stop anything. A household already syncing has no
 * record — because until this module existed there was nothing to record with
 * — and refusing to sync them on upgrade would be a data-loss bug wearing a
 * privacy costume: their backup would quietly stop, and the first they would
 * know of it is when they needed it.
 *
 * A withdrawal or a denial is different in kind. Somebody sat in front of a
 * screen and said no. That is honoured immediately, everywhere, and it is the
 * only thing here that changes what the application does.
 */
export async function refused(db, purpose, subject = '') {
  const { decision } = await stateOf(db, purpose, subject);
  return decision === DECISIONS.WITHDRAWN || decision === DECISIONS.DENIED;
}

/** The processors a purpose involves, resolved. */
export function processorsFor(purpose) {
  return (PURPOSES[purpose]?.processors ?? []).map((key) => ({ key, ...PROCESSORS[key] }));
}

/**
 * The people whose records are somebody else's to consent to.
 *
 * Staff, because a member of household staff is unambiguously another person
 * and the records are unambiguously about them. Children, because the decision
 * is an adult's to make on their behalf — a different thing from the child
 * having agreed, and recorded as such.
 *
 * Derived, never a list somebody maintains. Adding a staff record adds the
 * person here; the day this becomes a stored flag is the day it starts
 * disagreeing with the records it describes.
 *
 * Here rather than on the Settings screen because the screen reading two
 * entities itself took the UI→database count past its budget — and this is a
 * question about who consent is owed to, which is this module's subject.
 */
export async function peopleWithRecordsAbout(db) {
  const [staff, people] = await Promise.all([
    db.repo('staff').list({ limit: 200, decrypt: false }).catch(() => []),
    db.repo('person').list({ limit: 200, decrypt: false }).catch(() => []),
  ]);

  const ids = new Set(staff.map((row) => row.person).filter(Boolean));
  for (const person of people) {
    if (person.role === 'child') ids.add(person.id);
  }
  return [...ids];
}

/* ------------------------------------------------------------------- report */

/**
 * Every purpose, what it is doing, and whether anybody agreed to it.
 *
 * `active` comes from the caller because this module cannot see configuration
 * without importing half the application; the shape is the state Settings
 * already has to hand.
 *
 * @param {{localOnly?: boolean, configured?: boolean, escrowed?: boolean,
 *          mailboxes?: string[], people?: string[]}} state
 */
export async function report(db, state = {}) {
  const rows = [];

  for (const name of Object.keys(PURPOSES)) {
    const purpose = PURPOSES[name];
    // Mailboxes for `mail`, people for the two that are about a person, and a
    // single blank subject for everything else. Reading a person purpose off
    // `mailboxes` would have reported every staff consent as belonging to a
    // Gmail account.
    const subjects = purpose.aboutAPerson ? (state.people ?? [])
      : purpose.perSubject ? (state.mailboxes ?? [])
        : [''];

    for (const subject of subjects) {
      const { decision, at } = await stateOf(db, name, subject);
      rows.push({
        purpose: name,
        subject,
        // `t(...)` at the point of use. These were translated when this module
        // was imported, which froze them in whatever language was active then;
        // an unknown key comes back unchanged, so the purposes still written in
        // English pass through untouched.
        title: t(purpose.title),
        active: isActive(name, state, subject),
        decision,
        at,
        consequential: Boolean(purpose.consequential),
        processors: processorsFor(name),
        // Nobody is asked anywhere in the application. Distinct from "asked and
        // declined", and from "asked and not yet answered".
        neverAsked: purpose.moment === null && !purpose.localOnly,
      });
    }
  }

  // Local-only purposes are excluded because nothing leaves the device, so
  // there is nobody who could have been asked. That reasoning does not reach
  // the two purposes about a person: they are local *and* there is somebody
  // whose records these are. Excluding them would have made the one gap this
  // pair exists to surface permanently invisible.
  const gaps = rows.filter((row) => row.active && row.decision !== DECISIONS.GRANTED
    && !(PURPOSES[row.purpose].localOnly && !PURPOSES[row.purpose].aboutAPerson));

  return {
    purposes: rows,
    /** Happening right now, with nobody's recorded agreement. The finding. */
    gaps,
    processors: Object.entries(PROCESSORS).map(([key, p]) => ({ key, ...p })),
  };
}

/** Whether a purpose is actually happening, given how this copy is set up. */
function isActive(name, state, subject = '') {
  if (state.localOnly) return name === 'assistant';
  switch (name) {
    case 'assistant': return true;
    case 'identity': return Boolean(state.configured);
    case 'backup':
    case 'documents': return Boolean(state.configured);
    case 'escrow': return Boolean(state.escrowed);
    case 'mail': return (state.mailboxes ?? []).includes(subject);
    // Active means "the household is holding records about this person right
    // now". `people` is who the caller passed, which is who those records
    // exist for — so an active row with no recorded decision is precisely the
    // gap, and that is what the compliance control asks about.
    case 'staffRecords':
    case 'childRecords': return (state.people ?? []).includes(subject);
    default: return false;
  }
}

/* -------------------------------------------------------------- consistency */

/**
 * Every scope a purpose names must exist in the scope registry.
 *
 * The same anti-drift check `scopes.js` applies to its own four lists, for the
 * same reason: two tables describing one set of permissions will disagree, and
 * the disagreement will be discovered by a person reading a screen that is
 * wrong rather than by a test.
 */
export function assertSound() {
  const known = new Set(SCOPES.map((s) => s.id));
  const problems = [];

  for (const [name, purpose] of Object.entries(PURPOSES)) {
    for (const scope of purpose.scopes) {
      if (!known.has(scope)) problems.push(`${name} names an unknown scope: ${scope}`);
    }
    for (const key of purpose.processors) {
      if (!PROCESSORS[key]) problems.push(`${name} names an unknown processor: ${key}`);
    }
    if (purpose.localOnly && purpose.processors.length) {
      problems.push(`${name} claims to be local-only but names a processor`);
    }
    if (!purpose.localOnly && !purpose.processors.length) {
      problems.push(`${name} sends data somewhere but names no processor`);
    }
  }

  return problems;
}
