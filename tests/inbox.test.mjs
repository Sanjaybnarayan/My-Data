import { test, describe, assert, setSuite } from './harness.mjs';
import {
  MERCHANTS, recognise, searchQuery, merchant, customMerchant,
} from '../js/domain/merchants.js';
import {
  readReceipt, readTotal, readOrderId, byMerchant, subscriptions, reconcile,
} from '../js/domain/inbox.js';
import {
  BACKEND, readMailbox, googleMailbox, scriptMailbox,
  addMailbox, removeMailbox, receiptKey,
} from '../js/domain/mailboxes.js';
import { GmailClient, readBody, MAIL_SCOPES } from '../js/sync/gmail.js';
import { CATEGORIES } from '../js/domain/categorise.js';
import { entity } from '../js/data/schema.js';

setSuite('inbox');

/* ------------------------------------------------------------- recognising */

describe('recognising a merchant', () => {
  test('the sender decides, not the subject', () => {
    // Matching on subject alone would claim every newsletter that says
    // "your order" — including one from a shop nobody has an account with.
    assert.equal(recognise({ from: 'noreply@zomato.com', subject: 'Order delivered' }).key, 'zomato');
    assert.equal(recognise({ from: 'someone@example.com', subject: 'Your Zomato order' }), null);
  });

  test('a display name around the address is unwrapped', () => {
    const found = recognise({ from: 'Swiggy <no-reply@swiggy.in>', subject: 'Order #123 delivered' });
    assert.equal(found.key, 'swiggy');
  });

  test('a subject pattern narrows a noisy sender', () => {
    // Amazon mails about deliveries, recommendations and password resets. Only
    // some of that is a purchase.
    assert.ok(recognise({ from: 'auto-confirm@amazon.in', subject: 'Your order has been dispatched' }));
    assert.equal(recognise({ from: 'store-news@amazon.in', subject: 'Deals of the day' }), null);
  });

  test('every merchant declares a category the categoriser also knows', () => {
    // Not a copy of the list: the same list. A receipt and a bank row that
    // both say "quick commerce" have to mean the same thing, or the two
    // views of one purchase disagree.
    const known = new Set(CATEGORIES.map((category) => category.key));
    const storable = new Set(entity('receipt').fields.find((f) => f.key === 'category').options);

    for (const entry of MERCHANTS) {
      assert.includes(known, entry.category, `${entry.key} has an unknown category`);
      assert.includes(storable, entry.category, `${entry.key} cannot be stored`);
      assert.ok(entry.senders.length, `${entry.key} has no senders`);
    }
  });

  test('merchants can be looked up by key', () => {
    assert.equal(merchant('blinkit').name, 'Blinkit');
    assert.equal(merchant('nope'), null);
  });
});

/* --------------------------------------------------- shops nobody shipped */

describe('a shop the registry does not know', () => {
  const local = customMerchant({ domain: 'thelocalbakery.in', name: 'The Local Bakery', category: 'groceries' });

  test('a household can name one with a domain', () => {
    assert.equal(local.name, 'The Local Bakery');
    assert.ok(recognise({ from: 'orders@thelocalbakery.in' }, [local]));
  });

  test('a subdomain of it counts, and a domain that merely ends with it does not', () => {
    assert.ok(recognise({ from: 'no-reply@mail.thelocalbakery.in' }, [local]));
    assert.equal(recognise({ from: 'spam@notthelocalbakery.in' }, [local]), null);
  });

  test('a household shop wins over a built-in one for the same domain', () => {
    const mine = customMerchant({ domain: 'amazon.in', name: 'Amazon (work)', category: 'business-outlay' });
    assert.equal(recognise({ from: 'auto-confirm@amazon.in', subject: 'Your order' }, [mine]).name, 'Amazon (work)');
  });

  test('something that is not a domain is refused rather than half-accepted', () => {
    assert.equal(customMerchant({ domain: 'the bakery' }), null);
    assert.equal(customMerchant({ domain: '' }), null);
  });

  test('it goes into the query like any other sender', () => {
    const query = searchQuery({ keys: [local.key], extra: [local] });
    assert.includes(query, 'from:thelocalbakery.in');
  });

  test('a receipt from one reads exactly like the rest', () => {
    const read = readReceipt({
      id: 'm9',
      from: 'orders@thelocalbakery.in',
      subject: 'Order #77 ready',
      date: '2026-06-01',
      body: 'Total ₹240.00',
    }, [local]);
    assert.equal(read.merchant, 'The Local Bakery');
    assert.equal(read.category, 'groceries');
    assert.equal(read.amount, 24_000);
  });
});

