/**
 * What the household's paperwork and phones recorded.
 *
 * The fourth example module. `example.js` is who they are, `example-life.js` is
 * what has happened to them, `example-assets.js` is the balance sheet, and this
 * is the residue of ordinary life: the cook and the driver, the receipts in a
 * drawer, the statement periods, the bank alerts, where people said they were.
 *
 * ## Why these were left out before, and what changed
 *
 * `0724114` seeded 42 of 53 entity kinds and named the eleven it would not
 * invent: import artefacts, derived rows, and anything that "comes from a
 * device". That reasoning was right about the risk and too broad about the
 * remedy, because the schema already distinguishes the record from its
 * provenance:
 *
 *   - `receipt` has `mailbox` and `messageId`. **They are left empty here.** A
 *     receipt kept in a drawer is an ordinary record; a receipt claiming to
 *     have been pulled out of a Gmail account is the fake fetch. The fields
 *     that would make that claim are the fields not filled in.
 *   - `locationPing.source` offers `manual`, and every ping here is manual —
 *     a position somebody recorded, not a trace a device left behind.
 *   - `bankStatement` carries `fileName`, and it is empty for the same reason:
 *     these say a period was reconciled, not that a file was fetched.
 *   - `smsMessage.source` has no honest option — `imported` and `native` both
 *     assert an origin — so these say `imported`, which is what a household
 *     pasting their own alerts in would produce, and the `notes` say what they
 *     are like every other row here.
 *
 * ## What is still not invented
 *
 * `deviceKey`, `conversation` and `message` are end-to-end encrypted, and
 * fabricating key material would make the security model look like something
 * it is not — a demonstration of E2EE built from keys nobody holds. They stay
 * empty, and the chat screen stays honest about having nothing in it.
 *
 * `economicEvent` is derived and is **still not written here.** The two legs of
 * one transfer are seeded as ordinary transactions instead, and the
 * application's own matcher pairs them. What the Movements tab shows is
 * therefore something the app worked out, which is the only way a derived row
 * can honestly appear in a demonstration.
 */

import { exampleStrings } from '../locale/en-example.js';
import { today, addDays, addMonths, startOfMonth, endOfMonth } from '../core/dates.js';
import { option } from './example.js';

const text = (key) => {
  const found = exampleStrings[key];
  if (found === undefined) throw new Error(`no-such-example-string:${key}`);
  return found;
};

const note = () => text('example.note');
const back = (clock, days) => addDays(today(clock), -days);

/**
 * A day plus a time of day, as an instant.
 *
 * Built by arithmetic rather than by pasting `T18:24:00.000Z` into a template,
 * because `tools/strings.mjs` counts a literal like that as unrouted English
 * and it would be one more number in a ratchet that only goes down.
 */
const at = (day, hours, minutes) => new Date(
  Date.parse(day) + (hours * 60 + minutes) * 60_000,
).toISOString();

/**
 * The two people the household employs, and the leave they have taken.
 *
 * The earlier objection to seeding `staff` was that it "needs a person, which
 * would make a family of six into seven". It makes it six and two, which is
 * what a household with a cook and a driver actually is — and Phase 13 exists
 * for exactly this: a `staff` role that sees only the record about them. A
 * demonstration with nobody employed cannot show it.
 *
 * They carry no identity documents, no accounts and no health records. An
 * employer holding a driver's Aadhaar and medical history is a thing this
 * application should not model casually, and leaving those empty is the
 * difference between employing somebody and owning their file.
 */
