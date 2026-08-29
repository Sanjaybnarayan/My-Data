/**
 * A tradebook, as a file rather than a connection.
 *
 * ## Why this exists and a broker connector does not
 *
 * `holding`, `investmentTransaction`, `costbasis.js` and `portfolio.js` have
 * all existed for a while, and until now **nothing could put a trade into them
 * except typing**. The importer that reads bank statements produces
 * `transaction` rows and only those, so a household with a year of trades had
 * a portfolio engine and no way to feed it.
 *
 * The obvious answer is a broker API. This repository will not fabricate one —
 * `docs/PHASE_STATUS.md` records Phase 8 as capped for exactly that reason,
 * and an `absent:` probe on that row fails the build the moment any broker
 * endpoint appears in `js/` or `apps-script/`. A tradebook the household
 * downloads themselves is a different thing: a file, like a bank statement,
 * that nobody has to be integrated with.
 *
 * That probe scans source text and cannot tell a comment from a call, which is
 * correct — a commented-out endpoint is still one somebody meant to use. So
 * the hostnames are described here rather than quoted; naming them in prose
 * would have made this file trip the check it is written to respect.
 *
 * ## Generic, and mapped by the person importing
 *
 * There are no per-broker parsers here and there will not be. Nobody working
 * on this file has a real tradebook from any broker to test against — the
 * household's own exports are deliberately kept out of the repository — so a
 * parser claiming to understand Zerodha's columns would be a claim nothing
 * checked. Instead the household says which column is which, once, and sees
 * the result before anything is written.
 *
 * ## What it refuses to do
 *
 * **It never writes a bank transaction.** Money moving from a bank to a broker
 * is not an expense, and `domain/categorise.js` already files those transfers
 * as internal. A trade imported here that also produced a `transaction` row
 * would count the same rupees twice, in opposite directions, and the household
 * would be told they had spent their savings.
 *
 * **It never invents a holding.** A symbol that matches nothing is reported,
 * not created — creating one would guess at a name, a kind and a currency from
 * a ticker, and a portfolio built on guesses is worse than a short one.
 *
 * **It never reads a broken row as a zero.** An unreadable date or amount is
 * counted and named. A trade silently imported as ₹0 is the "absence asserted
 * from a read error" fault this repository has now found six times, and it
 * would land in a P&L calculation.
 */

import { readAmount, readDate } from './tabular.js';

/**
 * A quantity of units, which is **not** money.
 *
 * `readAmount` returns minor units — paise — because that is how every `money`
 * field in the schema is stored. Passing a share count through it multiplies
 * it by a hundred, and the first draft of this file did exactly that: ten
 * shares became a thousand, and `units * pricePerUnit` came out in
 * paise-squared. A holding inflated a hundredfold is not a rounding error, it
 * is a portfolio that says something untrue about somebody's money.
 *
 * So units get their own reader. Same tolerance for grouping and brackets,
 * none of the scaling. `num('units', { step: 0.0001 })` in the schema is the
 * shape this has to produce.
 */
export function readUnits(cell) {
  const text = String(cell ?? '').trim();
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const digits = text.replace(/[()]/g, '').replace(/[,\s]/g, '').replace(/^-/, '');
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;

  const value = Number(digits);
  return negative ? -value : value;
}

/** The columns a trade needs, and the ones it can do without. */
export const REQUIRED_COLUMNS = Object.freeze(['date', 'symbol', 'kind', 'amount']);
export const OPTIONAL_COLUMNS = Object.freeze(['units', 'pricePerUnit', 'charges', 'reference']);

/**
 * Why a row did not become a trade. Every one of these is reported, never
 * dropped.
 *
 * Locale keys rather than sentences, for the reason `WHAT_IT_DOES_NOT_DO` in
 * `domain/otp.js` gives: a domain that writes its own English is a domain
 * writing text no catalogue can reach, and the screen is where words belong.
 */
export const REFUSED = Object.freeze({
  date: 'tradebook.refused.date',
  amount: 'tradebook.refused.amount',
  kind: 'tradebook.refused.kind',
  symbol: 'tradebook.refused.symbol',
});

/**
 * What the file calls a buy or a sell, in the words tradebooks actually print.
 *
 * Deliberately short. A word not on this list is refused rather than guessed
 * at: `kind` decides the direction of a holding's units, and guessing it wrong
 * turns a purchase into a disposal in somebody's capital-gains position.
 */
const KINDS = Object.freeze({
  buy: 'buy', b: 'buy', bought: 'buy', purchase: 'buy',
  sell: 'sell', s: 'sell', sold: 'sell', sale: 'sell',
});

/** @param {string} value */
export function readKind(value) {
  return KINDS[String(value ?? '').trim().toLowerCase()] ?? null;
}

/**
 * One row, read through the mapping the household chose.
 *
 * @param {Record<string, string>} row keyed by the file's own column names
 * @param {Record<string, string>} mapping our field name → the file's column
 * @returns {{trade?: object, why?: string}} exactly one of the two is set.
 *   Declared as two optional fields rather than a union because a union
 *   written in JSDoc cannot be narrowed by a property test, and the
 *   alternative is a cast at every call site — a lie repeated per caller.
 */
