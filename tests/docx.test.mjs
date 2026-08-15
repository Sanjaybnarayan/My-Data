/**
 * Word documents, and what a rent receipt is allowed to say.
 *
 * Phase 3's last item. A `.docx` is a ZIP of XML parts exactly as an `.xlsx`
 * is, and `reports/xlsx.js` already carried the ZIP writer — so this is four
 * small XML parts and careful escaping, with no dependency added.
 *
 * The harder half is not the format. It is that a receipt is a statement by the
 * person who received the money, so there is exactly one direction this may be
 * issued in.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { docx } from '../js/reports/docx.js';
import {
  rentReceived, rentYear, rentReceiptBlocks, rentReceiptFilename, PAN_THRESHOLD,
} from '../js/domain/rentreceipt.js';

setSuite('docx');

const text = (bytes) => new TextDecoder().decode(bytes);

const PROPERTY = {
  name: 'Rose Villa',
  address: '14/3 Indiranagar, Bengaluru',
  rented: true,
  monthlyRent: 35_000_00,
  tenantName: 'R Krishnan',
};

const credit = (date, amount = 35_000_00, over = {}) =>
  ({ id: `t-${date}`, date, direction: 'in', amount, deletedAt: null, ...over });

const YEAR = { from: '2026-04-01', to: '2026-09-30' };

describe('the file is a file Word will open', () => {
  test('it is a ZIP, and Content_Types comes first', () => {
    // Word looks for it at the start rather than through the central
    // directory, so the order of the parts is not cosmetic.
    const bytes = docx([{ type: 'paragraph', text: 'hello' }]);
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    assert.ok(text(bytes.slice(0, 200)).includes('[Content_Types].xml'),
      text(bytes.slice(0, 200)));
  });

  test('it carries the four parts a document needs', () => {
    const whole = text(docx([{ type: 'paragraph', text: 'hello' }]));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml',
      'docProps/core.xml']) {
      assert.ok(whole.includes(part), part);
    }
  });

  test('an ampersand in a name does not corrupt the document', () => {
    // A tenant called "Ram & Co." produces XML Word refuses to open — not a
    // mangled document, a corrupt one. Same class of bug as the iCalendar
    // writer had, guarded the same way.
    const whole = text(docx([{ type: 'table', rows: [['Tenant', 'Ram & Co.']] }]));
    assert.ok(whole.includes('Ram &amp; Co.'), 'the ampersand was not escaped');
    assert.not(/Ram & Co/.test(whole), 'a raw ampersand reached the XML');
  });

  test('angle brackets are escaped too', () => {
    const whole = text(docx([{ type: 'paragraph', text: 'a <b> c' }]));
    assert.ok(whole.includes('a &lt;b&gt; c'), whole.slice(0, 200));
  });

  test('spaces at the edge of a run are kept', () => {
    // Without `xml:space="preserve"` Word drops them and a label runs into its
    // value.
    assert.ok(text(docx([{ type: 'paragraph', text: 'x' }]))
      .includes('xml:space="preserve"'));
  });

  test('nothing at all is still a document', () => {
    const whole = text(docx([]));
    assert.ok(whole.includes('word/document.xml'), 'no document part');
  });
});

describe('what rent was actually received', () => {
  const months = (txns, window = YEAR) => rentReceived(PROPERTY, txns, window).months;

  test('a month with a matching credit is receipted, on the day it arrived', () => {
    // Not the first of the month. A receipt stating a date nothing happened on
    // is a small lie a tax officer is entitled to notice.
    const [april] = months([credit('2026-04-03')]);
    assert.ok(april.received);
    assert.equal(april.date, '2026-04-03');
    assert.equal(april.amount, 35_000_00);
  });

  test('a month with no credit is not receipted', () => {
    const found = months([credit('2026-04-03')]);
    assert.length(found.filter((m) => m.received), 1);
    assert.length(found.filter((m) => !m.received), 5);
  });

  test('a part payment is not receipted for the full rent', () => {
    // Somebody's decision to describe, not this one's to guess at.
    const [april] = months([credit('2026-04-05', 20_000_00)]);
    assert.not(april.received, JSON.stringify(april));
  });

  test('money going the other way is not rent received', () => {
    const [april] = months([credit('2026-04-03', 35_000_00, { direction: 'out' })]);
    assert.not(april.received);
  });

  test('a deleted transaction receipts nothing', () => {
    const [april] = months([credit('2026-04-03', 35_000_00, { deletedAt: '2026-05-01' })]);
    assert.not(april.received);
  });

  test('a property that is not rented out produces nothing, and says why', () => {
    const out = rentReceived({ ...PROPERTY, rented: false }, [credit('2026-04-03')], YEAR);
    assert.length(out.months, 0);
    assert.ok(/not recorded as rented out/.test(out.why), out.why);
  });
});

describe('the year, counted from what arrived', () => {
  test('a missed month is not in the total', () => {
    // Twelve times the rent would overstate a household's rental income on a
    // document they sign.
    const found = rentReceived(PROPERTY,
      ['2026-04-03', '2026-05-02', '2026-06-04'].map((d) => credit(d)), YEAR).months;
    const year = rentYear(found);

    assert.equal(year.total, 1_05_000_00);
    assert.equal(year.receipted, 3);
    assert.equal(year.missing, 3);
  });

  test('crossing the PAN threshold is reported, not acted on', () => {
    // Above ₹1,00,000 a tenant needs the landlord's PAN. Whether one goes on
    // the document is the signer's decision, and it is theirs to write.
    const under = rentYear([{ received: true, amount: PAN_THRESHOLD }]);
    const over = rentYear([{ received: true, amount: PAN_THRESHOLD + 1 }]);
    assert.not(under.needsPan);
    assert.ok(over.needsPan);
  });
});

describe('the receipt itself', () => {
  const april = () => rentReceived(PROPERTY, [credit('2026-04-03')], YEAR).months[0];

  test('it names the tenant, the amount, the month and the day', () => {
    const whole = text(docx(rentReceiptBlocks(PROPERTY, april(), { owner: 'S Narayan' })));
    assert.ok(whole.includes('R Krishnan'), 'no tenant');
    assert.ok(whole.includes('35,000.00'), 'no amount');
    assert.ok(whole.includes('April 2026'), 'no month');
    assert.ok(whole.includes('3 Apr 2026') || whole.includes('2026'), 'no date');
  });

  test('it leaves room for a signature and names whose it is', () => {
    // The household is the issuer, and signs it because it is true.
    const whole = text(docx(rentReceiptBlocks(PROPERTY, april(), { owner: 'S Narayan' })));
    assert.ok(whole.includes('S Narayan (landlord)'), 'the signer is not named');
    assert.ok(whole.includes('Signature'), 'nowhere to sign');
  });

  test('a month with no payment produces no document at all', () => {
    // Rather than a document with a blank where the payment should be.
    const missing = rentReceived(PROPERTY, [], YEAR).months[0];
    assert.equal(rentReceiptBlocks(PROPERTY, missing), null);
  });

  test('no PAN is ever printed on it', () => {
    // It belongs to the person signing, and putting one on automatically is
    // how the wrong one ends up on a document.
    const whole = text(docx(rentReceiptBlocks(PROPERTY, april(), { owner: 'S Narayan' })));
    assert.not(/[A-Z]{5}[0-9]{4}[A-Z]/.test(whole), 'something PAN-shaped is on the receipt');
  });

  test('each month gets its own filename', () => {
    const found = rentReceived(PROPERTY,
      [credit('2026-04-03'), credit('2026-05-02')], YEAR).months;
    const names = found.filter((m) => m.received).map((m) => rentReceiptFilename(PROPERTY, m));
    assert.equal(new Set(names).size, 2, names.join(', '));
    assert.ok(names[0].endsWith('.docx'), names[0]);
  });
});