export function household(clock = Date.now) {
  const people = [
    { key: 'sunita', name: text('example.staff.cook.name'), relationshipToOwner: 'other' },
    { key: 'ravi', name: text('example.staff.driver.name'), relationshipToOwner: 'other' },
  ].map((row) => ({ ...row, notes: note() }));

  const staff = [
    {
      key: 'staff-cook',
      person: 'sunita',
      role: text('example.staff.cook.role'),
      startedOn: addMonths(today(clock), -26),
      monthlyPay: 9_000_00,
      paidEvery: 'month',
      notes: note(),
    },
    {
      key: 'staff-driver',
      person: 'ravi',
      role: text('example.staff.driver.role'),
      startedOn: addMonths(today(clock), -14),
      monthlyPay: 18_500_00,
      paidEvery: 'month',
      notes: note(),
    },
  ];

  // Two kinds on purpose: `staffLeave` distinguishes leave taken from absence,
  // and a screen that has only ever seen one of them cannot show the
  // difference.
  const leave = [
    {
      key: 'leave-0',
      staff: 'staff-cook',
      from: back(clock, 54),
      to: back(clock, 48),
      kind: 'leave',
      paid: true,
      notes: note(),
    },
    {
      key: 'leave-1',
      staff: 'staff-cook',
      from: back(clock, 12),
      to: back(clock, 12),
      kind: 'sick',
      paid: true,
      notes: note(),
    },
    {
      key: 'leave-2',
      staff: 'staff-driver',
      from: back(clock, 31),
      to: back(clock, 29),
      kind: 'leave',
      paid: true,
      notes: note(),
    },
    {
      key: 'leave-3',
      staff: 'staff-driver',
      from: back(clock, 5),
      to: back(clock, 5),
      kind: 'absent',
      paid: false,
      notes: note(),
    },
  ];

  return { people, staff, leave };
}

/**
 * Receipts, with the fields that would claim a mailbox left empty.
 *
 * `mailbox`, `messageId` and `subject` are what `modules/receipts.js` fills in
 * when it has scanned a Gmail account. Nothing here has been scanned from
 * anywhere, so nothing here sets them — and the receipts screen shows what a
 * household that photographed their bills would have.
 */
export function receipts(clock = Date.now) {
  return [
    ['receipt-0', 3, 'example.receipt.pharmacy', 'healthcare', 1_240_00],
    ['receipt-1', 9, 'example.receipt.groceries', 'groceries', 4_318_00],
    ['receipt-2', 17, 'example.receipt.restaurant', 'restaurant', 2_650_00],
    ['receipt-3', 26, 'example.receipt.electronics', 'e-commerce', 18_990_00],
    ['receipt-4', 41, 'example.receipt.fuel', 'fuel', 3_100_00],
  ].map(([key, days, merchant, category, amount]) => ({
    key,
    date: back(clock, days),
    merchant: text(merchant),
    category,
    amount,
    notes: note(),
  }));
}

/**
 * Two statement periods on the salary account, reconciled.
 *
 * `fileName` is left empty: these record that a period was accounted for, not
 * that a file arrived from a bank. `rowCount` and `importedCount` agree,
 * because a household that reconciled a month has no rows left over.
 */
export function statements(clock = Date.now) {
  return [0, 1].map((n) => {
    const inMonth = addMonths(today(clock), -(n + 2));
    const from = startOfMonth(inMonth);
    const to = endOfMonth(inMonth);
    return {
      key: `statement-${n}`,
      account: 'account-0',
      periodFrom: from,
      periodTo: to,
      rowCount: 34 - n,
      importedCount: 34 - n,
      duplicateCount: 0,
      reconciled: true,
      importedOn: addDays(to, 3),
      notes: note(),
    };
  });
}

/**
 * The bank alerts a household would have on their phone.
 *
 * `source: 'imported'` rather than `native`: the enum has no option meaning
 * "typed in", and `imported` is the weaker of the two claims — `native` would
 * assert this device's own inbox was read.
 *
 * The amounts and the account tail match the seeded salary account and its
 * transactions, so `domain/sms.js` has something real to reconcile rather than a
 * set of alerts about money that never moved.
 */
