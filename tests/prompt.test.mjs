/**
 * The prompt's ten financial tests, as executable specification.
 *
 * ## Why these are a file of their own
 *
 * The roadmap called them "the sharpest specification in the whole document"
 * and then carried a **prose table** of their pass/fail status. That table was
 * written before Phases 5 and 6 did any work on the things it described, and by
 * the time anybody re-ran them three of its rows were wrong — two claimed
 * failure and one claimed "partial" for behaviour that had been working for
 * several tranches.
 *
 * A claim about the codebase goes stale like any other. These are the ten,
 * written so that the table cannot drift again: if a row here starts failing,
 * the suite says so on the next commit rather than on the next audit.
 *
 * ## What they are not
 *
 * Not a substitute for the tests that cover each of these areas properly.
 * `tests/events.test.mjs`, `tests/settlement.test.mjs` and `tests/domain.test.mjs`
 * hold the detail — the edge cases, the refusals, the arithmetic. These are the
 * ten headline scenarios stated once, at the level the prompt states them, so
 * that "does the application do the thing it was asked to do" has an answer
 * that runs.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { proposeTransfers, linkFor, CONFIDENCE } from '../js/domain/events.js';
import { settlementReport } from '../js/domain/settlement.js';
import { planScan } from '../js/domain/inbox.js';
import { receiptKey } from '../js/domain/mailboxes.js';
import { fingerprint } from '../js/domain/import.js';
import * as fin from '../js/domain/finance.js';

setSuite('the prompt’s ten');

const txn = (over) => ({
  id: `t${Math.random().toString(36).slice(2, 8)}`,
  date: '2026-07-05',
  kind: 'transfer',
  amount: 100_000_00,
  category: 'own account',
  deletedAt: null,
  ...over,
});

describe('money moving between the household’s own accounts', () => {
  test('1 — an HDFC debit and an ICICI credit are one movement, not two', () => {
    const { proposals } = proposeTransfers([
      txn({ account: 'hdfc', direction: 'out', amount: 100_000_00, date: '2026-07-05' }),
      txn({ account: 'icici', direction: 'in', amount: 100_000_00, date: '2026-07-05' }),
    ]);

    assert.length(proposals, 1);
    assert.equal(proposals[0].confidence, CONFIDENCE.PROBABLE);
    assert.ok(linkFor(proposals[0]), 'a probable pairing can be confirmed');
  });

  test('2 — the same amount a day apart is offered, not assumed', () => {
    // "Potential match" in the prompt. It is offered with a confirm control and
    // nothing is written until somebody clicks: the deciding stays with the
    // person either way.
    const { proposals } = proposeTransfers([
      txn({ account: 'hdfc', direction: 'out', amount: 50_000_00, date: '2026-07-05' }),
      txn({ account: 'icici', direction: 'in', amount: 50_000_00, date: '2026-07-06' }),
    ]);

    assert.length(proposals, 1);
    assert.ok(proposals[0].why, 'and it says why it thinks so');
  });

  test('3 — ₹50,000 out and ₹49,950 in is never matched automatically', () => {
    // The sharpest of the ten, and the one a matching engine most wants to get
    // wrong. Near amounts may be *shown* — a fee could explain the difference —
    // but nothing may turn them into one movement on its own.
    const { proposals } = proposeTransfers([
      txn({ account: 'hdfc', direction: 'out', amount: 50_000_00, date: '2026-07-05' }),
      txn({ account: 'icici', direction: 'in', amount: 49_950_00, date: '2026-07-05' }),
    ]);

    for (const proposal of proposals) {
      assert.not(proposal.confidence === CONFIDENCE.PROBABLE,
        'a near amount is never probable');
      assert.equal(linkFor(proposal), null, 'and can never be confirmed by itself');
    }
  });
});

describe('a credit card is not a second wallet', () => {
  const accounts = [
    { id: 'card', kind: 'credit card', deletedAt: null },
    { id: 'hdfc', kind: 'savings', deletedAt: null },
  ];

  test('4 — paying the bill is a settlement, and the purchase is the spending', () => {
    const report = settlementReport([
      txn({ account: 'card', kind: 'expense', direction: 'out',
        amount: 5_000_00, category: 'groceries' }),
      txn({ account: 'hdfc', kind: 'transfer', direction: 'out', toAccount: 'card',
        amount: 5_000_00, category: 'credit card' }),
    ], accounts);

    assert.length(report.settlements, 1);
    assert.ok(report.corrected, 'and the double count is named');
  });

  test('5 — using the card at a shop is spending', () => {
    const totals = fin.totals([txn({
      account: 'card', kind: 'expense', direction: 'out',
      amount: 2_000_00, category: 'groceries',
    })]);
    assert.equal(totals.expense, 2_000_00);
  });
});

describe('moving money into an investment is not losing it', () => {
  const accounts = [
    { id: 'hdfc', kind: 'savings', deletedAt: null, openingBalance: 5_00_000_00 },
    { id: 'demat', kind: 'demat', deletedAt: null, openingBalance: 0 },
  ];

  /** The total across both accounts, which funding a broker must not change. */
  const across = (rows) => fin.accountBalances(accounts, rows)
    .reduce((sum, account) => sum + account.balance, 0);

  test('6 — funding a broker moves money, it does not spend it', () => {
    // Checked in all three shapes a transfer can take, because they are three
    // different code paths and two of them were wrong once — see
    // `docs/BALANCES.md`. The hand-entered shape names both ends on one row;
    // an import writes two rows with directions; a confirmed pairing has both.
    const one = txn({ account: 'hdfc', toAccount: 'demat', amount: 1_00_000_00 });
    const pair = [
      txn({ account: 'hdfc', direction: 'out', amount: 1_00_000_00 }),
      txn({ account: 'demat', direction: 'in', amount: 1_00_000_00 }),
    ];
    const confirmed = [
      txn({ account: 'hdfc', direction: 'out', toAccount: 'demat', amount: 1_00_000_00 }),
      txn({ account: 'demat', direction: 'in', amount: 1_00_000_00 }),
    ];

    for (const [name, rows] of [['hand-entered', [one]], ['imported', pair],
      ['confirmed', confirmed]]) {
      assert.equal(across(rows), 5_00_000_00, `${name} changed the total`);
    }
  });

  test('7 — buying a stock is not spending', () => {
    assert.equal(fin.totals([txn({
      account: 'demat', direction: 'out', amount: 1_00_000_00, category: 'invested',
    })]).expense, 0);
  });

  test('8 — opening a fixed deposit is an allocation, not spending', () => {
    assert.equal(fin.totals([txn({
      account: 'hdfc', direction: 'out', amount: 5_00_000_00, category: 'invested',
    })]).expense, 0);
  });
});

