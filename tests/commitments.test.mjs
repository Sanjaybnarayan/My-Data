/**
 * What the household is already committed to.
 *
 * The Finance screen said "committed to bills, EMIs and subscriptions" over a
 * figure that had never seen a subscription. Five renewals inside thirty days
 * appeared nowhere among the upcoming bills, and `subscription.autoRenew`,
 * `subscription.cancelUrl` and `digitalAsset.annualCost` were read by nothing.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  monthlyCost, subscriptionOutflow, duplicateCommitments, commitmentSummary,
  subscriptionBills, describeCommitments, unrecordedCommitments,
} from '../js/domain/commitments.js';
import { upcomingBills, committed, committedMonthlyOutflow } from '../js/domain/finance.js';

setSuite('commitments');

const sub = (id, name, amount, over = {}) => ({
  id, name, amount, frequency: 'monthly', renewsOn: '2026-08-20',
  active: true, autoRenew: true, deletedAt: null, ...over,
});

describe('a year of something, as a month of it', () => {
  test('a yearly subscription is a twelfth of itself', () => {
    assert.equal(monthlyCost(sub('s', 'Prime', 1_499_00, { frequency: 'yearly' })), 124_92);
  });

  test('and quarterly, half-yearly and weekly convert too', () => {
    assert.equal(monthlyCost(sub('s', 'x', 300_00, { frequency: 'quarterly' })), 100_00);
    assert.equal(monthlyCost(sub('s', 'x', 600_00, { frequency: 'half-yearly' })), 100_00);
    assert.equal(monthlyCost(sub('s', 'x', 100_00, { frequency: 'weekly' })), 433_33);
  });

  test('an unknown frequency is treated as monthly rather than dropped', () => {
    // Silently contributing zero would understate the very figure this exists
    // to correct.
    assert.equal(monthlyCost({ amount: 500_00, frequency: 'fortnightly' }), 500_00);
    assert.equal(monthlyCost({ amount: 500_00 }), 500_00);
  });

  test('nothing at all is zero, not an error', () => {
    assert.equal(monthlyCost(null), 0);
    assert.equal(monthlyCost({}), 0);
  });
});

describe('what renews itself, and what lapses', () => {
  test('auto-renewing subscriptions are committed money', () => {
    const { committed, lapsing } = subscriptionOutflow([
      sub('s1', 'Netflix', 649_00),
      sub('s2', 'Spotify', 119_00),
    ], []);

    assert.equal(committed, 768_00);
    assert.equal(lapsing, 0);
  });

  test('one that does not renew itself is not committed — it lapses', () => {
    // The whole meaning of the field. Money that only leaves if somebody acts
    // is not money the household is committed to spending, and the thing worth
    // saying about it is that the service stops.
    const { committed, lapsing } = subscriptionOutflow([
      sub('s1', 'Netflix', 649_00),
      sub('s2', 'Adobe CC', 4_230_00, { autoRenew: false }),
    ], []);

    assert.equal(committed, 649_00);
    assert.equal(lapsing, 4_230_00);
  });

  test('one with no autoRenew recorded at all renews, as the schema says', () => {
    // Every other fixture here sets the field, so nothing pinned the absent
    // case — found by mutation. A row written before the field existed, or
    // synced back from a sheet with a blank cell, arrives without it. Reading
    // that as "does not renew" would drop it out of the committed figure
    // silently, which is the whole bug this file exists to fix.
    const bare = { id: 's1', name: 'Netflix', amount: 649_00, frequency: 'monthly', renewsOn: '2026-08-20', deletedAt: null };
    const { committed, lapsing } = subscriptionOutflow([bare], []);

    assert.equal(committed, 649_00);
    assert.equal(lapsing, 0);
    assert.ok(subscriptionBills([bare], [], { from: '2026-08-14' })[0].autoDebit);
  });

  test('a cancelled or deleted subscription is neither', () => {
    const { committed, lapsing, rows } = subscriptionOutflow([
      sub('s1', 'Old gym app', 999_00, { active: false }),
      sub('s2', 'Gone', 500_00, { deletedAt: '2026-01-01T00:00:00.000Z' }),
    ], []);

    assert.equal(committed, 0);
    assert.equal(lapsing, 0);
    assert.length(rows, 0);
  });

  test('a digital asset is priced by the year and counts as lapsing', () => {
    // It has no `autoRenew` field at all. Calling it committed would put money
    // in that figure on the strength of a field that does not exist.
    const { committed, lapsing } = subscriptionOutflow([], [
      { id: 'd1', name: 'example.in', annualCost: 1_180_00, renewsOn: '2026-09-01', deletedAt: null },
    ]);

    assert.equal(committed, 0);
    assert.equal(lapsing, 98_33);
  });

  test('and one with no cost recorded contributes nothing rather than a guess', () => {
    const { rows } = subscriptionOutflow([], [
      { id: 'd1', name: 'A domain', annualCost: null, renewsOn: '2026-09-01', deletedAt: null },
    ]);
    assert.length(rows, 0);
  });
});

describe('the same thing recorded twice', () => {
  const subscriptions = [sub('s1', 'Netflix', 649_00), sub('s2', 'Spotify', 119_00)];

  test('a recurring payment and a subscription with one name is a possible pair', () => {
    const dupes = duplicateCommitments([
      { id: 'r1', name: 'netflix', kind: 'subscription', amount: 649_00, frequency: 'monthly', active: true, deletedAt: null },
    ], subscriptions);

    assert.length(dupes, 1);
    assert.equal(dupes[0].subscriptionId, 's1');
    assert.equal(dupes[0].recurringId, 'r1');
  });

  test('matched on the name, not the amount, so a price change still pairs', () => {
    // A household that recorded the same service a year apart has two
    // different prices for it, and those are the pairs worth asking about.
    const dupes = duplicateCommitments([
      { id: 'r1', name: 'Netflix ', kind: 'subscription', amount: 499_00, frequency: 'monthly', active: true, deletedAt: null },
    ], subscriptions);

    assert.length(dupes, 1);
    // The most that could be double-counted, which is the larger of the two.
    assert.equal(dupes[0].amount, 649_00);
  });

  test('a recurring payment of another kind is not the same commitment', () => {
    // A broadband bill sharing a name with a streaming service is not it.
    assert.length(duplicateCommitments([
      { id: 'r1', name: 'Netflix', kind: 'bill', amount: 649_00, active: true, deletedAt: null },
    ], subscriptions), 0);
  });

  test('and a pair is never silently merged away', () => {
    const summary = commitmentSummary({
      base: 50_000_00,
      recurring: [{ id: 'r1', name: 'Netflix', kind: 'subscription', amount: 649_00, frequency: 'monthly', active: true, deletedAt: null }],
      subscriptions,
    });

    // Both counted. Which record is the real one is the household's to say.
    assert.equal(summary.total, 50_000_00 + 768_00);
    assert.equal(summary.duplicated, 649_00);
    assert.includes(describeCommitments(summary, (n) => String(n)), 'may be counted twice');
  });
});

describe('the figure and the sentence over it', () => {
  test('subscriptions are in the total the screen prints', () => {
    const summary = commitmentSummary({
      base: 79_590_00,
      subscriptions: [sub('s1', 'Netflix', 649_00), sub('s2', 'Prime', 1_499_00, { frequency: 'yearly' })],
      digitalAssets: [{ id: 'd1', name: 'example.in', annualCost: 1_180_00, deletedAt: null }],
    });

    assert.equal(summary.base, 79_590_00);
    assert.equal(summary.subscriptions, 649_00 + 124_92);
    assert.equal(summary.total, 79_590_00 + 649_00 + 124_92);
    // The domain does not renew itself, so it is named separately rather than
    // folded into a figure that claims the money is going to leave.
    assert.equal(summary.lapsing, 98_33);
  });

  test('the sentence says what is in the number, not just the number', () => {
    const said = describeCommitments(commitmentSummary({
      base: 79_590_00,
      subscriptions: [sub('s1', 'Netflix', 649_00)],
    }), (n) => `Rs${n}`);

    assert.includes(said, 'of which Rs64900 is subscriptions that renew themselves');
  });

  test('and it does not claim subscriptions when there are none', () => {
    // The bug this whole tranche is about was a sentence naming something the
    // figure did not contain.
    const said = describeCommitments(commitmentSummary({ base: 79_590_00 }), (n) => String(n));
    assert.not(/subscription/.test(said), said);
  });

  test('money that only leaves if somebody acts is said separately', () => {
    const said = describeCommitments(commitmentSummary({
      base: 10_000_00,
      subscriptions: [sub('s1', 'Adobe CC', 4_230_00, { autoRenew: false })],
    }), (n) => String(n));

    assert.includes(said, 'do not renew themselves');
    assert.includes(said, 'only leaves if somebody renews them');
  });

  test('nothing at all is not an error', () => {
    assert.equal(commitmentSummary().total, 0);
    assert.equal(describeCommitments(null), null);
  });
});

describe('a renewal is a bill', () => {
  const subscriptions = [
    sub('s1', 'Netflix', 649_00, { renewsOn: '2026-08-17' }),
    sub('s2', 'Adobe CC', 4_230_00, { renewsOn: '2026-08-20', autoRenew: false, cancelUrl: 'https://example.test/cancel' }),
    sub('s3', 'Faraway', 100_00, { renewsOn: '2026-12-01' }),
  ];

  test('renewals inside the window are reported with their amounts', () => {
    const bills = subscriptionBills(subscriptions, [], { from: '2026-08-14', days: 30 });

    assert.length(bills, 2);
    assert.equal(bills[0].name, 'Netflix');
    assert.equal(bills[0].amount, 649_00);
    assert.equal(bills[0].dueOn, '2026-08-17');
    assert.equal(bills[0].days, 3);
  });

  test('auto-renewal is what auto-debit means for a subscription', () => {
    const [netflix, adobe] = subscriptionBills(subscriptions, [], { from: '2026-08-14' });
    assert.ok(netflix.autoDebit);
    assert.not(adobe.autoDebit);
  });

  test('and one that does not renew itself says so on the row', () => {
    // Otherwise it looks identical to a bill that pays itself, which is the
    // opposite of what it is.
    const [, adobe] = subscriptionBills(subscriptions, [], { from: '2026-08-14' });
    assert.includes(adobe.why, 'stops on this date unless somebody renews it');
    assert.equal(adobe.cancelUrl, 'https://example.test/cancel');
  });

  test('a renewal just past is still shown, one long past is not', () => {
    // Unlike a card bill, nothing here records that it was ever paid, so
    // nagging forever would be a reminder nobody can clear.
    const recent = [sub('s1', 'Netflix', 649_00, { renewsOn: '2026-08-10' })];
    const ancient = [sub('s1', 'Netflix', 649_00, { renewsOn: '2026-05-01' })];

    assert.ok(subscriptionBills(recent, [], { from: '2026-08-14' })[0].overdue);
    assert.length(subscriptionBills(ancient, [], { from: '2026-08-14' }), 0);
  });

  test('a subscription with no renewal date is not given one', () => {
    assert.length(subscriptionBills([sub('s1', 'Netflix', 649_00, { renewsOn: null })],
      [], { from: '2026-08-14' }), 0);
  });

  test('a digital asset renewal is a bill too', () => {
    const [bill] = subscriptionBills([], [
      { id: 'd1', name: 'example.in', annualCost: 1_180_00, renewsOn: '2026-08-25', deletedAt: null },
    ], { from: '2026-08-14' });

    assert.equal(bill.entity, 'digitalAsset');
    assert.equal(bill.amount, 1_180_00);
    assert.not(bill.autoDebit);
  });

  test('nothing at all is not an error', () => {
    assert.length(subscriptionBills(undefined, undefined, { from: '2026-08-14' }), 0);
  });
});

describe('in the list of what is due', () => {
  const subscriptions = [
    sub('s1', 'Netflix', 649_00, { renewsOn: '2026-08-17' }),
    sub('s2', 'Adobe CC', 4_230_00, { renewsOn: '2026-08-25', autoRenew: false }),
  ];
  // Due after both renewals, so date order and the order the four sources are
  // appended in are different lists.
  const recurring = [{
    id: 'rent', name: 'Rent', kind: 'rent', amount: 35_000_00, frequency: 'monthly',
    nextDueOn: '2026-08-28', active: true, deletedAt: null, autoDebit: false,
  }];

  test('renewals join the bills, in date order', () => {
    const bills = upcomingBills(recurring, [], {
      from: '2026-08-14', days: 30, subscriptions,
    });

    assert.length(bills, 3);
    assert.equal(bills[0].name, 'Netflix');
    assert.equal(bills[0].source, 'subscription');
    assert.equal(bills[0].amount, 649_00);
    assert.equal(bills[2].id, 'rent');
  });

  test('every bill has the same keys, whatever it came from', () => {
    // Four sources knowing different things. Leaving the keys off rather than
    // nulling them is how `bill.account` came to be readable on one row and
    // not the next — found by the typechecker, pinned here.
    const bills = upcomingBills(recurring, [
      { id: 'l1', name: 'Home loan', emiAmount: 43_391_00, emiDay: 20, deletedAt: null },
    ], { from: '2026-08-14', days: 30, subscriptions });

    const keys = ['id', 'source', 'entity', 'recordId', 'name', 'kind', 'amount',
      'dueOn', 'overdue', 'autoDebit', 'account', 'statement', 'cancelUrl', 'why'];
    for (const bill of bills) {
      for (const key of keys) {
        assert.ok(key in bill, `${bill.source} bill has no ${key}`);
      }
    }
  });

  test('a renewal points at the record it came from', () => {
    // The bill id is derived, so it opens nothing on its own.
    const [netflix] = upcomingBills([], [], { from: '2026-08-14', subscriptions });
    assert.equal(netflix.entity, 'subscription');
    assert.equal(netflix.recordId, 's1');
  });

  test('callers that pass no subscriptions are unaffected', () => {
    const bills = upcomingBills(recurring, [], { from: '2026-08-14' });
    assert.length(bills, 1);
    assert.equal(bills[0].id, 'rent');
  });
});

describe('the floor the screen reports', () => {
  const subscriptions = [sub('s1', 'Netflix', 649_00), sub('s2', 'Spotify', 119_00)];
  const recurring = [{
    id: 'r1', name: 'Broadband', kind: 'bill', amount: 1_199_00, frequency: 'monthly',
    nextDueOn: '2026-08-20', active: true, deletedAt: null,
  }];
  const loans = [{ id: 'l1', name: 'Home loan', emiAmount: 43_391_00, emiDay: 5, deletedAt: null }];

  test('bills, EMIs and subscriptions, which is what the sentence claimed', () => {
    const summary = committed({ recurring, loans, subscriptions });

    assert.equal(summary.base, 1_199_00 + 43_391_00);
    assert.equal(summary.subscriptions, 768_00);
    assert.equal(summary.total, 1_199_00 + 43_391_00 + 768_00);
  });

  test('and the bills-and-EMIs half is unchanged for anything still reading it', () => {
    assert.equal(committedMonthlyOutflow(recurring, loans), 1_199_00 + 43_391_00);
  });
});

/*
 * The other direction: money that leaves and nothing records.
 *
 * `committedMonthlyOutflow` asks what the records add up to; the statement
 * answers what actually left. Both are honest about their own inputs, and
 * until now nothing put them side by side.
 */