export function alerts(clock = Date.now) {
  return [
    ['sms-0', 'example.sms.0', 2, 'example.sms.sender.bank', 'debit', 4_318_00, 'out'],
    ['sms-1', 'example.sms.1', 6, 'example.sms.sender.bank', 'credit', 1_85_000_00, 'in'],
    ['sms-2', 'example.sms.2', 11, 'example.sms.sender.bank', 'debit', 2_650_00, 'out'],
    ['sms-3', 'example.sms.3', 19, 'example.sms.sender.card', 'debit', 18_990_00, 'out'],
    ['sms-4', 'example.sms.4', 24, 'example.sms.sender.bank', 'debit', 35_000_00, 'out'],
    ['sms-5', 'example.sms.5', 33, 'example.sms.sender.bank', 'debit', 3_100_00, 'out'],
  ].map(([key, body, days, sender, category, amount, direction]) => ({
    key,
    sender: text(sender),
    receivedAt: back(clock, days),
    text: text(body),
    category,
    amount,
    direction,
    accountTail: '3641',
    source: 'imported',
    transactionDate: back(clock, days),
    notes: note(),
  }));
}

/**
 * Where people said they were, and the one time somebody raised an alarm.
 *
 * Every ping is `source: 'manual'`, which is the honest half of that enum: a
 * position somebody recorded, not a trace a device left. Two of them name a
 * seeded safe zone so `domain/geo.js` has an inside-the-zone case and an
 * outside-it case to tell apart.
 *
 * The alert is **resolved**, and that matters. An unresolved SOS sitting in a
 * demonstration is an emergency nobody is attending to, on a screen whose
 * whole job is to be believed.
 */
export function whereabouts(clock = Date.now) {
  const pings = [
    ['ping-0', 'vikram', 4, 12.9611, 77.6387, 18, 'zone-1'],
    ['ping-1', 'ananya', 4, 12.9611, 77.6387, 22, 'zone-1'],
    ['ping-2', 'lakshmi', 2, 12.9352, 77.6245, 35, ''],
    ['ping-3', 'ramesh', 1, 12.9719, 77.5937, 41, ''],
  ].map(([key, person, days, latitude, longitude, accuracyMetres, zone]) => ({
    key,
    person,
    recordedAt: at(back(clock, days), 18, 24),
    latitude,
    longitude,
    accuracyMetres,
    ...(zone ? { zone } : {}),
    source: 'manual',
    notes: note(),
  }));

  const alerts = [{
    key: 'sos-0',
    person: 'ananya',
    raisedAt: at(back(clock, 37), 17, 12),
    reason: text('example.sos.reason'),
    latitude: 12.9611,
    longitude: 77.6387,
    accuracyMetres: 24,
    whereabouts: text('example.sos.where'),
    contacts: ['ec-0'],
    sentVia: option('sosAlert', 'sentVia', 'phone-call'),
    resolvedAt: at(back(clock, 37), 17, 41),
    notes: note(),
  }];

  return { pings, alerts };
}

/**
 * Two transfers between the household's own accounts.
 *
 * These were first written as **loose legs** — `kind: 'transfer'` with no
 * `toAccount`, the shape `isLooseLeg` in `domain/events.js` looks for — so the
 * matcher would pair them and confirming the pair would write an
 * `economicEvent`, filling the Movements tab with something the application
 * had worked out rather than something this file asserted.
 *
 * The repository refused them: *"A transfer needs a destination account."*
 *
 * That refusal is the answer to the question. A loose leg is what you get when
 * two banks each report their own side of one movement, and the write path
 * will not accept one because a person entering a transfer by hand knows where
 * the money went. So loose legs reach this application only through an import
 * or a sync — which makes `economicEvent` derived from an import artefact, and
 * puts it firmly back among the things `0724114` was right not to invent.
 *
 * What is left is what a household actually types: a complete transfer, both
 * ends named. The Movements tab stays empty in the example household, and it
 * stays empty honestly.
 */
export function transfers(clock = Date.now) {
  return [
    ['transfer-0', 21, 'account-0', 'account-1', 50_000_00],
    ['transfer-1', 35, 'account-2', 'account-3', 25_000_00],
  ].map(([key, days, account, toAccount, amount]) => ({
    key,
    date: back(clock, days),
    kind: 'transfer',
    amount,
    account,
    toAccount,
    category: option('transaction', 'category', 'own-account'),
    payee: text('example.transfer.payee'),
    notes: note(),
  }));
}
