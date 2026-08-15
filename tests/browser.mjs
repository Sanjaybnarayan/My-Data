#!/usr/bin/env node
/**
 * The browser smoke test.
 *
 *   node tests/browser.mjs [--shots]
 *
 * The unit suite runs the data, security, sync, domain and report layers
 * directly, because they are DOM-free. Nothing in it can tell you the
 * application actually *opens* — that a module fails to import, that a CSP
 * directive blocks its own scripts, that the first render throws on a fresh
 * database with no records in it. Those are exactly the failures that ship.
 *
 * So this drives a real Chromium against a real server: enrol a PIN, get past
 * the recovery screen, land on the dashboard, add a record through the real
 * form, and walk every module looking for a page that throws or comes back
 * empty. Any console error or unhandled rejection fails the run.
 *
 * Separate from `run.mjs` because it needs a browser, and the unit suite must
 * stay runnable anywhere with nothing installed.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8247;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv.includes('--shots');
const PIN = '482913';

const failures = [];
const checks = [];

/** Navigate by changing the hash, which is what following a link does. */
async function go(page, hash) {
  await page.evaluate((h) => { globalThis.location.hash = h; }, hash);
  await page.waitForTimeout(450);
}

/**
 * Today, formatted the way `core/dates.js` formats a day.
 *
 * Kept in step with `formatDay` by hand, which is a small duplication and the
 * right one: importing the application's formatter to check the application's
 * output would make the assertion agree with itself no matter what either did.
 */
function todayLabel() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * A real, if minimal, PDF with a text layer.
 *
 * The other document checks upload a few bytes beginning `%PDF-`, which is
 * enough to exercise capture and filing and produces no text at all — so
 * nothing that reads a document was ever driven end to end. This is
 * uncompressed and hand-assembled so it stays readable: five objects, a
 * content stream of `Tj` runs, and a valid xref.
 */