describe('charges the ledger sees that no record explains', () => {
  const charge = (name, amount, over = {}) => ({
    key: name.toLowerCase(), name, amount, period: 'monthly', occurrences: 6,
    spent: amount * 6, active: true, ...over,
  });

  const recorded = {
    recurring: [{ id: 'r1', name: 'Rent', amount: 35_000_00, frequency: 'monthly', deletedAt: null }],
    loans: [{ id: 'l1', name: 'Home loan', emiAmount: 18_500_00, deletedAt: null }],
    subscriptions: [], digitalAssets: [],
  };

  test('a narration is matched to the record it belongs to, not to equality', () => {
    // "Rent" is not "LANDLORD RENT" and "Home loan" is not "ACH DR HDFC HOME
    // LOAN EMI". Requiring equality would report every real commitment as
    // unaccounted, which is a wrong claim in the other direction.
    const result = unrecordedCommitments([
      charge('LANDLORD RENT', 35_000_00),
      charge('ACH DR HDFC HOME LOAN EMI', 18_500_00),
    ], recorded);

    assert.length(result.accounted, 2);
    assert.length(result.unaccounted, 0);
    assert.equal(result.unaccountedPerMonth, 0);
  });

  test('a subscription nobody wrote down is named and priced', () => {
    const result = unrecordedCommitments([
      charge('LANDLORD RENT', 35_000_00),
      charge('NETFLIX', 649_00),
      charge('CLOUD BACKUP', 1_180_00),
    ], recorded);

    assert.length(result.unaccounted, 2);
    assert.equal(result.unaccountedPerMonth, 649_00 + 1_180_00);
  });

  test('a stale record still accounts for the charge, and the gap is reported', () => {
    // The record says ₹499 and ₹649 leaves. That is one commitment at a stale
    // price, not two commitments — and the difference is the thing worth
    // showing, so it is reported rather than used to reject the match.
    const result = unrecordedCommitments([charge('NETFLIX', 649_00)], {
      ...recorded,
      subscriptions: [sub('s1', 'Netflix', 499_00)],
    });

    assert.length(result.accounted, 1);
    assert.equal(result.accounted[0].differsBy, 150_00);
    assert.equal(result.unaccountedPerMonth, 0);
  });

  test('two records that fit equally well are a question, not a match', () => {
    const result = unrecordedCommitments([charge('AXIS BROADBAND', 1_199_00)], {
      ...recorded,
      recurring: [
        { id: 'a', name: 'Broadband', amount: 1_199_00, frequency: 'monthly', deletedAt: null },
        { id: 'b', name: 'Broadband', amount: 999_00, frequency: 'monthly', deletedAt: null },
      ],
    });

    assert.length(result.uncertain, 1);
    assert.equal(result.uncertain[0].record, null);
    assert.length(result.accounted, 0);
    // Excluded from the figure deliberately: a total that counted maybes would
    // overstate, and the value of this number is that it can be believed.
    assert.equal(result.unaccountedPerMonth, 0);
  });

  test('one shared word on otherwise unalike names is offered, not asserted', () => {
    const result = unrecordedCommitments([charge('RENTAL CAR HIRE', 4_500_00)], {
      ...recorded,
      recurring: [{ id: 'r', name: 'Rental deposit box', amount: 4_500_00, frequency: 'monthly', deletedAt: null }],
    });

    assert.length(result.uncertain, 1);
    assert.length(result.accounted, 0);
  });

  test('a record named for a common word does not swallow every narration', () => {
    // Without the weak-word list, a record called "Card payment" shares both of
    // its words with any card narration and would account for all of them.
    const result = unrecordedCommitments([charge('POS CARD PAYMENT SWIGGY', 780_00)], {
      ...recorded,
      recurring: [{ id: 'r', name: 'Card payment', amount: 780_00, frequency: 'monthly', deletedAt: null }],
    });

    assert.length(result.accounted, 0);
    assert.equal(result.unaccountedPerMonth, 780_00);
  });

  test('a charge with no record has no difference to report', () => {
    // Not zero, and not the whole amount: there is nothing to differ from, and
    // a screen printing "differs by ₹649" against no record would be nonsense.
    const [row] = unrecordedCommitments([charge('NETFLIX', 649_00)], recorded).unaccounted;
    assert.equal(row.differsBy, null);
  });

  test('a run that has stopped is not a commitment', () => {
    const result = unrecordedCommitments([
      charge('CANCELLED THING', 999_00, { active: false }),
    ], recorded);

    assert.length(result.unaccounted, 0);
    assert.equal(result.unaccountedPerMonth, 0);
  });

  test('a cadence other than monthly is converted before it is totalled', () => {
    const result = unrecordedCommitments([
      charge('YEARLY DOMAIN', 1_200_00, { period: 'yearly' }),
    ], recorded);

    assert.equal(result.unaccountedPerMonth, 100_00);
  });

  test('the figure is reported beside the committed total, never inside it', () => {
    const summary = commitmentSummary({
      ...recorded,
      base: committedMonthlyOutflow(recorded.recurring, recorded.loans),
      detected: [charge('NETFLIX', 649_00)],
    });

    assert.equal(summary.total, 53_500_00);
    assert.equal(summary.unaccounted, 649_00);
    assert.length(summary.unaccountedRows, 1);
  });

  test('the sentence says where the money was read from', () => {
    const summary = commitmentSummary({
      ...recorded,
      base: committedMonthlyOutflow(recorded.recurring, recorded.loans),
      detected: [charge('NETFLIX', 649_00)],
    });
    const sentence = describeCommitments(summary, (n) => `₹${n / 100}`);

    assert.includes(sentence, 'NETFLIX');
    assert.includes(sentence, 'not added to the figure above');
  });

  test('no detected charges means the sentence is unchanged', () => {
    const summary = commitmentSummary({
      ...recorded,
      base: committedMonthlyOutflow(recorded.recurring, recorded.loans),
    });

    assert.equal(summary.unaccounted, 0);
    assert.not(describeCommitments(summary, (n) => `₹${n / 100}`).includes('no record here explains'));
  });
});