describe('the same thing imported twice is imported once', () => {
  const row = (over = {}) => ({
    description: 'UPI/SHOP/1234', amount: 1_000_00,
    date: '2026-07-05', direction: 'out', ...over,
  });

  test('9 — a statement row downloaded again is the same row', () => {
    assert.equal(fingerprint('hdfc', row()), fingerprint('hdfc', row()));
  });

  test('and two withdrawals a bank prints alike are still two', () => {
    // The failure that matters more than a duplicate: truncating the narration
    // would merge three ATM withdrawals of the same amount on the same day into
    // one, losing two real ones silently.
    // Differing *only* in the narration, which is the real shape: a bank puts
    // the machine's reference inside the text and leaves the reference column
    // empty. Mutating the narration out of the key survived a version of this
    // test that distinguished them by the reference field instead.
    assert.not(fingerprint('hdfc', row()) === fingerprint('hdfc', row({
      description: 'UPI/SHOP/5678',
    })), 'two rows a bank prints alike but for the narration are two rows');

    assert.not(fingerprint('hdfc', row()) === fingerprint('hdfc', row({ reference: 'X2' })));
    assert.not(fingerprint('hdfc', row()) === fingerprint('icici', row()),
      'and the same row in two accounts is two rows');
  });

  /** Mail from a merchant the registry knows; anything else is read past. */
  const receipt = {
    id: 'm1', from: 'noreply@zomato.com', subject: 'Order #ZO1 delivered',
    date: '2026-07-05', body: 'Grand Total ₹645.00',
  };

  test('10 — a receipt read from the same message twice is one receipt', () => {
    assert.length(planScan([receipt], { mailboxId: 'gm_one' }).fresh, 1);

    const known = new Set([receiptKey('gm_one', 'm1')]);
    assert.length(planScan([receipt], { mailboxId: 'gm_one', known }).fresh, 0);
  });

  test('and the same message id in a second mailbox is a second receipt', () => {
    // A Gmail message id is unique within one mailbox, not across several.
    // Without the mailbox in the key, two accounts agreeing on an id would lose
    // one of the two receipts — a loss that never announces itself.
    const known = new Set([receiptKey('gm_one', 'm1')]);
    assert.length(planScan([receipt], { mailboxId: 'gm_two', known }).fresh, 1);
  });
});