/* ------------------------------------------------------------ the query */

describe('the search query is the actual privacy boundary', () => {
  test('it names senders and nothing else', () => {
    const query = searchQuery({ keys: ['zomato', 'swiggy'] });
    assert.includes(query, 'from:zomato.com');
    assert.includes(query, 'from:swiggy.in');
    assert.not(/subject:|has:attachment|label:(?!.*trash)/.test(query), query);
  });

  test('deleted mail is left alone', () => {
    // A receipt somebody put in the bin was put there on purpose.
    const query = searchQuery();
    assert.includes(query, '-in:trash');
    assert.includes(query, '-in:spam');
  });

  test('a date bound is passed in Gmail form', () => {
    assert.includes(searchQuery({ since: '2026-04-01' }), 'after:2026/04/01');
  });

  test('asking for no merchants asks for nothing at all', () => {
    // An empty query would be a request to read the whole mailbox. The server
    // refuses one without a sender term, and this refuses to build one.
    assert.equal(searchQuery({ keys: ['nothing-matches-this'] }), '');
  });

  test('every domain in the query is a real domain', () => {
    for (const term of searchQuery().match(/from:[^\s)]+/g) ?? []) {
      const domain = term.slice('from:'.length);
      assert.ok(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain), `${domain} is not a domain`);
    }
  });
});

/* ------------------------------------------------------------ mailboxes */

describe('more than one mailbox', () => {
  const url = 'https://script.google.com/macros/s/AKfycbxSecondAccount123/exec';

  test('a signed-in account is a mailbox, keyed by its address', () => {
    const box = googleMailbox({ email: 'Work@Example.COM' });
    assert.equal(box.kind, 'google');
    assert.equal(box.email, 'work@example.com');
    assert.equal(box.id, 'gm_work@example.com');
    // Signing the same account in twice is one mailbox, not doubled receipts.
    assert.length(addMailbox(addMailbox([], box), googleMailbox({ email: 'work@example.com' })), 1);
  });

  test('something that is not an address is refused', () => {
    assert.equal(googleMailbox({ email: 'nobody' }), null);
    assert.equal(googleMailbox({}), null);
  });

  test('a deployment is recognised by its URL, and nothing else is', () => {
    assert.ok(scriptMailbox({ url }));
    assert.equal(scriptMailbox({ url: 'someone@gmail.com' }), null);
    assert.equal(scriptMailbox({ url: 'https://example.com/exec' }), null);
    assert.equal(scriptMailbox({ url: `${url}?x=1` }), null);
  });

  test('a Workspace deployment URL is a deployment too', () => {
    assert.ok(scriptMailbox({ url: 'https://script.google.com/a/macros/firm.in/s/AKfycbxAbc123/exec' }));
  });

  test('the id comes from the deployment, so the same URL is the same mailbox', () => {
    const list = addMailbox(
      addMailbox([], scriptMailbox({ url, label: 'Work' })),
      scriptMailbox({ url, label: 'Work mail' }),
    );
    assert.length(list, 1, 'pasting the same URL twice doubled every receipt from it');
    assert.equal(list[0].label, 'Work mail', 're-adding should correct the label');
  });

  test('a stored mailbox is read back by kind, and a broken one is dropped', () => {
    assert.equal(readMailbox({ kind: 'google', email: 'a@b.com' }).id, 'gm_a@b.com');
    assert.equal(readMailbox({ kind: 'backend' }).id, BACKEND.id);
    assert.equal(readMailbox({ kind: 'script', url }).kind, 'script');
    assert.equal(readMailbox({ kind: 'google', email: 'rubbish' }), null);
    assert.equal(readMailbox({}), null);
  });

  test('a mailbox stored before there were kinds is a deployment', () => {
    // That was the only sort there was, so an entry with a URL and no kind
    // must keep working rather than vanish on the next release.
    assert.equal(readMailbox({ url }).kind, 'script');
  });

  test('a receipt is keyed by mailbox and message together', () => {
    // A Gmail message id is unique within one mailbox, not across several.
    assert.not(receiptKey('mb_a', '18f2') === receiptKey('mb_b', '18f2'));
    // Receipts written before there were mailboxes belong to the backend.
    assert.equal(receiptKey('', '18f2'), receiptKey(BACKEND.id, '18f2'));
  });

  test('removing one leaves the others', () => {
    const a = googleMailbox({ email: 'a@b.com' });
    const b = scriptMailbox({ url });
    assert.length(removeMailbox([a, b], a.id), 1);
  });

  test('a mailbox falls back to its address for a name', () => {
    assert.equal(scriptMailbox({ url, email: 'Work@Example.COM' }).label, 'work@example.com');
    assert.equal(scriptMailbox({ url }).label, 'Another mailbox');
  });
});

