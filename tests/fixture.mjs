/**
 * A live FamilyOS database, in memory, unlocked, with an actor.
 *
 * Every data-layer suite builds one of these. It uses the real `Database`,
 * the real `Repository`, the real keyring and real AES-GCM — only the storage
 * adapter differs from what runs on a phone.
 */

import { Database } from '../js/data/database.js';
import { MemoryAdapter } from '../js/data/storage.js';
import { fakeStorage } from './harness.mjs';

export async function makeDb({
  role = 'owner', personId = 'per_owner', pin = '482913', clock,
  iterations = 1000, // real PBKDF2, fewer rounds: the suite runs hundreds of these
} = {}) {
  const db = new Database({
    adapter: new MemoryAdapter(),
    storage: fakeStorage(),
    iterations,
    ...(clock ? { clock } : {}),
  });
  await db.open();
  await db.keyring.enrolPin(pin);
  db.setActor({ personId, role });
  return db;
}

/** The outbox, oldest first — what the sync engine would drain next. */
export async function outbox(db) {
  return db.adapter.query('outbox', { index: 'bySeq' });
}

export async function auditLog(db) {
  return db.adapter.query('audit', { index: 'byAt' });
}

/** A person row, since almost everything references one. */
export async function makePerson(db, overrides = {}) {
  return db.repo('person').create({
    name: 'Asha Narayan', role: 'owner', relationship: 'self',
    birthday: '1985-03-09', bloodGroup: 'O+', ...overrides,
  });
}

export async function makeAccount(db, overrides = {}) {
  return db.repo('account').create({
    name: 'HDFC Savings', kind: 'savings', institution: 'HDFC Bank',
    accountNumber: '50100123456789', ifsc: 'HDFC0001234',
    openingBalance: '25000', ...overrides,
  });
}