export function readTrade(row, mapping) {
  const cell = (field) => (mapping[field] ? row[mapping[field]] : undefined);

  const symbol = String(cell('symbol') ?? '').trim();
  if (!symbol) return { why: REFUSED.symbol };

  const date = readDate(cell('date'));
  if (!date) return { why: REFUSED.date };

  const kind = readKind(cell('kind'));
  if (!kind) return { why: REFUSED.kind };

  const units = readUnits(cell('units'));
  const pricePerUnit = readAmount(cell('pricePerUnit'));
  let amount = readAmount(cell('amount'));
  let derivedAmount = false;

  /*
   * Some tradebooks print quantity and price and leave the total to be worked
   * out. Doing that arithmetic is safe and the household can check it; folding
   * charges into it would not be, so this is the gross and `charges` stays its
   * own field. `derivedAmount` travels with the row so the review screen can
   * say which figures the file stated and which this worked out.
   */
  if (amount === null && units !== null && pricePerUnit !== null) {
    // A count times a price in paise is a total in paise. That only holds
    // because `units` came from `readUnits` and not `readAmount` — see there.
    amount = Math.round(Math.abs(units * pricePerUnit));
    derivedAmount = true;
  }
  if (amount === null) return { why: REFUSED.amount };

  return {
    trade: {
      symbol,
      date,
      kind,
      units: units === null ? null : Math.abs(units),
      pricePerUnit,
      amount: Math.abs(amount),
      charges: readAmount(cell('charges')),
      reference: String(cell('reference') ?? '').trim(),
      derivedAmount,
    },
  };
}

/**
 * Which holding a symbol belongs to, or nothing.
 *
 * Exact on `symbol` first, then on `name`, both case-folded. **Two candidates
 * is not a match**: a household holding the same ticker in two folios has two
 * genuinely different positions, and picking one would put a year of trades
 * against the wrong cost basis. Rule: never force an uncertain match.
 *
 * @returns {{holding?: object, why?: 'unknown'|'ambiguous'}} exactly one set.
 */
export function matchHolding(symbol, holdings = []) {
  const wanted = String(symbol ?? '').trim().toLowerCase();
  if (!wanted) return { why: 'unknown' };

  const live = holdings.filter((h) => h && !h.deletedAt);
  const on = (field) => live.filter((h) => String(h[field] ?? '').trim().toLowerCase() === wanted);

  for (const found of [on('symbol'), on('name')]) {
    if (found.length === 1) return { holding: found[0] };
    if (found.length > 1) return { why: 'ambiguous' };
  }
  return { why: 'unknown' };
}

/**
 * What separates one trade from another that looks the same.
 *
 * The broker's own trade or order id when the file has one, because that is
 * the only thing that survives a re-download unchanged. Without it, two
 * partial fills of one order print identically — same instrument, day, price
 * and size — and they are two real trades. So the position of a row among its
 * identical twins is part of the fingerprint: re-importing the same file
 * matches three against three, while a file with a fourth adds one.
 *
 * Truncating any of this would merge real trades, which is the failure
 * `import.js` warns about for bank narrations and is worse here — a merged
 * purchase understates a holding for ever.
 */
export function tradeFingerprint(holdingId, trade, occurrence = 0) {
  return [
    holdingId,
    trade.date,
    trade.kind,
    trade.units ?? '',
    trade.amount,
    trade.reference || `#${occurrence}`,
  ].join('|');
}

/**
 * Plan an import without writing anything.
 *
 * Every row lands in exactly one bucket and every bucket is reported. Nothing
 * is dropped for being awkward — a household that downloaded 300 rows and sees
 * 280 imported is owed the other twenty.
 *
 * @param {Array<Record<string, string>>} rows
 * @param {{mapping?: object, holdings?: Array, existing?: Array}} [options]
 *   `existing` are the `investmentTransaction` records already stored, used to
 *   recognise a re-import of an overlapping file.
 */
export function planTrades(rows, { mapping, holdings = [], existing = [] } = {}) {
  const missing = REQUIRED_COLUMNS.filter((field) => !mapping?.[field]);
  if (missing.length) return { ready: false, missing, planned: [], refused: [], unmatched: [], duplicates: 0 };

  const seenBefore = new Set(existing.map((record, index) => tradeFingerprint(
    record.holding,
    {
      date: record.date,
      kind: record.kind,
      units: record.units ?? '',
      amount: record.amount,
      reference: record.reference ?? '',
    },
    index,
  )));

  const planned = [];
  const refused = [];
  const unmatched = [];
  const counts = new Map();
  let duplicates = 0;

  rows.forEach((row, index) => {
    const read = readTrade(row, mapping);
    if (read.why) {
      refused.push({ row: index + 1, why: read.why });
      return;
    }

    const found = matchHolding(read.trade.symbol, holdings);
    if (found.why) {
      unmatched.push({ row: index + 1, symbol: read.trade.symbol, why: found.why });
      return;
    }

    const key = tradeFingerprint(found.holding.id, read.trade, 0);
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);

    const print = tradeFingerprint(found.holding.id, read.trade, occurrence);
    if (seenBefore.has(print)) {
      duplicates += 1;
      return;
    }

    planned.push({ ...read.trade, holding: found.holding.id, fingerprint: print });
  });

  return { ready: true, missing: [], planned, refused, unmatched, duplicates };
}

/**
 * A planned trade as the record that will be stored.
 *
 * `account` is deliberately absent. The field exists on the entity and means
 * "settled through", and a tradebook does not say which bank account paid —
 * filling it in from the household's only account would be a guess written
 * into a financial record.
 */
export function toInvestmentTransaction(planned) {
  return {
    holding: planned.holding,
    date: planned.date,
    kind: planned.kind,
    units: planned.units ?? undefined,
    pricePerUnit: planned.pricePerUnit ?? undefined,
    amount: planned.amount,
    charges: planned.charges ?? undefined,
  };
}