/* --------------------------------------------------- reading Gmail here */

describe('reading Gmail from the browser', () => {
  const encode = (text) => Buffer.from(text, 'utf8').toString('base64url');

  const inbox = {
    'msg_1': {
      id: 'msg_1',
      internalDate: String(Date.UTC(2026, 4, 14)),
      payload: {
        headers: [
          { name: 'From', value: 'Zomato <noreply@zomato.com>' },
          { name: 'Subject', value: 'Order #ZO12345678 delivered' },
        ],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: encode('<p>Grand Total &#8377;9,999.00</p>') } },
          { mimeType: 'text/plain', body: { data: encode('Grand Total ₹645.00') } },
        ],
      },
    },
  };

  function client({ onCall = () => {}, token = 'tok' } = {}) {
    return new GmailClient({
      getToken: async () => token,
      fetchImpl: async (url, options) => {
        onCall(url, options);
        const list = /\/messages\?/.test(url);
        const body = list
          ? { messages: Object.keys(inbox).map((id) => ({ id })) }
          : inbox[decodeURIComponent(url.split('/messages/')[1].split('?')[0])];
        return { ok: true, status: 200, json: async () => body, text: async () => '' };
      },
    });
  }

  test('it refuses a query that does not name senders', async () => {
    // The same refusal the backend makes. Neither route will read a whole
    // mailbox, and the client not building one is not a reason to skip the
    // check here.
    await assert.throws(() => client().mail('after:2026/01/01'), /name the senders/i);
  });

  test('the token travels as a bearer header and the query as written', async () => {
    const seen = [];
    await client({ onCall: (url, options) => seen.push({ url, options }) })
      .mail('from:zomato.com -in:trash', 5);

    assert.equal(seen[0].options.headers.Authorization, 'Bearer tok');
    assert.includes(decodeURIComponent(seen[0].url.replace(/\+/g, ' ')), 'q=from:zomato.com -in:trash');
  });

  test('a message comes back in the shape a receipt is read from', async () => {
    const { messages } = await client().mail('from:zomato.com', 5);
    const [message] = messages;

    assert.equal(message.from, 'Zomato <noreply@zomato.com>');
    assert.equal(message.date, '2026-05-14');
    // text/plain wins over text/html even when the HTML part comes first —
    // taking the wrong one here would report a ₹9,999 dinner.
    assert.includes(message.body, '₹645.00');

    // And it reads as a receipt without any translation in between.
    assert.equal(readReceipt(message).amount, 64_500);
  });

  test('a rupee sign survives the decode', () => {
    // Gmail bodies are base64url over UTF-8, and a naive decode turns ₹ into
    // mojibake — which then fails to match any amount pattern at all.
    assert.includes(readBody({ mimeType: 'text/plain', body: { data: encode('Total ₹1,299.00') } }), '₹1,299.00');
  });

  test('an HTML-only receipt is stripped rather than skipped', () => {
    const html = readBody({
      mimeType: 'text/html',
      body: { data: encode('<style>x{}</style><table><tr><td>Grand Total</td><td>&#8377;450.00</td></tr></table>') },
    });
    assert.not(/</.test(html), html);
    assert.equal(readTotal(html), 45_000);
  });

  test('the scopes are identity and mail, and nothing about Drive or Sheets', () => {
    assert.includes(MAIL_SCOPES, 'https://www.googleapis.com/auth/gmail.readonly');
    assert.not(MAIL_SCOPES.some((scope) => /drive|spreadsheets/.test(scope)), MAIL_SCOPES.join(' '));
  });

  test('a refusal from Google is reported as one, not as an empty mailbox', async () => {
    const denied = new GmailClient({
      getToken: async () => 'tok',
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'insufficient scope' }),
    });
    await assert.throws(() => denied.mail('from:zomato.com'), /permission to read its mail/i);
  });

  test('being signed out is not retried forever', async () => {
    const out = new GmailClient({ getToken: async () => null });
    await assert.throws(() => out.mail('from:zomato.com'), /not signed in/i);
  });
});