function tinyPdf(lines) {
  const content = `BT /F1 12 Tf 50 750 Td 14 TL\n${
    lines.map((l) => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join('\n')}\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) failures.push(`${name}${detail ? ` \u2014 ${detail}` : ''}`);
}

async function main() {
  const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.once('data', resolve));

  // `PLAYWRIGHT_CHROMIUM_PATH` lets a machine with a system Chromium — or a
  // build that does not match this Playwright's pinned revision — run the
  // suite without downloading a second browser.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // A failed request logs a message with no URL in it, so it cannot be
    // judged here. The response listener below catches 404s by URL instead.
    if (/Failed to load resource/i.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message}`));

  // A bare "Failed to load resource" says nothing; the URL says everything.
  // `familyos.config.json` is expected to be absent on an unconfigured install.
  const missing = [];
  page.on('response', (response) => {
    if (response.status() !== 404) return;
    if (/familyos\.config\.json/.test(response.url())) return;
    missing.push(response.url());
  });

  try {
    /* ------------------------------------------------------ first run */

    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    check('the app boots to the enrolment screen',
      await page.locator('text=Choose a PIN').isVisible());

    // Asked here, on a first visit, and not later — which is the whole point.
    // Registration used to happen at the end of `start()`, so it never ran
    // until somebody had chosen a PIN and cleared enrolment. A browser decides
    // installability by looking for a registered worker, so a first-time
    // visitor was never offered "Install app", and the shell was uncached
    // until after enrolment. Checked after unlocking, both placements look
    // identical and the regression sails through.
    check('a service worker is registered before anyone has enrolled',
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then(Boolean)),
      'without one on the first visit, a browser never offers to install the app');

    // With no Google client id configured there is nothing to sign in to, and
    // a "Continue with Google" button that could only fail would be worse than
    // no button at all. First run has to still work on a PIN alone.
    check('no Google option is offered when none is configured',
      (await page.getByRole('button', { name: 'Continue with Google' }).count()) === 0);
    check('and the keypad is still the way in',
      (await page.locator('.keypad').count()) === 1);

    for (const digit of PIN) await page.getByRole('button', { name: digit, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForTimeout(200);

    // Scoped to the card: the same words also reach the off-screen live
    // region, which is the accessibility layer doing its job, not a duplicate.
    check('the PIN is confirmed rather than accepted once',
      (await page.locator('.lock-card p[role="status"]').innerText())
        .includes('Enter the same PIN again'));

    for (const digit of PIN) await page.getByRole('button', { name: digit, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.waitForSelector('text=Your recovery phrase', { timeout: 10_000 });
    check('a recovery phrase is shown before the app opens', true);

    const proceed = page.getByRole('button', { name: 'I have written it down' });
    check('the recovery screen cannot be skipped', await proceed.isDisabled());
    await page.locator('#kit-ack').check();
    await proceed.click();

    /* ------------------------------------------------------ dashboard */

    await page.waitForSelector('.app-nav', { timeout: 15_000 });
    check('the shell renders after unlocking', await page.locator('.app-nav').isVisible());
    await page.waitForSelector('.app-content .card', { timeout: 10_000 });
    check('the dashboard says something rather than showing an empty grid',
      (await page.locator('.card').count()) > 0);
    if (SHOTS) await shot(page, 'dashboard');

    /* ---------------------------------------------------- add a record */

    await go(page, '#/finance/account');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Add/ }).first().click();
    await page.waitForSelector('.modal', { timeout: 5000 });

    // Submitting an empty form must be refused by the same validator the
    // repository uses, and must say which field.
    await page.locator('#f-account-name').press('Enter');
    await page.waitForTimeout(250);
    check('an invalid save is refused with a reason',
      (await page.locator('.modal .field-error:visible').count()) > 0);

    await page.locator('#f-account-name').fill('HDFC Savings');
    await page.locator('#f-account-institution').fill('HDFC Bank');
    // A real number, because the payment-app import matches an instrument by
    // the digits its mask leaves — `XXXXXXXX8177` has to find this account.
    await page.locator('#f-account-accountNumber').fill('50100128177');
    await page.locator('#f-account-openingBalance').fill('25000');
    check('the form offers an enabled submit button',
      await page.locator('.modal button[type="submit"]').isEnabled());
    await page.locator('#f-account-name').press('Enter');

    await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(400);
    check('the saved record appears in the list',
      await page.locator('text=HDFC Savings').first().isVisible());

    /* -------------------------------------------------------- survives */

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('text=Welcome back', { timeout: 10_000 });
    check('a reload relocks rather than staying open', true);

    for (const digit of PIN) await page.getByRole('button', { name: digit, exact: true }).click();
    await page.waitForSelector('.app-nav', { timeout: 10_000 });

    await go(page, '#/finance/account');
    await page.waitForTimeout(400);
    check('the record survived the reload',
      await page.locator('text=HDFC Savings').first().isVisible());

    /* --------------------------------------------------- every module */

    const modules = ['dashboard', 'identity', 'family', 'finance', 'investments',
      'documents', 'vehicles', 'health', 'insurance', 'property', 'education',
      'tasks', 'calendar', 'notes', 'vault', 'digital', 'emergency', 'reports',
      'assistant', 'settings'];

    for (const module of modules) {
      const before = consoleErrors.length;
      await go(page, `#/${module}`);
      await page.waitForTimeout(350);

      const body = (await page.locator('.app-content').innerText()).trim();
      check(`${module} renders something`, body.length > 0, 'the screen came back empty');
      check(`${module} renders without a console error`, consoleErrors.length === before,
        consoleErrors.slice(before).join(' | '));
      if (SHOTS) await shot(page, module);
    }

    /* ------------------------------------------------ portfolio, via service */

    {
      // `investments renders something` above passes on the *empty* state, so
      // it would keep passing if the service returned nothing at all. This
      // drives a real holding through the form and reads the numbers back.
      const before = consoleErrors.length;

      await go(page, '#/investments/holding');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });

      await page.locator('#f-holding-name').fill('Index fund');
      await page.locator('#f-holding-kind').selectOption('mutual fund');
      await page.locator('#f-holding-invested').fill('100000');
      await page.locator('#f-holding-currentValue').fill('130000');
      await page.locator('#f-holding-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/investments');
      await page.waitForTimeout(500);
      const body = (await page.locator('.app-content').innerText()).trim();

      check('the portfolio shows a holding rather than the empty state',
        !/No investments yet/.test(body) && /Index fund/.test(body), body.slice(0, 400));

      // Counted before it is read. `innerText()` on a locator that matches
      // nothing waits thirty seconds and then throws, which aborts every check
      // after this one — so a service returning nothing would take the suite
      // down rather than fail a named check. Found by doing exactly that.
      const row = page.locator('.list-item', { hasText: 'Index fund' }).first();
      const holdingRow = (await row.count()) ? await row.innerText() : '';

      // The assembly the service now owns: 130,000 against 100,000 invested is
      // a 30% gain, and the screen renders it from the service's answer rather
      // than computing it itself.
      check('and the gain the service computed', /\+30%/.test(holdingRow), holdingRow || '(no row)');

      // A holding with no dated transactions has no rate. `0% XIRR` would read
      // as "this investment is flat" rather than "nothing here can say".
      check('and no XIRR, because two dated flows are needed for one',
        Boolean(holdingRow) && !/XIRR/.test(holdingRow), holdingRow || '(no row)');

      check('the portfolio renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'investments-portfolio');
    }

    /* ------------------------------------- a deposit whose value never grew */

    {
      // The loan bug in a mirror: `currentValue` is typed once and nothing
      // moves it, so a fixed deposit reports a gain of zero for as long as
      // nobody revisits it. Driven through the form, because the arithmetic
      // being right in a unit test says nothing about whether a household ever
      // sees it.
      const before = consoleErrors.length;

      await go(page, '#/investments/holding');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });

      await page.locator('#f-holding-name').fill('SBI deposit');
      await page.locator('#f-holding-kind').selectOption('fixed deposit');
      await page.locator('#f-holding-invested').fill('500000');
      await page.locator('#f-holding-currentValue').fill('500000');
      await page.locator('#f-holding-valuedOn').fill('2020-01-01');
      await page.locator('#f-holding-interestRate').fill('7.1');
      await page.locator('#f-holding-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      // The purchase that opened it. Without a dated flow there is no rate at
      // all, so the XIRR check below would pass on an absent badge — which is
      // exactly how it first passed while the fix was reverted.
      await go(page, '#/investments/investmentTransaction');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-investmentTransaction-holding')
        .selectOption({ label: 'SBI deposit' });
      await page.locator('#f-investmentTransaction-kind').selectOption('buy');
      await page.locator('#f-investmentTransaction-date').fill('2020-01-01');
      await page.locator('#f-investmentTransaction-amount').fill('500000');
      await page.locator('#f-investmentTransaction-amount').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/investments');
      await page.waitForTimeout(500);

      const cardEl = page.locator('.accrual-card');
      const said = (await cardEl.count()) ? await cardEl.innerText() : '';

      check('a deposit left alone is reported as worth more than recorded',
        said.includes('SBI deposit'), said.slice(0, 300) || '(no card)');

      // The date the figure was last true, and how often the estimate assumed
      // it compounds. The assumption is the part most likely to be wrong, so
      // it is on the screen rather than buried.
      check('and the estimate says what it assumed',
        said.includes('2020-01-01') && /quarterly/.test(said), said.slice(0, 300));

      // An estimate presenting itself as the answer would have a household
      // arguing with their bank using a number this application made up.
      check('and never claims to be the bank’s figure',
        /bank['’]s figure is the one that counts/.test(said)
        && /Update the value from the bank/.test(said), said.slice(0, 400));

      // The stored figure is untouched, and the two sit on the same screen.
      // Writing the estimate back would make the holding record disagree with
      // the bank for reasons nobody could see.
      const stored = page.locator('.holdings-card .list-item', { hasText: 'SBI deposit' }).first();
      const storedRow = (await stored.count()) ? await stored.innerText() : '';
      check('and the recorded value is left exactly as it was',
        /5,00,000/.test(storedRow) && /\+?0%/.test(storedRow), storedRow || '(no row)');

      // A rate worked out from a stale closing value is not slightly wrong, it
      // is meaningless — this deposit reported 0% while paying 7.1%. The rate
      // now comes from the accrual estimate, and the row says so.
      // Positive rather than negative: an absent badge is not a passing
      // result. The rate has to be there, non-zero, and marked as an estimate.
      check('and the rate is a real one rather than 0% on a deposit that is earning',
        /XIRR est\./.test(storedRow) && !/\b0% XIRR/.test(storedRow),
        storedRow || '(no row)');

      check('the deposit check renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'investments-accrual');
    }

    /* ------------------------ a recurring deposit, valued from its instalments */

    {
      // An RD was refused outright by the first version of the accrual work,
      // on the false grounds that its schedule was not recorded. It is: each
      // instalment is an investment transaction. This drives three of them
      // through the real forms, which is the only way to prove the holding and
      // its transactions are joined up the way the estimate assumes.
      const before = consoleErrors.length;

      await go(page, '#/investments/holding');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });

      await page.locator('#f-holding-name').fill('HDFC recurring');
      await page.locator('#f-holding-kind').selectOption('recurring deposit');
      await page.locator('#f-holding-invested').fill('150000');
      await page.locator('#f-holding-currentValue').fill('150000');
      await page.locator('#f-holding-valuedOn').fill('2021-01-01');
      await page.locator('#f-holding-interestRate').fill('6.8');
      await page.locator('#f-holding-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      // Before any instalment exists it must say so rather than go quiet.
      await go(page, '#/investments');
      await page.waitForTimeout(500);
      const bare = page.locator('.accrual-card');
      const bareText = (await bare.count()) ? await bare.innerText() : '';
      check('a recurring deposit with no instalments says what is missing',
        /no instalments are recorded/.test(bareText) && /add them/.test(bareText),
        bareText.slice(0, 300) || '(no card)');

      for (const date of ['2021-01-05', '2021-02-05', '2021-03-05']) {
        await go(page, '#/investments/investmentTransaction');
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /Add/ }).first().click();
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-investmentTransaction-holding')
          .selectOption({ label: 'HDFC recurring' });
        await page.locator('#f-investmentTransaction-kind').selectOption('contribution');
        await page.locator('#f-investmentTransaction-date').fill(date);
        await page.locator('#f-investmentTransaction-amount').fill('50000');
        await page.locator('#f-investmentTransaction-amount').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      }

      await go(page, '#/investments');
      await page.waitForTimeout(600);
      const withThem = page.locator('.accrual-card');
      const said = (await withThem.count()) ? await withThem.innerText() : '';

      check('and once they exist it is valued from them',
        /3 instalments/.test(said) && /each earning from the day it went in/.test(said),
        said.slice(0, 400) || '(no card)');

      // The distinction the whole thing rests on. Naming a date the value was
      // true would be describing a figure nobody typed.
      check('and dates them from the first instalment, not from the holding',
        said.includes('2021-01-05') && !said.includes('2021-01-01'), said.slice(0, 400));

      check('the recurring deposit check renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'investments-recurring');
    }

    /* ------------------------------------------- importing statements */

    {
      const before = consoleErrors.length;
      await go(page, '#/finance/import');
      await page.waitForTimeout(400);

      const body = (await page.locator('.app-content').innerText()).trim();
      check('the statement importer renders', /Import statements/i.test(body));
      check('the importer explains itself before anything is loaded',
        /matched to an account/i.test(body), body.slice(0, 200));
      check('the importer loads without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      // The PDF reader is the part that only exists in a browser — Node has
      // zlib, a browser has DecompressionStream, and this is the only place
      // the second one actually runs.
      const decoded = await page.evaluate(async () => {
        const { inflate } = await import('./js/data/pdf-read.js');
        const original = new TextEncoder().encode('column x, column y, balance');
        const compressed = await new Response(
          new Blob([original]).stream().pipeThrough(new CompressionStream('deflate')),
        ).arrayBuffer();
        const out = await inflate(new Uint8Array(compressed));
        return out ? new TextDecoder().decode(out) : null;
      });
      check('the PDF reader can decompress in the browser',
        decoded === 'column x, column y, balance', String(decoded));

      // A real CSV through the real file input. The parse and the plan are
      // covered by unit tests; what only a browser can show is that a File
      // reaches them at all.
      await page.locator('#app input[type=file][accept*="csv"]').setInputFiles({
        name: 'kotak-may.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from([
          'Account No: 1234500000',
          '',
          'Date,Narration,Withdrawal,Deposit,Balance',
          '01/05/2026,"UPI/ZOMATO LTD/1001/order",645.00,,9355.00',
          '02/05/2026,"NEFT SALARY CREDIT",,50000.00,59355.00',
        ].join('\n')),
      });
      await page.waitForTimeout(700);

      const csv = (await page.locator('.app-content').innerText()).trim();
      check('a CSV statement is read', /kotak-may\.csv/.test(csv), csv.slice(0, 300));
      check('a CSV says it was read from a table, not by column',
        /read from a table/i.test(csv), csv.slice(0, 600));
      check('reading a CSV raises no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      // A payment app's export: not one account's statement, but every
      // account the app is linked to, and every row a movement the bank
      // recorded too. Both facts have to reach the screen.
      await page.locator('#app input[type=file][accept*="csv"]').setInputFiles({
        name: 'PhonePe_Statement.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from([
          'Transaction Statement for 8861975785',
          'Duration,"01 Apr, 2026 - 15 Aug, 2026"',
          '',
          'Date,Time,Transaction Details,Transaction ID,UTR,Transaction Type,'
            + 'Credit/debit instrument,Amount',
          '"Aug 15, 2026","01:10 am","Paid to ZOMATO LIMITED","T2608150110",'
            + '"618037311994","DEBIT","Paid by XXXXXXXX8177","69"',
          '"Aug 14, 2026","09:11 pm","Received from ROOPESH K","T2608142111",'
            + '"659278215400","CREDIT","Credited to XXXXXXXXXX84","680"',
          '"Aug 05, 2026","10:00 am","Loan Installment","T2608051000",'
            + '"111111111111","DEBIT","Paid by XXXXXXXX8963","4500"',
          '"Aug 03, 2026","10:00 am","Transfer to XXXXXXXX8177","T2608031000",'
            + '"333333333333","DEBIT","Paid by XXXXXXXXXX84","2000"',
        ].join('\n')),
      });
      await page.waitForTimeout(900);

      const app = (await page.locator('.app-content').innerText()).trim();

      // Every row of a month-first-dated file used to be skipped for having
      // no readable date, so the file imported as nothing at all.
      check('a payment app export is read rather than coming back empty',
        /PhonePe_Statement\.csv/.test(app) && !/may not be a statement/.test(app),
        app.slice(0, 500));

      check('and the screen says it is a payment app, not an account',
        /payment app.s record, not an account/i.test(app), app.slice(0, 900));
      check('and names how many of the household’s accounts it spans',
        /3 accounts/.test(app), app.slice(0, 900));
      // The dangerous case: import this first, the bank statements later, and
      // every payment arrives a second time.
      check('and warns that the same payments will arrive from the other side',
        /arrive again from the other side/i.test(app), app.slice(0, 900));

      // The split. An HDFC Savings account was created earlier in this run
      // ending 8177, so that group files; the others do not, and the screen
      // has to say which and why rather than filing them against a guess.
      check('rows are filed against the account they actually moved on',
        /to HDFC Savings/.test(app), app.slice(0, 1200));
      check('and an instrument matching no account is refused, with a reason',
        /cannot be imported/.test(app), app.slice(0, 1200));
      check('a mask too short to identify an account says so',
        /not enough to tell/.test(app), app.slice(0, 1200));

      // A `Transfer to XXXXXXXX8177` row names both ends of one movement, so
      // it is money moving between the household's own accounts rather than
      // spending. `domain/events.js` can only call such a pair *probable*,
      // because a bank statement names one side; this record names both.
      check('a self-transfer naming both ends is counted as movement, not spending',
        /transfers? between the household.s own accounts/.test(app), app.slice(0, 1400));

      check('reading a payment app export raises no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-import');
    }

    /* ------------------------------------------------ receipts from mail */

    {
      const before = consoleErrors.length;
      await go(page, '#/finance/shops');
      await page.waitForTimeout(400);

      const body = (await page.locator('.app-content').innerText()).trim();
      check('the shops screen renders', /Read receipts from Gmail/i.test(body));

      // The claim this screen makes about itself has to survive contact with
      // the screen. If the query stops being printed, the only meaningful
      // limit on what gets read stops being visible.
      check('the query it will run is shown before it runs',
        /from:zomato\.com/i.test(body) && /-in:trash/.test(body), body.slice(0, 400));
      check('it says plainly that account linking is not on offer',
        /do not offer one|will not hold those passwords/i.test(body));
      check('the shops screen loads without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      // A household shop, added through the real input, has to reach the real
      // query — that is the whole of "and much more".
      await page.locator('input[aria-label="Sender domain"]').fill('thelocalbakery.in');
      await page.locator('input[aria-label="Shop name"]').fill('The Local Bakery');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.waitForTimeout(200);

      const after = (await page.locator('.app-content').innerText()).trim();
      check('a shop the household names joins the query',
        /from:thelocalbakery\.in/.test(after), after.slice(0, 400));

      // Adding a mailbox is a sign-in, and the cost of that sign-in is stated
      // on the same screen rather than in a document nobody opens.
      check('a mailbox is added by signing in',
        /Add a Gmail account/.test(after), after.slice(0, 600));
      check('what the sign-in costs is said where it is offered',
        /holds a Gmail token/i.test(after), after.slice(0, 900));
      check('a mailbox is described as mail only',
        /answers mail searches and\s+nothing else/i.test(after), after.slice(0, 900));

      // The deployment route is folded away rather than removed: it is the
      // only way to read a second mailbox without a Gmail token in the page.
      await page.locator('summary', { hasText: 'deployment instead of signing in' }).click();
      await page.waitForTimeout(150);

      // A wrong URL has to fail here rather than as an empty scan later.
      await page.locator('input[aria-label="Apps Script deployment URL"]').fill('someone@gmail.com');
      await page.getByRole('button', { name: 'Connect' }).click();
      await page.waitForTimeout(300);
      check('a mailbox that is not a deployment URL is refused',
        /not an Apps Script deployment URL/i.test(await page.locator('body').innerText()));

      if (SHOTS) await shot(page, 'finance-shops');
    }

    /* ------------------------------------------------------------ privacy */

    {
      const before = consoleErrors.length;
      await go(page, '#/settings');
      await page.waitForTimeout(500);

      const body = (await page.locator('.app-content').innerText()).trim();
      check('Settings answers where the data is', /Privacy/.test(body), body.slice(0, 200));
      check('and offers to keep it on this device',
        (await page.getByRole('button', { name: 'Keep everything local' }).count()) === 1);

      // The sentence that stops somebody assuming more than is true. If this
      // ever stops being shown, the application is overclaiming.
      check('it says plainly that not every field is encrypted',
        /fields are ciphertext/.test(body), body.slice(0, 900));
      check('it can be inspected field by field',
        (await page.getByRole('button', { name: 'Show me field by field' }).count()) === 1);

      await page.getByRole('button', { name: 'Show me field by field' }).click();
      await page.waitForTimeout(250);
      check('and inspecting names real entities',
        /sealed/.test(await page.locator('.app-content').innerText()));

      // The device registry existed for a tranche with no way to reach it: an
      // owner had to call the endpoint by hand to sign out a lost phone, which
      // is a capability rather than a feature.
      check('Settings lists the devices this household syncs from',
        /Devices/.test(body) && /Where this household has signed in from/.test(body),
        body.slice(0, 1200));

      // With no backend configured there is nothing to list, and saying so is
      // the honest answer — an empty card would read as "no devices".
      check('and says why the list is empty rather than showing nothing',
        /there are no devices to list|Nothing has synced yet/.test(body), body.slice(0, 1200));

      check('the privacy card loads without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      // The scopes were declared in four files and described in a fifth, in
      // prose, which is how the setup page came to say the browser never
      // reads mail. This is the list that cannot drift from what the code
      // asks for, in front of the person doing the configuring.
      check('Settings lists the Google permissions to add',
        /Google permissions/.test(body), body.slice(0, 400));
      check('and names the console page they go on',
        /OAuth consent screen/.test(body));
      check('and marks the optional ones as optional',
        (await page.locator('.badge', { hasText: 'optional' }).count()) >= 2);
      check('and says drive.appdata is not needed',
        /do not need drive\.appdata/i.test(body), body.slice(0, 1200));

      // The tightening that matters: an ordinary sign-in asks who you are and
      // nothing else, so the required list must not name a Google API.
      const required = await page.locator('.card', { hasText: 'Google permissions' })
        .locator('.list').first().innerText();
      check('the required permissions are identity only',
        !/drive|spreadsheets|gmail/i.test(required), required);

      // The commonest sign-in failure is not a scope at all: the OAuth client
      // does not list where this copy is served from. Google shows its own
      // error inside the popup and the app can only tell that a window shut,
      // so the two strings that have to match are printed rather than
      // described.
      check('the origin and redirect URI are shown, exactly',
        body.includes('Authorised redirect URI')
        && body.includes('/oauth-callback.html'), body.slice(0, 1600));

      // Which ways in this device actually has. The question this card exists
      // to answer is "how do I get back in", and a household that never
      // printed a recovery phrase should find that out here rather than on
      // the morning they need it.
      check('Settings says what unlocks this device',
        /This device unlocks with/.test(body), body.slice(0, 400));

      const security = await page.locator('.card', { hasText: 'This device unlocks with' })
        .innerText();
      check('and names the PIN this run enrolled', /PIN/.test(security), security);
      check('and does not warn about a recovery phrase that exists',
        !/No recovery phrase\./.test(security), security);

      if (SHOTS) await shot(page, 'settings-privacy');
    }

    /* ------------------------------------------------------------ consent */

    {
      const before = consoleErrors.length;
      const consent = await page.locator('.card', { hasText: 'What you agreed to' });

      check('Settings says what was agreed to', (await consent.count()) === 1);
      const text = await consent.innerText();

      // The finding this card exists to fix: keeping a copy of every record in
      // a spreadsheet is the most consequential thing here, and until this
      // card there was no point anywhere at which anybody was asked.
      check('and admits nobody was ever asked about the backup',
        /never been asked/.test(text), text.slice(0, 600));

      // This copy is unconfigured, so nothing is actually happening yet — and
      // the card must say that rather than manufacturing an alarm.
      check('and does not claim a gap when nothing is happening',
        /Every active purpose has an answer/.test(text), text.slice(0, 300));

      // The one people assume phones home. It is listed precisely because it
      // does not, and it must not be offered a decision that changes nothing.
      check('the assistant is listed as having nothing to agree to',
        /Nothing to agree to/.test(text), text.slice(0, 900));

      check('the host is named, though it never sees a record',
        /Whoever serves the page/.test(text) || (await consent.locator('details').count()) === 1);

      // Pressing it must write a record, not merely repaint. The proof is that
      // the row changes from an unanswered one to a dated decision and the
      // control becomes the way back out.
      const agree = consent.getByRole('button', { name: 'Agree' }).first();
      check('an unanswered purpose can be agreed to', (await agree.count()) === 1);
      await agree.click();
      await page.waitForTimeout(400);

      const after = await page.locator('.card', { hasText: 'What you agreed to' }).innerText();
      check('agreeing records a decision that can be withdrawn again',
        /granted/.test(after)
        && (await page.locator('.card', { hasText: 'What you agreed to' })
          .getByRole('button', { name: 'Stop' }).count()) >= 1,
        after.slice(0, 600));

      check('the consent card loads and records without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'settings-consent');
    }

    /* ------------------------------------------------ masked identifiers */

    {
      const before = consoleErrors.length;

      // A passport number is the case the whole classification layer was built
      // for: sensitive, an identifier, and a list column — so before this it
      // was printed in full on a screen anyone walking past could read.
      const docId = await page.evaluate(async () => {
        const { app } = await import('./js/context.js');
        const people = await app().db.repo('person').list({ limit: 1 });
        const doc = await app().db.repo('identityDocument').create({
          person: people[0]?.id ?? '', kind: 'Passport', number: 'Z1234567',
          issuedBy: 'RPO Bengaluru', expiresOn: '2032-01-01',
        });
        return doc.id;
      });

      await go(page, '#/identity/identityDocument');
      await page.waitForTimeout(500);
      const list = await page.locator('.app-content').innerText();

      check('a document number is not printed in full in a list',
        !list.includes('Z1234567'), list.slice(0, 200));
      check('but enough of it shows to tell two documents apart',
        /4567/.test(list), list.slice(0, 200));

      await go(page, `#/identity/identityDocument/${docId}`);
      await page.waitForTimeout(500);
      const detail = await page.locator('.app-content').innerText();
      check('and it is covered on the record too', !detail.includes('Z1234567'),
        detail.slice(0, 200));

      // Covered is only half of it — a number nobody can read is a number
      // nobody can use. The same control that hides it must hand it over.
      const show = page.getByRole('button', { name: /^Show / });
      if (await show.count()) {
        await show.first().click();
        await page.waitForTimeout(300);
        check('and one press hands it over',
          (await page.locator('.app-content').innerText()).includes('Z1234567'));
      } else {
        check('and one press hands it over', false, 'no reveal control was rendered');
      }

      check('masking draws without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    /* --------------------------------------------------- the transactions */

    {
      const before = consoleErrors.length;

      // Real transactions through the real form, so the ledger below has
      // something to align — and one of each direction, because a column that
      // only ever holds expenses proves nothing about the layout.
      for (const row of [
        { amount: '645', payee: 'ZOMATO LIMITED', kind: 'expense' },
        { amount: '50000', payee: 'ACME SOFTWARE PAYROLL', kind: 'income' },
        { amount: '2499', payee: 'BLINKIT COMMERCE PRIVATE LIMITED', kind: 'expense' },
      ]) {
        // Away first: setting the hash to the value it already holds fires no
        // `hashchange`, so the second pass would never re-open the form.
        await go(page, '#/finance/transaction');
        await go(page, '#/finance/transaction/new');
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-transaction-amount').fill(row.amount);
        await page.locator('#f-transaction-payee').fill(row.payee);
        await page.locator('#f-transaction-kind').selectOption(row.kind);
        // Account is required and does not default — the same validator the
        // repository uses refuses the save without it.
        await page.locator('#f-transaction-account').selectOption({ index: 1 });
        await page.locator('.modal button[type="submit"]').click();
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      }

      await go(page, '#/finance/transaction');
      await page.waitForTimeout(500);

      check('transactions render as a ledger, not the generic table',
        (await page.locator('table.table--ledger').count()) === 1);

      // The whole reason this screen exists: money in and money out are
      // separate columns. One signed column would make ₹645 arriving and
      // ₹645 leaving look identical.
      // Lower-cased because the heading style uppercases them, and what is
      // being asserted is the columns, not the typography.
      const headers = (await page.locator('table.table--ledger thead th').allInnerTexts())
        .map((text) => text.trim().toLowerCase());
      check('In and Out are separate columns',
        headers.includes('in') && headers.includes('out'), headers.join(' | '));
      check('a balance column runs beside them', headers.includes('balance'));

      // Row 0 is the Zomato expense, row 1 the salary. Cell 0 of each row is
      // In and cell 1 is Out, so this is the layout's whole claim in two
      // assertions: an expense is only ever on the right of the pair, and
      // money arriving is only ever on the left.
      const cell = (rowIndex, which) => page.locator('.ledger-row').nth(rowIndex)
        .locator('td.col--amount').nth(which);


      check('an expense lands in Out and leaves In empty',
        (await cell(0, 1).innerText()).includes('645')
        && (await cell(0, 0).innerText()).trim() === '');
      check('income lands in In and leaves Out empty',
        (await cell(1, 0).innerText()).includes('50,000')
        && (await cell(1, 1).innerText()).trim() === '');

      // A month of statements repeats one date down twenty rows. A heading says
      // it once, and carries that day's own totals.
      check('rows are grouped under a day heading',
        (await page.locator('.ledger-day').count()) > 0);
      // Against today, not against a date typed into the test. These rows are
      // created through the form with no date, so they carry today's — and the
      // assertion used to name the day it was written on, which meant it
      // passed for one day and failed on every day after it.
      check('the heading carries the day and not just a rule',
        (await page.locator('.ledger-day').first().innerText()).includes(todayLabel()),
        `expected ${todayLabel()}`);
      check('the date is not then repeated on every row beneath it',
        !/2026/.test(await page.locator('.ledger-row').first().locator('.col--date').innerText()));

      // Grouped by day while sorted by amount would be a heading per row.
      await page.locator('table.table--ledger thead th').nth(4).click();
      await page.waitForTimeout(300);
      check('sorting by something else drops the headings',
        (await page.locator('.ledger-day').count()) === 0);
      check('and the date comes back into the row',
        /2026/.test(await page.locator('.ledger-row').first().locator('.col--date').innerText()));

      await page.locator('table.table--ledger thead th').first().click();
      await page.waitForTimeout(300);

      // Banding has to come from the row's own position: an opened row adds a
      // sibling to the same tbody, and `:nth-child` stripes would flip below it.
      const banded = await page.locator('.ledger-row--band').count();
      check('rows are banded so the eye holds one row across seven columns',
        banded > 0, String(banded));

      // Figures have to line up by place value or a column of them is
      // unreadable, which is the entire argument for the layout.
      const numeric = await page.locator('.ledger-row td.col--amount').nth(1).evaluate(
        (node) => getComputedStyle(node).fontVariantNumeric,
      );
      check('amounts use tabular figures so digits align', /tabular-nums/.test(numeric), numeric);

      // Under `table-layout: fixed` a `min-width` is ignored, so the most
      // informative column is exactly as wide as it was told to be and not a
      // pixel more. It has to be the widest thing on the row.
      const widths = await page.locator('.ledger-row').first().evaluate((row) => {
        const width = (selector) => row.querySelector(selector)?.getBoundingClientRect().width ?? 0;
        return { description: width('.col--description'), account: width('.col--account') };
      });
      check('the description column is the one that gets the space',
        widths.description > widths.account, JSON.stringify(widths));

      // A fixed column does not grow for its content — it spills into its
      // neighbour, which is how "9 Aug 2026" and a payee ended up printed as
      // one word. Nothing may be wider than the cell holding it.
      const spill = await page.locator('.ledger-row').first().evaluate((row) => [...row.cells]
        .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
        .map((cell) => `${cell.className}: ${cell.scrollWidth} > ${cell.clientWidth}`));
      check('no column overflows into the one beside it', spill.length === 0, spill.join(' | '));

      // A row opens in place rather than navigating, because comparing it
      // against its neighbours is why somebody opened it.
      check('no row is open to begin with', (await page.locator('.ledger-detail').count()) === 0);
      await page.locator('.ledger-row').first().click();
      await page.waitForTimeout(250);
      check('clicking a row opens its detail in place',
        (await page.locator('.ledger-detail').count()) === 1);
      check('the opened row stays on the same screen',
        (await page.locator('table.table--ledger').count()) === 1);
      check('the opened row offers a category without a form',
        (await page.locator('.ledger-detail-actions select').count()) === 1);

      await page.locator('.ledger-row').first().click();
      await page.waitForTimeout(250);
      check('clicking again closes it', (await page.locator('.ledger-detail').count()) === 0);

      // Filters that changed the list but not the sums would be a way to read
      // the wrong number confidently.
      await page.locator('input[aria-label="Search transactions"]').fill('nothing matches this');
      await page.waitForTimeout(300);
      check('a filter that matches nothing says so rather than showing everything',
        /Nothing matches those filters/i.test(await page.locator('.app-content').innerText()));
      await page.locator('input[aria-label="Search transactions"]').fill('');
      await page.waitForTimeout(300);

      check('the transactions ledger loads without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-transactions');

      // A phone cannot show seven columns, and a ledger squeezed into one is
      // worse than a stack of cards. What must survive the squeeze is the one
      // alignment that matters: the figure stays on the right of the payee.
      await page.setViewportSize({ width: 400, height: 900 });
      await page.waitForTimeout(400);

      const stacked = await page.locator('.ledger-row').first().evaluate((row) => {
        const description = row.querySelector('.col--description');
        const figures = [...row.querySelectorAll('.col--amount')]
          .filter((cell) => cell.textContent.trim());
        return {
          columns: getComputedStyle(row).display,
          shown: figures.length,
          right: figures.length
            ? figures[0].getBoundingClientRect().right > description.getBoundingClientRect().right
            : false,
          figure: figures[0]?.textContent.trim() ?? '',
          payee: row.querySelector('.ledger-payee')?.textContent.trim() ?? '',
          // What is drawn, not what is in the DOM: a cell clipped by its own
          // width still reports its full text content.
          clipped: [...row.cells].filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length,
        };
      });

      check('a phone stacks each row into a card', stacked.columns === 'grid', stacked.columns);
      check('exactly one money column survives the stack', stacked.shown === 1, String(stacked.shown));
      check('and it stays on the right, where an amount belongs', stacked.right);

      // The check above passed while every cell was clipped to two characters,
      // which is how a date read "9 A…" and an amount read "₹". Layout right
      // and content unreadable is still broken.
      check('the amount is legible and not clipped to its currency sign',
        stacked.figure.includes('645'), stacked.figure);
      check('the payee is legible', stacked.payee.includes('ZOMATO LIMITED'), stacked.payee);
      check('nothing on the card is clipped', stacked.clipped === 0, String(stacked.clipped));

      if (SHOTS) await shot(page, 'finance-transactions-phone');
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(300);
    }

    /* ------------------------------------------------- removing an import */

    {
      const before = consoleErrors.length;
      await go(page, '#/finance/bankStatement');
      await page.waitForTimeout(400);

      const body = (await page.locator('.app-content').innerText()).trim();
      check('imported files are listed as files', /Imported files/i.test(body), body.slice(0, 200));
      check('and it says removing one takes its transactions too',
        /Removing one removes\s+both/i.test(body), body.slice(0, 600));
      check('the imports screen loads without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-imports');
    }

    /* ------------------------------------------------------- the ledgers */

    {
      // These existed in domain/categorise.js from the beginning and were
      // reachable only from a command line. The point of the check is that
      // they are now reachable at all.
      for (const [tab, expected] of [
        ['people', /Person to person|No person-to-person|Nothing imported yet/i],
        ['lending', /Borrowing and lending|No borrowing|Nothing imported yet/i],
        ['insights', /Worth saying out loud|Nothing imported yet/i],
      ]) {
        const before = consoleErrors.length;
        await go(page, `#/finance/${tab}`);
        await page.waitForTimeout(400);

        const body = (await page.locator('.app-content').innerText()).trim();
        check(`the ${tab} ledger renders`, expected.test(body), body.slice(0, 200));
        check(`the ${tab} ledger loads without a console error`,
          consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
      }

      if (SHOTS) await shot(page, 'finance-insights');
    }

    /* -------------------------- a category chosen on the form is honoured */
    // Placed with the ledger checks and before the `.ledger-row` positional
    // ones below, for the same reason they warn about.
    {
      // This bug lives entirely on the form/importer seam, so a fixture cannot
      // show it: the whole point is what the *form* produces — a category
      // picked from a dropdown and no narration at all.
      const before = consoleErrors.length;

      await go(page, '#/finance/transaction/new');
      await page.waitForTimeout(600);
      await page.waitForSelector('.modal', { timeout: 5000 });

      await page.locator('#f-transaction-date').fill('2026-07-05');
      await page.locator('#f-transaction-kind').selectOption('expense');
      await page.locator('#f-transaction-amount').fill('12000');
      await page.locator('#f-transaction-category').selectOption('groceries');
      await page.locator('#f-transaction-payee').fill('Big Bazaar');
      // Required. Leaving it out keeps the modal open with no thrown error,
      // which is how the schema announces a missing field.
      await page.locator('#f-transaction-account').selectOption({ index: 1 });
      await page.locator('#f-transaction-payee').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/finance/people');
      await page.waitForTimeout(500);
      const people = (await page.locator('.app-content').innerText()).trim();

      // `looksLikePerson` reads any two capitalised words as a name, so before
      // this the supermarket sat in the people ledger as somebody the
      // household exchanges money with.
      check('a supermarket does not appear in the people ledger',
        !/Big Bazaar/i.test(people), people.slice(0, 400));

      await go(page, '#/finance/insights');
      await page.waitForTimeout(500);
      const said = (await page.locator('.app-content').innerText()).trim();

      check('and nothing says a shop has taken money that has not come back',
        !/people have taken more/i.test(said), said.slice(0, 500));

      check('the entered-category checks load without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    /* ------------------------------------------------- who paid, this month */

    {
      // `transaction.person` has been on every transaction since the schema was
      // written and read by nothing. Driven through the form because that is
      // the only place the field is offered — no importer sets it, which is
      // also why the coverage line below matters.
      const before = consoleErrors.length;

      await go(page, '#/finance/transaction/new');
      await page.waitForTimeout(600);
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-transaction-date').fill(
        new Date().toISOString().slice(0, 10),
      );
      await page.locator('#f-transaction-kind').selectOption('expense');
      await page.locator('#f-transaction-amount').fill('9000');
      await page.locator('#f-transaction-category').selectOption('groceries');
      await page.locator('#f-transaction-payee').fill('Monthly shop');
      await page.locator('#f-transaction-account').selectOption({ index: 1 });
      await page.locator('#f-transaction-person').selectOption({ index: 1 });
      await page.locator('#f-transaction-payee').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/finance');
      await page.waitForTimeout(700);
      const body = (await page.locator('.app-content').innerText()).trim();

      check('a payment with somebody recorded against it appears under who paid',
        /Who paid, this month/i.test(body), body.slice(0, 400));

      // The trap this design exists for. No importer sets `person`, so a
      // percentage read as a share of household spending would be wrong by
      // whatever fraction nobody filled in.
      check('and the figures say what they are a share of',
        /shares of what is tagged/i.test(body)
        || /Every payment this period has somebody recorded/i.test(body),
        body.slice(0, 600));

      // Somebody looking at a per-person breakdown is one step from asking who
      // owes whom. The honest answer is on the screen.
      check('and it says why who-owes-whom cannot be answered',
        /which costs are shared/i.test(body), body.slice(0, 600));

      check('the who-paid card renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    /* ------------------------------------ paying a card is not spending */
    // Placed after the ledger checks on purpose: those index `.ledger-row`
    // by position, so rows created earlier shift them. Found by breaking four
    // of them.

    {
      // Reachable through the form, unlike the transfer pairing: a card
      // account, a purchase on it, and a bill paid from the bank are three
      // ordinary records with no hidden fields involved.
      const before = consoleErrors.length;

      await go(page, '#/finance/account');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-account-name').fill('HDFC Card');
      await page.locator('#f-account-kind').selectOption('credit card');
      // Required once the kind is a card: "A credit card needs a limit for
      // utilisation to mean anything." A cross-field rule, so the modal simply
      // stays open without it — which is how this was found.
      await page.locator('#f-account-creditLimit').fill('100000');
      await page.locator('#f-account-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      const addSpend = async (accountLabel, category, amount) => {
        await go(page, '#/finance/transaction');
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /Add/ }).first().click();
        await page.waitForSelector('.modal', { timeout: 5000 });
        // The date is required and the form does not default it, so an
        // unfilled one is a silent validation failure that just leaves the
        // modal open. Today, so the row lands in the period Finance totals.
        await page.locator('#f-transaction-date').fill(
          new Date().toISOString().slice(0, 10),
        );
        await page.locator('#f-transaction-kind').selectOption('expense');
        await page.locator('#f-transaction-amount').fill(amount);
        await page.locator('#f-transaction-account').selectOption({ label: accountLabel });
        await page.locator('#f-transaction-category').selectOption(category);
        await page.locator('#f-transaction-payee').fill(category);
        await page.locator('#f-transaction-amount').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      };

      await addSpend('HDFC Card', 'groceries', '3000');       // spent on the card
      await addSpend('HDFC Savings', 'credit card', '5000');  // the bill for it

      await go(page, '#/finance');
      await page.waitForTimeout(600);
      const body = (await page.locator('.app-content').innerText()).trim();

      // The whole point: the bill is counted on top of the purchase it paid
      // for, and the screen has to say so next to the number it is about.
      check('the screen says a card bill is counted twice',
        /counts that money twice/.test(body), body.slice(0, 700));
      check('and gives the figure without it, not only the corrected one',
        /Spending without them is/.test(body), body.slice(0, 700));

      check('the settlement note renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      // A loan with real terms and one EMI against it. `loan.outstanding` is
      // typed once and nothing updates it, so net worth loses the whole EMI
      // every month while the debt it repaid stays put — the card says so.
      await go(page, '#/finance/loan');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-loan-name').fill('Home loan');
      await page.locator('#f-loan-kind').selectOption('home');
      await page.locator('#f-loan-principal').fill('5000000');
      await page.locator('#f-loan-outstanding').fill('5000000');
      await page.locator('#f-loan-interestRate').fill('8.5');
      await page.locator('#f-loan-emiAmount').fill('43391');
      await page.locator('#f-loan-startedOn').fill('2024-01-05');
      await page.locator('#f-loan-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await addSpend('HDFC Savings', 'EMI', '43391');

      await go(page, '#/finance');
      await page.waitForTimeout(600);
      const loanBody = (await page.locator('.app-content').innerText()).trim();

      check('a stale loan balance is reported against the loan',
        /still says/.test(loanBody), loanBody.slice(0, 800));
      check('and the lender is named as the authority, not this estimate',
        /lender.s statement is the figure that counts/.test(loanBody),
        loanBody.slice(0, 900));

      // The other half: an EMI is one payment made of two different things.
      // Said next to the spending figure, and phrased so it does not claim
      // that figure is wrong — it is a correct cash-flow number.
      check('the spending figure says how much of the EMI was a cost',
        /repaid the debt rather than being spent/.test(loanBody), loanBody.slice(0, 900));
      check('and says the principal is still the household’s money',
        /still yours/.test(loanBody), loanBody.slice(0, 900));

      if (SHOTS) await shot(page, 'finance-settlement');
    }

    /* ------------------------------------ when the card bill falls due */

    {
      // The card above was created without its billing days, which is exactly
      // the state a household is in when nothing warns them. Filling them in
      // through the same form should make the bill appear — and the check is
      // written positively (the amount is *there*) rather than as "the empty
      // state is gone", because an empty state can disappear for reasons that
      // have nothing to do with the fix.
      const before = consoleErrors.length;

      // The purchase above is dated today, so the statement has to cut today
      // or later for it to be on this bill. Cutting today and falling due ten
      // days later puts the bill inside the thirty-day window whatever the
      // date happens to be when this runs.
      const now = new Date();
      const statementDay = now.getUTCDate();
      const dueDate = new Date(now.getTime() + (10 * 86_400_000));
      const dueDay = dueDate.getUTCDate();

      await go(page, '#/finance/account');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /HDFC Card/ }).first().click()
        .catch(() => page.locator('text=HDFC Card').first().click());
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Edit' }).first().click();
      await page.waitForSelector('.modal', { timeout: 8000 });
      await page.locator('#f-account-statementDay').fill(String(statementDay));
      await page.locator('#f-account-dueDay').fill(String(dueDay));
      await page.locator('#f-account-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 });

      await go(page, '#/finance');
      await page.waitForTimeout(700);
      const cardBody = (await page.locator('.app-content').innerText()).trim();

      // ₹3,000 was spent on the card and nothing was transferred to it, so
      // that is the statement balance and the bill.
      const due = cardBody.slice(cardBody.indexOf('Due in the next 30 days'));
      check('a card with billing days recorded produces a bill',
        /HDFC Card bill/.test(due), due.slice(0, 500));
      check('and the bill carries the statement balance, not an empty row',
        /3,000/.test(due), due.slice(0, 500));
      check('and names the statement it came from',
        /from the statement of/.test(due), due.slice(0, 500));

      check('the card bill renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-card-bill');
    }

    /* ------------------- what the household is committed to every month */

    {
      // Two subscriptions through the real form on the Digital screen: one
      // that renews itself and one that does not. The Finance screen's
      // committed figure claimed to cover subscriptions and had never seen
      // one, and neither renewal appeared among the bills.
      const before = consoleErrors.length;

      const said = async () => (await page.locator('.app-content').innerText()).trim();
      const financeBody = async () => { await go(page, '#/finance'); await page.waitForTimeout(700); return said(); };

      const beforeText = await financeBody();
      const beforeFigure = /([\d,]+\.\d\d) a month is already committed/.exec(beforeText)?.[1];
      check('the committed figure is on the screen to begin with',
        Boolean(beforeFigure), beforeText.slice(0, 400));

      const addSubscription = async (name, amount, renewsIn, autoRenew) => {
        await go(page, '#/digital/subscription');
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /Add/ }).first().click();
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-subscription-name').fill(name);
        await page.locator('#f-subscription-amount').fill(amount);
        await page.locator('#f-subscription-renewsOn').fill(
          new Date(Date.now() + (renewsIn * 86_400_000)).toISOString().slice(0, 10),
        );
        // Defaulted on by the schema, so it only needs touching to turn off.
        if (!autoRenew) await page.locator('#f-subscription-autoRenew').uncheck();
        await page.locator('#f-subscription-name').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      };

      await addSubscription('Netflix', '649', 4, true);
      await addSubscription('Adobe CC', '4230', 9, false);

      const afterText = await financeBody();
      const afterFigure = /([\d,]+\.\d\d) a month is already committed/.exec(afterText)?.[1];

      const toNumber = (s) => Number(String(s).replace(/,/g, ''));
      check('a subscription raises the committed figure by its amount',
        toNumber(afterFigure) - toNumber(beforeFigure) === 649,
        `${beforeFigure} → ${afterFigure}`);

      check('and the sentence says how much of it is subscriptions',
        /is subscriptions that renew themselves/.test(afterText), afterText.slice(0, 700));

      // The one that does not renew is not committed money — it lapses. That
      // is the whole content of `autoRenew`, which nothing had ever read.
      check('one that does not renew itself is counted separately, not silently',
        /do not renew themselves/.test(afterText) && /4,230\.00/.test(afterText),
        afterText.slice(0, 900));

      const due = afterText.slice(afterText.indexOf('Due in the next 30 days'));
      check('a renewal appears among the bills, with its amount',
        /Netflix/.test(due) && /649\.00/.test(due), due.slice(0, 500));
      check('and the one that lapses says so rather than looking like a bill',
        /lapses unless renewed|stops on this date unless somebody renews it/.test(due),
        due.slice(0, 600));

      check('the commitment figure renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-commitments');
    }

    /* ------------------------------------------------------- documents */

    await go(page, '#/documents');
    // A real file through the real input: encrypt, store, and open the naming
    // form. Nothing here is stubbed except the bytes.
    await page.locator('input[type=file]:not([capture])').setInputFiles({
      name: 'HDFC bank statement Mar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% a small but real pdf\n'),
    });
    await page.waitForSelector('.modal', { timeout: 8000 });
    check('a captured file opens its naming form',
      (await page.locator('.modal').innerText()).includes('document'));

    await page.locator('#f-document-title').fill('March statement');
    await page.locator('#f-document-title').press('Enter');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 });
    await page.waitForTimeout(500);

    const documentsText = await page.locator('.app-content').innerText();
    check('the document appears in the library',
      documentsText.includes('March statement'), documentsText.slice(0, 160));
    check('a file filed itself by its name',
      documentsText.toLowerCase().includes('financial'), documentsText.slice(0, 200));
    check('a file with no person is filed under the household',
      documentsText.includes('Household'), documentsText.slice(0, 200));
    check('a file not yet in Drive says so rather than pretending',
      documentsText.includes('not yet in Drive') || documentsText.includes('on device only'));

    // Filing it to a person should move it out of Household and into their
    // folder, and the person filter should then find it there.
    await page.getByRole('button', { name: /March statement/ }).first().click()
      .catch(() => page.locator('text=March statement').first().click());
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.waitForSelector('.modal', { timeout: 8000 });
    await page.locator('#f-document-person').selectOption({ index: 1 });
    await page.locator('#f-document-title').press('Enter');
    await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 });
    await page.waitForTimeout(400);

    check('the detail screen names the folder the file is in',
      /File · (?!Household)/.test(await page.locator('.app-content').innerText()),
      (await page.locator('.app-content').innerText()).slice(0, 200));

    await go(page, '#/documents');
    const filedText = await page.locator('.app-content').innerText();
    check('the library groups documents by person',
      filedText.includes('Everyone'), filedText.slice(0, 200));
    check('a document assigned to a person leaves the household folder',
      !/Household \(\d+\)/.test(filedText), filedText.slice(0, 200));

    /* ------------------- the identifier a scan finds and used to discard */

    {
      // A PAN card with a real text layer, through the real capture path. The
      // number is read, kept out of the searchable field, and — until this
      // tranche — thrown away, while `identityDocument.number` stayed empty.
      const before = consoleErrors.length;
      const PAN = 'ABCDE1234F';

      await go(page, '#/documents');
      await page.waitForTimeout(400);
      await page.locator('input[type=file]:not([capture])').setInputFiles({
        name: 'PAN card.pdf',
        mimeType: 'application/pdf',
        buffer: tinyPdf([
          'INCOME TAX DEPARTMENT   GOVT. OF INDIA',
          'Permanent Account Number Card',
          PAN,
          'Name  A CITIZEN',
        ]),
      });
      await page.waitForSelector('.modal', { timeout: 8000 });
      await page.locator('#f-document-title').fill('PAN card');
      // Filed under a person: an identity number has to belong to somebody,
      // and a household document is refused for exactly that reason.
      await page.locator('#f-document-person').selectOption({ index: 1 });
      await page.locator('#f-document-title').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 });
      await page.waitForTimeout(600);

      await page.getByRole('button', { name: /PAN card/ }).first().click()
        .catch(() => page.locator('text=PAN card').first().click());
      await page.waitForTimeout(900);

      const detail = (await page.locator('.app-content').innerText()).trim();

      check('a document offers the identity number it found',
        /is on this document and is not recorded anywhere/.test(detail),
        detail.slice(0, 700));
      check('and shows it by its last four rather than in full',
        detail.includes('••••234F'), detail.slice(0, 700));
      // The point of the redaction, checked where it matters: on the screen.
      check('the full number is nowhere on the screen',
        !detail.includes(PAN), detail.slice(0, 700));

      await page.getByRole('button', { name: 'Record it' }).first().click();
      await page.waitForTimeout(900);

      const after = (await page.locator('.app-content').innerText()).trim();
      check('recording it says so and stops offering',
        /already recorded/.test(after) && !/is not recorded anywhere/.test(after),
        after.slice(0, 700));

      await go(page, '#/identity/identityDocument');
      await page.waitForTimeout(600);
      const identity = (await page.locator('.app-content').innerText()).trim();

      check('the identity record exists after the offer was taken',
        /PAN/.test(identity), identity.slice(0, 400));
      // `number` is encrypted and every projection of this entity is
      // deliberately not the number — the list must not print it either.
      check('and the list does not print the number it just stored',
        !identity.includes(PAN), identity.slice(0, 400));

      check('reading a document raises no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'documents-identifier');
    }

    /* ---------------------- a document whose text has not been read */

    {
      // The screen said "on device only", which is about Drive, and never
      // said anything about the text — so a photographed bill produced no due
      // date and nothing explained why.
      await go(page, '#/documents');
      await page.waitForTimeout(400);
      await page.locator('input[type=file]:not([capture])').setInputFiles({
        name: 'gas bill.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
      });
      await page.waitForSelector('.modal', { timeout: 8000 });
      await page.locator('#f-document-title').fill('Gas bill photo');
      await page.locator('#f-document-title').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 });
      await page.waitForTimeout(600);

      await page.getByRole('button', { name: /Gas bill photo/ }).first().click()
        .catch(() => page.locator('text=Gas bill photo').first().click());
      await page.waitForTimeout(800);

      const detail = (await page.locator('.app-content').innerText()).trim();
      check('a photograph says why nothing was filled in from it',
        /photographs are read when they reach Drive/i.test(detail),
        detail.slice(0, 600));
    }

    /* ----------------------------- what a holding actually cost */

    {
      // `holding.invested` is typed on the form and nothing re-read it, so a
      // fund fed a monthly SIP kept reporting the opening figure. Driven
      // through the real forms, because the arithmetic being right in a unit
      // test says nothing about whether a household ever sees it.
      const before = consoleErrors.length;

      await go(page, '#/investments/holding');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-holding-name').fill('Flexi cap fund');
      await page.locator('#f-holding-kind').selectOption('mutual fund');
      await page.locator('#f-holding-invested').fill('50000');
      await page.locator('#f-holding-currentValue').fill('131000');
      await page.locator('#f-holding-valuedOn').fill('2026-08-01');
      await page.locator('#f-holding-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      const buy = async (date, amount, units, charges) => {
        await go(page, '#/investments/investmentTransaction');
        await page.waitForTimeout(350);
        await page.getByRole('button', { name: /Add/ }).first().click();
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-investmentTransaction-holding')
          .selectOption({ label: 'Flexi cap fund' });
        await page.locator('#f-investmentTransaction-kind').selectOption('buy');
        await page.locator('#f-investmentTransaction-date').fill(date);
        await page.locator('#f-investmentTransaction-amount').fill(amount);
        await page.locator('#f-investmentTransaction-units').fill(units);
        if (charges) await page.locator('#f-investmentTransaction-charges').fill(charges);
        await page.locator('#f-investmentTransaction-amount').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      };

      // The opening purchase, then three SIP instalments with brokerage on
      // them. ₹50,000 + ₹15,000 + ₹36 of charges = ₹65,036.
      await buy('2025-08-14', '50000', '100', '');
      await buy('2025-09-14', '5000', '10', '12');
      await buy('2025-10-14', '5000', '10', '12');
      await buy('2025-11-14', '5000', '10', '12');

      await go(page, '#/investments');
      await page.waitForTimeout(700);
      const body = (await page.locator('.app-content').innerText()).trim();

      // The summary is portfolio-wide, so what this holding contributes is the
      // ₹15,000 of SIP plus ₹36 of brokerage that the forms never saw.
      check('the invested figure follows the recorded purchases',
        /₹15,036\.00 less/.test(body), body.slice(0, 900));
      check('and the screen says the form disagrees, rather than changing quietly',
        /The holding forms say/.test(body), body.slice(0, 900));
      check('and charges are named as being inside it',
        /including charges/.test(body), body.slice(0, 900));
      check('and says how much of the portfolio this never reached',
        /holdings have no transactions recorded/.test(body), body.slice(0, 900));

      const row = page.locator('.holdings-card .list-item', { hasText: 'Flexi cap fund' }).first();
      const rowText = (await row.count()) ? await row.innerText() : '';
      // ₹1,31,000 against ₹65,036 is +101.43%. Against the ₹50,000 on the form
      // it read +162%.
      check('the gain on the row is against what was really put in',
        /\+101\.43%/.test(rowText), rowText || '(no row)');

      check('the portfolio renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'investments-costbasis');
    }

    /* --------------------------------- what the calendar actually draws */

    {
      // The grid asked for a 400-day horizon and got each field's reminder
      // lead instead, so a recurring payment left the calendar eight days out
      // and paging one month forward showed almost nothing. Twenty days out is
      // past that lead of seven and squarely inside the month it falls in.
      const before = consoleErrors.length;

      const due = new Date(Date.now() + (20 * 86_400_000));
      const dueDay = due.toISOString().slice(0, 10);
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dueLabel = `${due.getUTCDate()} ${MONTHS[due.getUTCMonth()]} ${due.getUTCFullYear()}`;
      const monthsForward = (due.getUTCFullYear() * 12 + due.getUTCMonth())
        - (new Date().getFullYear() * 12 + new Date().getMonth());

      await go(page, '#/finance/recurringPayment');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-recurringPayment-name').fill('Sinking fund');
      await page.locator('#f-recurringPayment-amount').fill('7777');
      await page.locator('#f-recurringPayment-nextDueOn').fill(dueDay);
      await page.locator('#f-recurringPayment-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/calendar');
      await page.waitForTimeout(700);
      for (let i = 0; i < monthsForward; i++) {
        await page.getByRole('button', { name: 'Next month' }).click();
        await page.waitForTimeout(400);
      }

      const grid = (await page.locator('.app-content').innerText()).trim();
      check('a payment past its reminder lead is still on the calendar',
        grid.includes('Sinking fund'), grid.slice(0, 700));

      // The amount, which no calendar entry had ever carried. Selecting the
      // day opens the panel that shows it.
      await page.locator(`[aria-label^="${dueLabel},"]`).first().click();
      await page.waitForTimeout(400);
      const panel = (await page.locator('.app-content').innerText()).trim();

      check('and the calendar says how much is due, not just that something is',
        /7,777\.00/.test(panel), panel.slice(-700));
      check('the day it was selected on is the day it falls on',
        panel.includes(dueLabel), panel.slice(-700));

      // Recurrence, on the screen. Everything above passes whether a monthly
      // bill is drawn once or twelve times, which is exactly how the money
      // half of this grid stayed wrong through the tranche that fixed the
      // renewals half: `upcomingBills` gives the *next* rent, so a household
      // paying every month saw it on one square a year.
      await page.getByRole('button', { name: 'Next month' }).click();
      await page.waitForTimeout(500);
      const nextMonth = (await page.locator('.app-content').innerText()).trim();
      check('a monthly payment is on next month’s grid as well',
        nextMonth.includes('Sinking fund'), nextMonth.slice(0, 700));

      // Far enough ahead that no card cycle has closed. The squares are empty
      // either way; the difference is whether the screen says why.
      for (let i = 0; i < 4; i++) {
        await page.getByRole('button', { name: 'Next month' }).click();
        await page.waitForTimeout(350);
      }
      const farOut = (await page.locator('.app-content').innerText()).trim();
      check('and a month past the last closed statement says why no card bill is on it',
        /Credit card bills are not shown this far ahead/.test(farOut), farOut.slice(0, 700));

      // Back to where the rest of this block expects to be.
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: 'Previous month' }).click();
        await page.waitForTimeout(350);
      }

      // A policy renewal is not a bill, so it can only reach the grid through
      // `datesInRange`. Without one of these the money path alone satisfies
      // the checks above and the renewal fix goes unverified — which is
      // exactly what mutating `datesInRange` away proved.
      const renew = new Date(Date.now() + (60 * 86_400_000));
      const renewDay = renew.toISOString().slice(0, 10);
      const renewMonths = (renew.getUTCFullYear() * 12 + renew.getUTCMonth())
        - (new Date().getFullYear() * 12 + new Date().getMonth());

      await go(page, '#/insurance/policy');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-policy-name').fill('Star Health floater');
      await page.locator('#f-policy-kind').selectOption('health');
      await page.locator('#f-policy-insurer').fill('Star Health');
      await page.locator('#f-policy-policyNumber').fill('P/141234/01');
      await page.locator('#f-policy-premium').fill('18644');
      await page.locator('#f-policy-renewsOn').fill(renewDay);
      await page.locator('#f-policy-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/calendar');
      await page.waitForTimeout(700);
      for (let i = 0; i < renewMonths; i++) {
        await page.getByRole('button', { name: 'Next month' }).click();
        await page.waitForTimeout(400);
      }

      const far = (await page.locator('.app-content').innerText()).trim();
      // 60 days out, against a reminder lead of 45. The old grid dropped it.
      check('a renewal beyond its reminder lead is on the month it falls in',
        far.includes('Star Health floater'), far.slice(0, 700));

      // The export path, end to end: collect -> toICalendar -> download. The
      // toast only appears if the whole chain ran, and it is also where the
      // snapshot-not-sync wording lives.
      await go(page, '#/calendar');
      await page.waitForTimeout(600);
      // The file itself, not merely the toast. Asserting only the message let
      // an empty export through: the count is worked out from the entries, so
      // it reads the same whether or not anything was written.
      // `showSaveFilePicker` exists in Chromium but cannot open a dialog
      // headlessly, and the helper treats a cancelled picker as success — so
      // with it present the click reports "exported" having written nothing,
      // which is what made the first version of this check pass on an empty
      // file. Removing it takes the anchor path, which is what any browser
      // without the File System Access API does anyway.
      await page.evaluate(() => { delete (/** @type {any} */ (window)).showSaveFilePicker; });

      const [downloaded] = await Promise.all([
        page.waitForEvent('download', { timeout: 15_000 }).catch(() => null),
        page.getByRole('button', { name: /Export \.ics/ }).first().click(),
      ]);
      await page.waitForTimeout(900);

      let ics = '';
      if (downloaded) {
        const where = await downloaded.path();
        if (where) ics = await readFile(where, 'utf8');
      }
      check('the exported file is a calendar with events in it',
        ics.startsWith('BEGIN:VCALENDAR') && /\r\nUID:/.test(ics), ics.slice(0, 400));
      check('and its name carries the day it was taken',
        /household-calendar-\d{4}-\d{2}-\d{2}\.ics/.test(downloaded?.suggestedFilename() ?? ''),
        downloaded?.suggestedFilename() ?? 'no download');

      const afterExport = (await page.locator('body').innerText()).trim();
      check('exporting the calendar reports what it wrote',
        /entries exported/.test(afterExport), afterExport.slice(0, 600));
      check('and says that importing it again updates rather than duplicates',
        /updates them rather than duplicating/.test(afterExport), afterExport.slice(0, 600));

      check('the calendar renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'calendar-money');
    }

    /* ------------------------------------------------------------- family */

    await go(page, '#/family');
    const familyText = await page.locator('.app-content').innerText();
    // Case-insensitive: the generation labels are uppercased by CSS, and
    // `innerText` reports what is rendered.
    check('the family tree renders a generation',
      /generation/i.test(familyText) || familyText.includes('No people yet'),
      familyText.slice(0, 160));
    check('the tree counts one person as a person',
      !/\b1 people\b/.test(familyText), familyText.slice(0, 160));

    /* --------------- a family entered the way the person form invites */

    {
      // The person form has a `relationship` dropdown beside the name, and
      // nothing on that screen suggests a separate Relationships entity
      // exists. Filling it in used to produce a flat tree of strangers.
      // Driven through the real form, because the whole bug was that one
      // screen collected what another never read.
      const before = consoleErrors.length;

      // No `self` is added here: first run already creates one, named "You".
      // Adding a second correctly trips the two-selves refusal — which is how
      // this check first failed, and worth recording as the reason it does not
      // create one.
      for (const [name, relationship] of [
        ['Ravi Iyer', 'son'], ['Krishnan Iyer', 'father'],
      ]) {
        await go(page, '#/identity/person');
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /Add/ }).first().click();
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-person-name').fill(name);
        await page.locator('#f-person-relationship').selectOption(relationship);
        await page.locator('#f-person-name').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      }

      await go(page, '#/family');
      await page.waitForTimeout(600);
      const tree = (await page.locator('.app-content').innerText()).trim();

      // Whether they are placed at all is the question. Before this, both sat
      // under "Not connected to anyone".
      const stranded = page.locator('.card', { hasText: 'Not connected to anyone' });
      const strandedText = (await stranded.count()) ? await stranded.innerText() : '';

      check('a person given a relationship on their own record is placed in the tree',
        !/Ravi Iyer/.test(strandedText) && !/Krishnan Iyer/.test(strandedText),
        strandedText.slice(0, 300) || '(nobody stranded)');

      check('and the tree shows more than one generation because of it',
        (await page.locator('.app-content').innerText()).match(/generation|parents|children/i)
          !== null, tree.slice(0, 300));

      check('the family tree renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'family-tree');
    }

    /* ------------------------ what each institution holds, and where it differs */

    {
      // A record of what one institution holds, typed in by hand. The point of
      // driving it through the form is the two claims that matter: that the
      // comparison across rows reaches a screen, and that the screen never
      // suggests any of it came from a registry.
      const before = consoleErrors.length;

      for (const [institution, address] of [
        ['HDFC Bank', '12/A 4th Cross, Indiranagar, Bengaluru 560038'],
        ['Zerodha', '7 Palm Grove, Koramangala, Bengaluru 560034'],
      ]) {
        await go(page, '#/identity/kycRecord');
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /Add/ }).first().click();
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-kycRecord-person').selectOption({ index: 1 });
        await page.locator('#f-kycRecord-institution').fill(institution);
        await page.locator('#f-kycRecord-recordedOn').fill('2026-01-15');
        await page.locator('#f-kycRecord-heldAddress').fill(address);
        await page.locator('#f-kycRecord-kin').fill('12345678901234');
        await page.locator('#f-kycRecord-institution').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      }

      await go(page, '#/identity/kycRecord');
      await page.waitForTimeout(600);

      const drift = page.locator('.kyc-drift');
      const driftText = (await drift.count()) ? await drift.innerText() : '';

      check('two institutions holding different addresses is reported',
        /address/i.test(driftText) && /HDFC Bank/.test(driftText) && /Zerodha/.test(driftText),
        driftText.slice(0, 400) || '(no drift card)');

      // Never a verdict. Both are named and neither is called wrong.
      check('and neither copy is declared the right one',
        /Nothing here can tell which is current/.test(driftText)
        && !/out of date|incorrect|should be/i.test(driftText), driftText.slice(0, 400));

      const provenance = page.locator('.kyc-provenance');
      const said = (await provenance.count()) ? await provenance.innerText() : '';

      // The claim this whole entity has to keep. Stated on the screen itself,
      // not only in a comment nobody using the app will read.
      check('the screen says plainly that no registry was involved',
        /Central KYC Records Registry/.test(said) && /nothing here is verified/i.test(said),
        said.slice(0, 400) || '(no provenance note)');

      check('the KYC screen renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'identity-kyc');
    }

    /* ----------------------------------------------------------- calendar */

    await go(page, '#/calendar');
    check('the calendar shows a month grid',
      (await page.locator('.app-content [aria-current="date"], .app-content .card').count()) > 0);

    /* ------------------------------------------------------- assistant */

    await go(page, '#/assistant');
    await page.locator('input[aria-label="Ask a question"]').fill('What is our family net worth?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const answer = await page.locator('.card')
      .filter({ has: page.locator('h3', { hasText: /^Answer$/ }) })
      .first().innerText();
    check('the assistant answers a question from stored data',
      /net worth/i.test(answer), answer.slice(0, 120));

    /* ------------------------------------------------------------ dark */

    await page.emulateMedia({ colorScheme: 'dark' });
    await go(page, '#/dashboard');
    await page.waitForTimeout(300);
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    check('dark mode actually changes the surface colour',
      background !== 'rgb(251, 251, 252)', background);
    if (SHOTS) await shot(page, 'dashboard-dark');

    /* ------------------------------------------------------------ phone */

    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '#/dashboard');
    await page.waitForTimeout(300);
    check('the bottom navigation appears on a phone',
      await page.locator('.bottom-nav').isVisible());
    const overflow = await page.evaluate(() => {
      const limit = window.innerWidth + 1;
      if (document.documentElement.scrollWidth <= limit) return null;
      // Name the widest offender rather than reporting that "something" is
      // too wide, which is unactionable.
      const worst = [...document.querySelectorAll('.app-main *')]
        .map((el) => ({ el, right: el.getBoundingClientRect().right }))
        .filter((row) => row.right > limit)
        .sort((a, b) => b.right - a.right)[0];
      return worst
        ? `${worst.el.tagName.toLowerCase()}.${worst.el.className} reaches ${Math.round(worst.right)}px`
        : `document is ${document.documentElement.scrollWidth}px wide`;
    });
    check('nothing overflows horizontally on a phone', !overflow, overflow ?? '');
    if (SHOTS) await shot(page, 'phone');

    check('no console errors in the whole run', consoleErrors.length === 0,
      consoleErrors.slice(0, 5).join(' | '));
    check('every asset the app asks for exists', missing.length === 0,
      [...new Set(missing)].join(' | '));

    /* ------------------------------------------------------ offline, really */

    // Last, because it kills the server and nothing can be served afterwards.
    //
    // "Offline-first" is the claim this application is built around and
    // nothing was checking it. Playwright's `setOffline` would not have been
    // enough either — it makes requests fail, which a service worker can
    // paper over while still depending on a host being *reachable*. Killing
    // the server is the honest version of the question.
    await page.setViewportSize({ width: 1280, height: 900 });
    await go(page, '#/dashboard');

    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg?.active);
    });
    check('a service worker is registered and active', registered,
      'without one a browser will not offer to install the app at all');

    server.kill('SIGKILL');
    await page.waitForTimeout(800);

    try {
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.lock-card', { timeout: 20_000 });
      check('the app still loads with the server gone', true);

      for (const digit of PIN) {
        await page.getByRole('button', { name: digit, exact: true }).click();
      }
      await page.waitForSelector('.app-nav', { timeout: 20_000 });
      check('and unlocks, and draws the shell', true);

      await go(page, '#/finance');
      const offlineBody = (await page.locator('.app-content').innerText()).trim();
      check('and a module still renders from cache', offlineBody.length > 0);
    } catch (err) {
      check('the app still loads with the server gone', false, err.message);
    }
  } finally {
    await browser.close();
    server.kill();
  }

  const failed = failures.length;
  console.log(`\n${'-'.repeat(60)}`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  console.log(`  ${checks.length - failed}/${checks.length} browser checks passed`);
  console.log('-'.repeat(60));
  process.exit(failed ? 1 : 0);
}

async function shot(page, name) {
  await mkdir(join(ROOT, 'shots'), { recursive: true });
  await page.screenshot({ path: join(ROOT, 'shots', `${name}.png`), fullPage: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