/* ------------------------------------------------------------- receipts */

describe('reading a receipt', () => {
  const order = {
    id: 'msg_1',
    from: 'noreply@zomato.com',
    subject: 'Order #ZO12345678 delivered',
    date: '2026-05-14',
    body: 'Item total 520.00\nDelivery fee 45.00\nTaxes 80.00\nGrand Total ₹645.00\nThanks!',
  };

  test('the total comes from a word that means total', () => {
    // A receipt is full of numbers. Taking the largest or the first gets a
    // plausible wrong answer, which is the worst kind in a spending total.
    assert.equal(readReceipt(order).amount, 64_500);
  });

  test('a receipt with no total word yields no amount', () => {
    const read = readReceipt({ ...order, body: 'Your food is on the way. 520.00 45.00' });
    assert.equal(read.amount, undefined, 'an amount was guessed from a loose number');
  });

  test('the order number is kept, because it is what makes it findable', () => {
    assert.equal(readReceipt(order).orderId, 'ZO12345678');
    assert.equal(readOrderId('Invoice No: INV-2026-0042 issued'), 'INV-2026-0042');
  });

  test('the message id is kept and the message is not', () => {
    const read = readReceipt(order);
    assert.equal(read.messageId, 'msg_1');
    assert.equal(read.body, undefined, 'the email body must not be carried into a record');
  });

  test('mail from an unknown sender is not a receipt', () => {
    assert.equal(readReceipt({ from: 'aunt@example.com', subject: 'Order of service' }), null);
  });

  test('a refund is not spending', () => {
    const read = readReceipt({
      ...order,
      subject: 'Refund for order #ZO12345678',
      body: 'Total refunded ₹645.00',
    });
    assert.ok(read.refund);
    assert.equal(read.direction, 'in');
  });

  test('a renewal is recognised as a subscription', () => {
    const read = readReceipt({
      id: 'm2',
      from: 'payments-noreply@google.com',
      subject: 'Your Google One subscription renewed',
      date: '2026-05-01',
      body: 'Total paid ₹299.00. Next billing date 01 June 2026.',
    });
    assert.ok(read.subscription);
    assert.equal(read.amount, 29_900);
  });

  test('readTotal prefers the most specific label', () => {
    assert.equal(readTotal('Total 999.00 Grand Total 450.00'), 45_000);
  });
});

/* ------------------------------------------------------------- summaries */

const receipts = [
  { merchantKey: 'zomato', merchant: 'Zomato', category: 'food-delivery', amount: 64_500, date: '2026-05-14' },
  { merchantKey: 'zomato', merchant: 'Zomato', category: 'food-delivery', amount: 35_500, date: '2026-05-20' },
  { merchantKey: 'zomato', merchant: 'Zomato', category: 'food-delivery', amount: 20_000, date: '2026-05-22', refund: true },
  { merchantKey: 'blinkit', merchant: 'Blinkit', category: 'quick-commerce', amount: 89_900, date: '2026-05-02' },
];

describe('what the receipts add up to', () => {
  test('a shop is summarised by orders, spend and dates', () => {
    const zomato = byMerchant(receipts).find((m) => m.key === 'zomato');
    assert.equal(zomato.orders, 2, 'a refund is not an order');
    assert.equal(zomato.spent, 100_000);
    assert.equal(zomato.refunded, 20_000);
    assert.equal(zomato.net, 80_000);
    assert.equal(zomato.average, 50_000);
    assert.equal(zomato.last, '2026-05-22');
  });

  test('shops are ordered by what they actually cost', () => {
    assert.equal(byMerchant(receipts)[0].key, 'blinkit');
  });

  test('a receipt with no amount is not counted as zero', () => {
    assert.length(byMerchant([{ merchantKey: 'x', merchant: 'X' }]), 0);
  });

  test('a subscription is reported by what it costs a year', () => {
    // ₹299 a month is invisible; ₹3,588 a year is not. That is the number
    // that changes anybody's mind about a subscription.
    const monthly = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'].map((date) => ({
      merchantKey: 'google', merchant: 'Google', category: 'subscription',
      amount: 29_900, date, subscription: true,
    }));
    const [found] = subscriptions(monthly);
    assert.equal(found.period, 'monthly');
    assert.equal(found.yearly, 358_800);
  });
});

/* ---------------------------------------------------- against the bank */

describe('matching receipts to the bank', () => {
  const transactions = [
    { date: '2026-05-14', amount: 64_500, direction: 'out', counterparty: 'ZOMATO LIMITED', raw: 'UPI/ZOMATO' },
    { date: '2026-05-02', amount: 89_900, direction: 'out', counterparty: 'Blinkit', raw: 'UPI/Blinkit' },
    { date: '2026-05-14', amount: 64_500, direction: 'out', counterparty: 'SWIGGY', raw: 'UPI/SWIGGY' },
  ];

  test('a receipt finds the row that paid for it', () => {
    const { matched } = reconcile([receipts[0]], transactions);
    assert.length(matched, 1);
    assert.equal(matched[0].transaction.counterparty, 'ZOMATO LIMITED');
  });

  test('the merchant has to agree, not just the amount', () => {
    // Two ₹645 payments on the same day to different shops would otherwise
    // pair with whichever came first.
    const swiggyReceipt = { ...receipts[0], merchantKey: 'swiggy', merchant: 'Swiggy' };
    const { matched } = reconcile([swiggyReceipt], transactions);
    assert.equal(matched[0].transaction.counterparty, 'SWIGGY');
  });

  test('a bank row is claimed only once', () => {
    const twice = [receipts[0], { ...receipts[0] }];
    const { matched, unmatched } = reconcile(twice, transactions);
    assert.length(matched, 1);
    assert.length(unmatched, 1);
  });

  test('a settlement a day or two later still matches', () => {
    const late = [{ ...receipts[0], date: '2026-05-12' }];
    assert.length(reconcile(late, transactions).matched, 1);
  });

  test('an unmatched receipt is reported, not an error', () => {
    // It may have been paid by a card this application does not import, or
    // from somebody else's account.
    const orphan = [{ merchantKey: 'zepto', merchant: 'Zepto', amount: 12_300, date: '2026-05-09' }];
    const result = reconcile(orphan, transactions);
    assert.length(result.matched, 0);
    assert.length(result.unmatched, 1);
    assert.equal(result.coverage, 0);
  });
});
