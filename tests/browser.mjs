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
import { zip } from '../js/reports/xlsx.js';
import { modules as SCHEMA_MODULES, entities as SCHEMA_ENTITIES } from '../js/data/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8247;
const BASE = `http://localhost:${PORT}`;
/**
 * Module specifiers the *page* resolves, not the type checker.
 *
 * These paths are relative to the served root, which is not where this file
 * lives, so `tsc` reported three "cannot find module" errors for imports that
 * work perfectly at run time. Passing the specifier in as an argument makes it
 * a value rather than a literal, which is the honest description of what it
 * is: a string the browser will resolve.
 */
const IN_PAGE = Object.freeze({
  context: './js/context.js',
  pdfRead: './js/data/pdf-read.js',
  chat: './js/services/chat.js',
  schema: './js/data/schema.js',
  consent: './js/data/consent.js',
});

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
/** Today as the schema stores a day: `YYYY-MM-DD`. */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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
    /*
     * Waited for, but not *only* waited for.
     *
     * A bare `waitForSelector` here turns a dashboard that throws into a
     * ten-second hang and then a stack trace pointing at this line — which
     * says the card never appeared and nothing about why. The screen had
     * already logged the actual cause to the console, and the run threw it
     * away.
     *
     * That happened for real in UI-4: `data.people` is an id-to-name lookup
     * rather than a list, `.filter` was called on it, and the report was
     * `Timeout 10000ms exceeded waiting for .app-content .card`. The one-line
     * TypeError was sitting in `consoleErrors` the whole time.
     */
    const dashboardDrew = await page.waitForSelector('.app-content .card', { timeout: 10_000 })
      .then(() => true).catch(() => false);
    check('the dashboard says something rather than showing an empty grid',
      dashboardDrew && (await page.locator('.card').count()) > 0,
      consoleErrors.length
        ? `the screen threw: ${consoleErrors[consoleErrors.length - 1].slice(0, 200)}`
        : 'no card appeared, and nothing was logged');
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
    // Encrypted at rest, and the reason a browser check fills it: the
    // nominations widget has to read this back through real AES-GCM. Loaded
    // undecrypted it would be ciphertext, and the gap list — the whole answer
    // — would come out empty with nothing on screen to say why.
    await page.locator('#f-account-nominee').fill('Meera Narayan');
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

    /*
     * Derived from the schema, not typed out here.
     *
     * This was a hand-written array of twenty-two names beside a schema that
     * defines twenty-three modules. It had drifted: `belongings` and `travel`
     * were missing, so the suite had never once opened either screen — and
     * both were rendering `[object Object]` instead of their record list on a
     * real phone. A list maintained by hand beside one that can be derived is
     * the fault this repository keeps finding in itself, and here it cost two
     * screens' worth of coverage.
     *
     * `assistant` and `timeline` are named because they are registered in
     * `js/app.js` outside the module list; walking them proves they still
     * resolve. Everything else arrives by adding a module to the schema, which
     * is the only place a module should have to be declared.
     */
    const OUTSIDE_THE_SCHEMA = ['assistant', 'timeline'];
    const modules = [...SCHEMA_MODULES.map((one) => one.id), ...OUTSIDE_THE_SCHEMA];

    check('every module in the schema is walked', modules.length >= 25,
      `only ${modules.length} routes would be opened`);

    for (const module of modules) {
      const before = consoleErrors.length;
      await go(page, `#/${module}`);
      await page.waitForTimeout(350);

      const body = (await page.locator('.app-content').innerText()).trim();

      /*
       * Not `body.length > 0`.
       *
       * That is what this assertion used to be, and it passed on four screens
       * that were rendering the literal text `[object Object]` where their
       * record list should have been — Chat, Travel, Safety and Belongings.
       * `listSection()` returns `{ node, openForm, reload, destroy }` and those
       * four put the object into a children array instead of its `node`, so
       * `append` stringified it. `"[object Object]"` is not empty, so a length
       * check could never fail on it, and 389 checks passed while four screens
       * were broken on a real phone.
       *
       * A stringified object is the specific shape that got through, so it is
       * named. The length floor is there because a screen reduced to a heading
       * is also a failure, and every module here renders a page header plus
       * something — the smallest real screen is comfortably above it.
       */
      check(`${module} renders something`, body.length > 0, 'the screen came back empty');
      check(`${module} renders no stringified object`,
        !body.includes('[object '), body.slice(0, 120));
      check(`${module} renders more than a heading`, body.length > 40,
        `only ${body.length} characters: ${body.slice(0, 80)}`);
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
      const decoded = await page.evaluate(async (spec) => {
        const { inflate } = await import(spec);
        const original = new TextEncoder().encode('column x, column y, balance');
        const compressed = await new Response(
          new Blob([original]).stream().pipeThrough(new CompressionStream('deflate')),
        ).arrayBuffer();
        const out = await inflate(new Uint8Array(compressed));
        return out ? new TextDecoder().decode(out) : null;
      }, IN_PAGE.pdfRead);
      check('the PDF reader can decompress in the browser',
        decoded === 'column x, column y, balance', String(decoded));

      // A pasted bank message, through the real box on the real screen.
      // Phase 6's reading exists in `domain/sms.js`; this is the half that
      // proves a household can reach it.
      {
        // Phase 6's native half, from the browser's side. There is no plugin
        // here, so the honest outcome is that the card says reading an inbox
        // is not possible and offers pasting instead — not a button that
        // silently does nothing when tapped.
        const card = (await page.locator('.app-content').innerText()).trim();

        check('a browser is told it cannot read an inbox rather than shown a dead button',
          /cannot read an SMS inbox/i.test(card), card.slice(0, 600));
        check('and no read-this-device button is offered where it cannot work',
          (await page.getByRole('button', { name: /Read this device/ }).count()) === 0,
          card.slice(0, 600));
        check('and no permission prompt is offered either',
          (await page.getByRole('button', { name: /Allow reading messages/ }).count()) === 0,
          card.slice(0, 600));
        // The alternative rule 55 asks for is still right there.
        check('and pasting is still offered',
          (await page.locator('#sms-text').count()) === 1, card.slice(0, 600));
      }

      {
        const smsBefore = consoleErrors.length;

        await page.locator('#sms-text').fill(
          'Rs 50,000.00 debited from a/c XX8963 on 15-08-26 to VPA landlord@okicici '
          + 'UPI Ref 412345678901. Avl Bal Rs 1,40,500.00',
        );
        await page.getByRole('button', { name: /^Read$/ }).click();
        await page.waitForTimeout(400);
        const said = (await page.locator('.app-content').innerText()).trim();

        check('a pasted bank message is read on screen',
          /50,000/.test(said) && /upi payment|bank debit/i.test(said), said.slice(0, 600));

        check('and it is kept, so the link survives the screen closing',
          /Kept, so the link/i.test(said), said.slice(0, 600));

        // Rule 51, where a household can see it rather than only in the data.
        check('and the screen says a message is not the transaction',
          /not the transaction/i.test(said), said.slice(0, 600));

        // Rule 52. The screen used to say "nothing here is recorded from it",
        // which was true until the message began being kept — and a sentence
        // that was accurate when written is the easiest kind to leave standing
        // after it stops being so.
        check('and says what keeping it is for',
          /kept as evidence and linked/i.test(said), said.slice(0, 600));

        // Rule 53, driven rather than asserted in a unit test. The message
        // names an amount, and none of it may be read or shown.
        await page.locator('#sms-text').fill(
          '123456 is your OTP for a transaction of Rs 77,777. Do not share it with anyone.',
        );
        await page.getByRole('button', { name: /^Read$/ }).click();
        await page.waitForTimeout(400);
        const otp = (await page.locator('.app-content').innerText()).trim();

        check('a one-time code is refused rather than read',
          /has not been read, stored, or sent/i.test(otp), otp.slice(0, 600));
        check('and its amount never reaches the screen',
          !/77,777/.test(otp), otp.slice(0, 600));
        check('and the box is cleared so the code does not sit there',
          (await page.locator('#sms-text').inputValue()) === '', 'the textarea still held it');

        // Rule 53, said on the screen rather than only refused in the data: a
        // credential produces no "kept" line, because nothing was kept.
        check('nothing is said to have been kept for the one-time code',
          !/Kept, so the link/i.test(otp), otp.slice(0, 600));

        // A second alert for the same payment, naming a different figure.
        // The bank's own two messages about one debit disagreeing is not
        // exotic — it is what happens when an authorisation is followed by a
        // settlement — and it is the specification's Case 3 arriving through
        // the screen a household actually uses rather than through a fixture.
        await page.locator('#sms-text').fill(
          'Rs 50,500.00 debited from a/c XX8963 on 15-08-26 to VPA landlord@okicici '
          + 'UPI Ref 412345678901. Avl Bal Rs 1,40,000.00',
        );
        await page.getByRole('button', { name: /^Read$/ }).click();
        await page.waitForTimeout(400);
        const second = (await page.locator('.app-content').innerText()).trim();

        check('a second alert naming a different figure is kept, not merged',
          /Kept, so the link/i.test(second), second.slice(0, 600));
        check('and the screen does not decide which of the two is right',
          !/is the right|should be|use the statement/i.test(second), second.slice(0, 600));

        // A record's own history, on the record screen. The log has carried
        // `recordId` since Phase 0.5 and nothing could ask it.
        await go(page, '#/finance/account');
        await page.waitForTimeout(900);
        await page.locator('text=HDFC Savings').first().click();
        await page.waitForTimeout(1200);
        const detail = (await page.locator('.app-content').innerText()).trim();

        check('a record says what has happened to it',
          /What has happened to this/i.test(detail), detail.slice(0, 500));
        check('and names the change rather than what it changed to',
          /records which fields changed rather than what they changed to/i.test(detail),
          detail.slice(0, 500));

        await go(page, '#/finance/smsMessage');
        // Longer than the usual pause: the banner reads three entities before
        // the table paints.
        await page.waitForTimeout(1500);
        const list = (await page.locator('.app-content').innerText()).trim();

        // The kept message, reachable. A record stored and never listed is a
        // record a household cannot check, which is the whole objection to
        // keeping it in the first place.
        //
        // `pasted`, not `HDFCBK`: the Import screen is where this message came
        // from and it says so. Asserting the bank's short code would have been
        // asserting something the screen never claimed.
        check('the kept message is listed under Messages',
          /pasted/.test(list) && /UPI_PAYMENT/i.test(list), list.slice(0, 400));
        check('and the one-time code is nowhere in that list',
          !/123456/.test(list) && !/77,777/.test(list), list.slice(0, 400));
        // A message record comes from a message. A blank form for one would
        // invite a household to type what a bank said.
        check('and there is no form offering to invent one',
          (await page.getByRole('button', { name: /^Add$/ }).count()) === 0, list.slice(0, 200));

        // Every disagreement, in one place. Before this the amount two
        // sources named differently was reported above this table, a payment
        // with no ledger row on the same card, and a month of wages short of
        // what was agreed on a staff member's record — three shapes, two
        // screens, and no way to ask "what does not add up".
        //
        // What a browser can reach here is the empty state, and only that:
        // this fixture never imports a statement, so the two alerts above are
        // linked to nothing and there is no disagreement for the screen to
        // list. The populated screen is driven in `tests/services.test.mjs`
        // against a real database, where a statement row, an alert naming a
        // different figure and a month of wages paid short all exist.
        //
        // The empty state is worth checking on its own account. It is the
        // sentence most likely to overclaim — "all clear" is what an
        // application says here — and the one this screen must not say.
        {
          check('the banner stays quiet when nothing disagrees',
            !/Records that disagree/i.test(list), list.slice(0, 1500));

          await go(page, '#/finance/conflicts');
          await page.waitForTimeout(1200);
          const seen = (await page.locator('.app-content').innerText()).trim();

          check('Disagreements is reachable from the Finance tabs',
            /Disagreements/.test(seen), seen.slice(0, 400));
          check('and says nothing disagrees rather than that everything is fine',
            /Nothing disagrees/i.test(seen)
              && !/all clear|all good|everything (is )?(fine|checks out)/i.test(seen),
            seen.slice(0, 900));

          // The claim the empty state must make, and the reason this screen
          // exists at all: records agreeing with each other is not somebody
          // having checked that any of them is true.
          check('and says agreement between records is not verification',
            /not a person having checked/i.test(seen), seen.slice(0, 900));
          check('and never says a figure has been verified or confirmed',
            !/verified|confirmed|is the right|trust the/i.test(seen), seen.slice(0, 900));
          check('and there is no form offering to record a disagreement',
            (await page.getByRole('button', { name: /^Add$/ }).count()) === 0,
            seen.slice(0, 300));
        }

        // Movements, reachable for the first time. `economicEvent` has existed
        // since Phase 5 and no tab has ever linked to it — the same gap the
        // Messages tab closed one tranche earlier.
        await go(page, '#/finance/economicEvent');
        await page.waitForTimeout(1500);
        const movements = (await page.locator('.app-content').innerText()).trim();

        check('Movements is reachable from Finance',
          /Movements/.test(movements), movements.slice(0, 300));
        // A movement is made of the rows it is made of. A blank form would
        // produce one with no legs — the worst thing `domain/explain.js` can
        // find, invited by the screen meant to report it.
        check('and offers no form for inventing one',
          (await page.getByRole('button', { name: /^Add$/ }).count()) === 0,
          movements.slice(0, 200));

        // Back to Import: the next block reaches for the file input on this
        // screen, and leaving the page on Messages made it time out.
        await go(page, '#/finance/import');
        await page.waitForTimeout(400);

        check('reading a message raises no console error',
          consoleErrors.length === smsBefore, consoleErrors.slice(smsBefore).join(' | '));
      }

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

      // Connector health, driven through the real screen. A mailbox whose
      // grant Google has withdrawn used to look exactly like one nobody had
      // scanned yet — which is why "no receipts have appeared this month" was
      // impossible for a household to explain.
      //
      // Attaching a google mailbox with nothing signed in produces exactly
      // that failure: `getToken` returns nothing and the client raises a 401.
      {
        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          await app().db.setMeta('inbox.mailboxes',
            [{ kind: 'google', email: 'nobody@example.com', label: 'Test mailbox' }]);
        }, IN_PAGE.context);

        await go(page, '#/finance');
        await go(page, '#/finance/shops');
        await page.waitForTimeout(400);

        const fresh = (await page.locator('.app-content').innerText()).trim();
        check('a mailbox nobody has scanned is not reported as broken',
          !/needs signing in again/.test(fresh), fresh.slice(0, 400));

        await page.getByRole('button', { name: /Scan mail/ }).click();
        await page.waitForTimeout(1200);

        const after = (await page.locator('.app-content').innerText()).trim();
        check('a mailbox whose grant is gone says so on the screen',
          /needs signing in again/.test(after), after.slice(0, 800));
        check('and says what to do rather than only that it failed',
          /no longer letting FamilyOS read this mailbox/.test(after), after.slice(0, 800));

        // And it survives the screen closing, which is the whole point: the
        // toast did not.
        const stored = await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          const health = await app().db.meta('connector.health', {});
          const diagnostics = await app().db.adapter.query('diagnostics', {});
          return {
            status: health['gm_nobody@example.com']?.status ?? null,
            connectorEvents: diagnostics.filter((d) => d.kind === 'connector').length,
          };
        }, IN_PAGE.context);

        check('the failure is remembered rather than living in a toast',
          stored.status === 401, JSON.stringify(stored));
        check('and it is recorded in diagnostics too',
          stored.connectorEvents >= 1, JSON.stringify(stored));

        // Leave the screen as it was for anything after this.
        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          await app().db.setMeta('inbox.mailboxes', []);
          await app().db.setMeta('connector.health', {});
        }, IN_PAGE.context);
      }
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

    /* ------------------------------------------------------- timeline */

    {
      const before = consoleErrors.length;

      // The dashboard's card shows eight of them and the service was building
      // every story in the window. The link is the only way to reach the rest.
      await go(page, '#/dashboard');
      await page.waitForTimeout(400);
      check('the activity card offers the whole history',
        (await page.getByRole('link', { name: 'Show everything' }).count()) === 1);

      await page.getByRole('link', { name: 'Show everything' }).click();
      await page.waitForTimeout(700);

      const timeline = (await page.locator('.app-content').innerText()).trim();
      check('the timeline screen renders', /Family timeline/.test(timeline), timeline.slice(0, 300));
      check('and says what happened in words rather than as rows',
        !/^\s*(create|update|delete)\s*$/m.test(timeline), timeline.slice(0, 600));
      check('and shows more than the eight the dashboard card does',
        (await page.locator('.list-item').count()) > 8,
        `${await page.locator('.list-item').count()} entries`);
      check('the timeline draws without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    {
      // The two sentences that must be above the conversations, not below and
      // not in a document nobody opens. A padlock and the word "encrypted" are
      // the easiest false claim in this application to make.
      const before = consoleErrors.length;
      await go(page, '#/chat');
      await page.waitForTimeout(400);

      const body = (await page.locator('.app-content').innerText()).trim();
      check('Chat says the recovery phrase can read every conversation',
        /recovery phrase/i.test(body) && /every conversation/i.test(body), body.slice(0, 900));
      check('and that nobody has reviewed the cryptography',
        /not been reviewed by a cryptographer/i.test(body), body.slice(0, 1200));
      check('it offers to enrol this device rather than having done so unasked',
        (await page.getByRole('button', { name: /Enrol this device/ }).count()) === 1);
      check('the chat screen draws without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    {
      // Safety says what it cannot do before what it can, and a card that
      // silently failed to render would say nothing at all — which reads
      // exactly like a phone that is quietly watching. Checked by its text.
      const before = consoleErrors.length;
      await go(page, '#/safety');
      await page.waitForTimeout(400);

      const body = (await page.locator('.app-content').innerText()).trim();
      // This used to assert the screen said "no background tracking". It no
      // longer does, because that stopped being true — so what is checked
      // instead is the set of promises that replaced it, each of which is
      // enforced somewhere in the code by its own test.
      check('Safety says a trail is off until somebody switches it on',
        /off until you turn it on|nothing starts it by itself/i.test(body),
        body.slice(0, 700));
      check('and that a phone which is recording always says so',
        /notification you cannot dismiss/i.test(body), body.slice(0, 700));

      // A browser cannot record a trail, and the card knows it: no switch is
      // drawn here at all. A dead "Start recording" button in a browser would
      // be the exact failure the SMS card was built to avoid.
      check('and a browser is not offered a switch that cannot work',
        (await page.getByRole('button', { name: /Start recording/i }).count()) === 0,
        body.slice(0, 400));
      check('and that a zone is not registered with the phone',
        /not registered with the phone/i.test(body), body.slice(0, 800));
      check('it offers to record a position rather than doing it unasked',
        (await page.getByRole('button', { name: 'Record where I am' }).count()) === 1);
      check('the safety screen draws without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    {
      const before = consoleErrors.length;
      await go(page, '#/settings');
      await page.waitForTimeout(500);

      const body = (await page.locator('.app-content').innerText()).trim();
      check('Settings answers where the data is', /Privacy/.test(body), body.slice(0, 200));
      check('and offers to keep it on this device',
        (await page.getByRole('button', { name: 'Keep everything local' }).count()) === 1);

      // The language card. It exists to say one true thing — that there is
      // only English — and a card that silently failed to render would say
      // nothing at all, which reads exactly like a card that was never built.
      // This session has already had `card()` called wrong take a whole screen
      // down, so the card is checked by its text rather than by its absence
      // of an error.
      check('Settings names the language, and says English is the only one',
        /Language/.test(body) && /English only/.test(body), body.slice(0, 1200));
      check('and does not offer a picker with one entry in it',
        (await page.getByRole('button', { name: /^English/ }).count()) === 0);

      // The one card that must never say "all clear". No application can
      // detect that a copy of a household's records was taken, and a screen
      // implying otherwise would be answering a question it never asked.
      {
        const summary = page.getByText('If you think your records have got out');
        check('Settings offers help if records may have got out',
          (await summary.count()) >= 1);

        // A collapsed <details> keeps its body out of innerText, so this
        // opens it — which is what somebody would do anyway.
        await summary.first().click();
        await page.waitForTimeout(300);
        const body = (await page.locator('.app-content').innerText()).trim();

        check('and never claims to have detected anything',
          !/no breach(es)? detected|breach detection|all clear/i.test(body),
          body.slice(0, 600));
        check('and says an empty list is not the same as nothing happening',
          /not the same as nothing having happened/i.test(body), body.slice(-1200));
        check('and refuses the regulator half in as many words',
          /Notify a regulator/i.test(body), body.slice(-1200));
      }

      // Consent for the people whose records are somebody else's to agree to.
      // A member of household staff is another person; before this, nothing
      // in the application asked, and nothing recorded that nobody had.
      {
        const before = (await page.locator('.app-content').innerText()).trim();
        check('a household with no staff and no children is not asked about either',
          !/works for you/.test(before), before.slice(0, 400));

        const cook = await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          const person = await app().db.repo('person').create({ name: 'Test Cook' });
          const role = await app().db.repo('staff').create({
            person: person.id, role: 'Cook', startedOn: '2026-01-01',
          });
          await app().db.repo('document').create({
            title: 'Her ID copy', person: person.id, category: 'identity',
          });
          return { staff: role.id, person: person.id };
        }, IN_PAGE.context);

        await go(page, '#/finance');
        await go(page, '#/settings');
        await page.waitForTimeout(600);
        const after = (await page.locator('.app-content').innerText()).trim();

        check('adding someone who works for you raises the question',
          /works for you/.test(after), after.slice(0, 900));

        // And it is a gap, not a silent yes. Nothing leaves the device, but
        // there is still somebody whose records these are.
        check('and it counts as happening without a record',
          /without a record/.test(after), after.slice(0, 900));

        /*
         * The staff member's own record screen.
         *
         * It had never opened. `recordDetail` calls `extra(record)` and
         * `staffDocuments` took the argument as an id, so IndexedDB was handed
         * a whole object, refused it as "not a valid key", and the route threw
         * — leaving you on whatever screen you were already looking at. The
         * unhandled abort that reached the console said `transaction aborted`
         * and named neither the store nor the key, which is why four hundred
         * passing checks never pointed at it.
         *
         * Nothing walked here before: the module sweep visits `#/family`, and
         * the index renders fine.
         */
        await go(page, `#/family/staff/${cook.staff}`);
        await page.waitForTimeout(800);

        const record = await page.evaluate(() => ({
          hash: location.hash,
          text: /** @type {any} */ (document.querySelector('.app-content'))?.innerText ?? '',
        }));

        check('a staff member’s own record screen opens at all',
          record.hash.includes(`staff/`), record.hash);
        check('and it is the staff record, not the screen you came from',
          record.text.includes('Cook'), record.text.slice(0, 200));

        // The three cards `extra` draws. Each one is a claim the screen makes
        // about somebody the household employs, and none of them had ever
        // reached a browser.
        check('it reconciles what was paid against what was agreed',
          /what was agreed/i.test(record.text), record.text.slice(0, 400));
        check('and heads their copy with their name, not “they”',
          record.text.includes('What Test Cook can be shown'), record.text.slice(0, 500));
        check('and lists the documents filed against the person',
          record.text.includes('Her ID copy'), record.text.slice(-400));

        // Back to Settings. The suite is one long session on one page, and
        // the three checks after this block read the Settings screen — this
        // navigation cost them all three before it was put back.
        await go(page, '#/settings');
        await page.waitForTimeout(500);

        // Put the household back. A later check asserts this copy has no
        // gaps, and it is right to: nothing is configured here. Leaving the
        // staff record behind would make that check fail for a reason that
        // has nothing to do with what it is testing.
        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          for (const row of await app().db.repo('staff').list({ limit: 50 })) {
            await app().db.repo('staff').remove(row.id);
          }
          for (const doc of await app().db.repo('document').list({ limit: 50 })) {
            if (doc.title === 'Her ID copy') await app().db.repo('document').remove(doc.id);
          }
          for (const person of await app().db.repo('person').list({ limit: 50 })) {
            if (person.name === 'Test Cook') await app().db.repo('person').remove(person.id);
          }
        }, IN_PAGE.context);
      }

      // The diagnostics card. It says two things that must survive contact
      // with a real render, because both are claims about what this
      // application does not do.
      {
        const said = (await page.locator('.app-content').innerText()).trim();

        check('Settings says how the device is doing',
          /How this device is doing/.test(said), said.slice(0, 300));
        check('and says the record never leaves the device',
          /leaves the device/.test(said), said.slice(0, 300));
        check('and says nobody is watching it',
          /Nobody is watching it but you/.test(said), said.slice(0, 300));

        // Drive a real failure, then require the card to have counted it and
        // to hold none of what caused it.
        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          try {
            await app().db.repo('transaction').create({
              date: '2026-08-22', amount: 50_000_00, direction: 'out',
              description: 'Rent to landlord@okicici', account: 'acc_nowhere',
            });
          } catch { /* expected */ }
        }, IN_PAGE.context);

        await go(page, '#/finance');
        await go(page, '#/settings');
        await page.waitForTimeout(500);
        const after = (await page.locator('.app-content').innerText()).trim();

        check('a real failure is counted on the card',
          /1 in 7 days|refusals?|errors?/.test(after), after.slice(0, 600));
        check('and none of what caused it is shown',
          !/landlord@okicici/.test(after) && !/50,000/.test(after)
          && !/acc_nowhere/.test(after), after.slice(0, 600));
      }

      // The audit chain, driven rather than asserted in a unit test. Both ends
      // of this have tests; the wiring between them is where this codebase
      // keeps finding holes.
      {
        await page.getByRole('button', { name: 'Check the log' }).click();
        await page.waitForTimeout(600);
        const said = (await page.locator('.app-content').innerText()).trim();

        check('the audit log can be checked from Settings and says it adds up',
          /link up correctly|links up correctly/.test(said), said.slice(0, 400));

        // The whole honesty of the feature. A screen that said "verified" or
        // "proven" would be claiming more than a hash chain inside its own
        // database can deliver.
        check('and says plainly who could still defeat it',
          /anybody who can unlock/i.test(said), said.slice(0, 400));
        check('and does not use the word verified or proven',
          !/\bverified\b|\bproven\b/i.test(said), said.slice(0, 400));

        // Now break it, through the adapter, and require the screen to notice.
        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          const rows = await app().db.adapter.query('audit', {});
          const target = rows.find((r) => r.hash);
          await app().db.adapter.write('audit', { ...target, actorId: 'somebody-else' });
        }, IN_PAGE.context);

        await page.getByRole('button', { name: 'Check the log' }).click();
        await page.waitForTimeout(600);
        const broken = (await page.locator('.app-content').innerText()).trim();

        check('and a rewritten entry is reported on the screen, not only in a test',
          /does not add up/.test(broken), broken.slice(0, 400));
        check('and the screen says what kind of tampering it was',
          /changed after it was written|not attached|no beginning|same place/.test(broken),
          broken.slice(0, 400));
      }

      // The layer is wired to the boot sequence, not merely present. `dir` is
      // the half that proves it: index.html already carries a static
      // `lang="en"`, so that attribute would survive `start()` being deleted
      // and asserting on it alone would prove nothing. Removing the boot call
      // leaves `dir=null`, which is what this actually catches — and it means
      // the stored preference would go unread on the day a second catalogue
      // arrives.
      check('the document declares its language and direction',
        (await page.locator('html').getAttribute('lang')) === 'en'
        && (await page.locator('html').getAttribute('dir')) === 'ltr',
        `lang=${await page.locator('html').getAttribute('lang')} dir=${await page.locator('html').getAttribute('dir')}`);

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

      // The only place a household can take every record they have, and the
      // only place they can replace every record they have.
      check('Settings offers a real backup, not only the CSV exports',
        /One encrypted file holding every record/.test(body), body.slice(0, 2000));
      check('and offers the way back from a lost phone',
        (await page.getByRole('button', { name: 'Restore from a file' }).count()) === 1);

      // A backup nobody remembers to take is close to a backup nobody has, so
      // the state is on the card. "Never" is the honest word for a fresh
      // install, and it is the state most households are in.
      check('and says plainly that no backup has ever been taken here',
        /No backup has ever been taken on this device/.test(body), body.slice(0, 2400));

      // Sealed with a key derived from the phrase, and checked against the
      // keyring first. A backup sealed with a typo is one nobody can open, and
      // it fails silently — the file looks fine and the mistake surfaces years
      // later on the worst possible day.
      await page.getByRole('button', { name: 'Take a backup' }).click();
      await page.waitForTimeout(300);
      check('taking one asks for the recovery phrase rather than a new password',
        /recovery phrase/i.test(await page.locator('.modal').innerText()));

      await page.locator('#prompt-input').fill('not-the-phrase-at-all');
      await page.getByRole('button', { name: 'Take the backup' }).click();
      await page.waitForTimeout(1500);

      // The newest toast, not the host: the host accumulates, and a check that
      // reads all of them can pass on something another screen said earlier.
      const refused = await page.locator('.toast').last().innerText().catch(() => '(no toast)');
      check('and refuses a wrong phrase before writing anything',
        /not the recovery phrase/i.test(refused) && /Nothing was written/.test(refused),
        refused);

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
      /*
       * Opened, the way a person opens it.
       *
       * The scope list folds away now — a hundred lines of setup reference
       * that used to sit open above Security and Backup. The checks below
       * read what is inside it, so they open it first rather than asserting
       * on text a `<details>` is not rendering. The two strings a broken
       * sign-in needs are *not* in here: they were, folding hid them, and
       * they have their own visible card now.
       */
      const scopeFold = page.locator('details.card', { hasText: 'Google permissions' }).first();
      if (await scopeFold.count()) {
        await scopeFold.locator('summary').click();
        await page.waitForTimeout(200);
      }
      const scopes = (await page.locator('.app-content').innerText()).trim();

      check('and marks the optional ones as optional',
        (await page.locator('.badge', { hasText: 'optional' }).count()) >= 2);
      check('and says drive.appdata is not needed',
        /do not need drive\.appdata/i.test(scopes), scopes.slice(0, 1200));

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
      // `body`, not `scopes`: these two moved out of the fold on purpose and
      // have to be readable without opening anything. Reading them from the
      // opened text would pass either way and stop being a check.
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

    /* ---------------------------------------------------------- position */

    {
      const before = consoleErrors.length;

      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const people = await app().db.repo('person').list({ limit: 1 });
        const account = await app().db.repo('account').create({
          name: 'Position current', kind: 'savings', institution: 'HDFC Bank',
          accountNumber: '50100777666555', holder: people[0]?.id ?? '',
          openingBalance: '250000',
        });
        for (const [date, kind, amount, category] of [
          ['2026-06-01', 'income', '150000', 'salary'],
          ['2026-06-05', 'expense', '45000', 'rent'],
          ['2026-06-09', 'expense', '18000', 'groceries'],
          ['2026-07-01', 'income', '150000', 'salary'],
          ['2026-07-05', 'expense', '45000', 'rent'],
          ['2026-07-11', 'expense', '21000', 'groceries'],
        ]) {
          await app().db.repo('transaction').create({
            date, kind, amount, category, account: account.id,
          });
        }
      }, IN_PAGE.context);

      await go(page, '#/finance/position');
      await page.waitForTimeout(700);
      const position = await page.locator('.app-content').innerText();

      check('the position page names the month its figures come from',
        /Where the money stands/.test(position) && /last complete month/.test(position),
        position.slice(0, 500));

      // The rule the whole page is built on: an unfinished month is reported
      // apart from the complete one and marked as unfinished.
      check('and keeps the month in progress apart from it, labelled',
        /so far/.test(position) && /not comparable with a complete month/.test(position),
        position.slice(0, 900));

      check('every line says where it came from',
        /transactions dated in/.test(position) && /bills included/.test(position),
        position.slice(0, 900));

      check('the position page renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-position');
    }

    /* ------------------------------------------------------------- goals */

    {
      const before = consoleErrors.length;

      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const people = await app().db.repo('person').list({ limit: 1 });
        const solo = await app().db.repo('account').create({
          name: 'House fund', kind: 'savings', institution: 'HDFC Bank',
          accountNumber: '50100999888777', holder: people[0]?.id ?? '',
          openingBalance: '500000',
        });
        const shared = await app().db.repo('account').create({
          name: 'Shared savings', kind: 'savings', institution: 'ICICI Bank',
          accountNumber: '50100111222333', holder: people[0]?.id ?? '',
          openingBalance: '300000',
        });
        // One goal that can be measured, and two that cannot because they
        // both claim the same account.
        await app().db.repo('goal').create({
          name: 'House deposit', kind: 'purchase', targetAmount: '2000000',
          targetDate: '2030-01-01', accounts: [solo.id],
        });
        await app().db.repo('goal').create({
          name: 'New car', kind: 'vehicle', targetAmount: '800000',
          accounts: [shared.id],
        });
        await app().db.repo('goal').create({
          name: 'Holiday', kind: 'travel', targetAmount: '200000',
          accounts: [shared.id],
        });
      }, IN_PAGE.context);

      await go(page, '#/finance/goal');
      await page.waitForTimeout(600);
      const goals = await page.locator('.app-content').innerText();

      // Deliberately not just the goal's name — the list prints that with or
      // without the banner, so a check on the name alone passes when the
      // banner is not drawn at all. This asserts the banner's own heading and
      // the arithmetic only it produces.
      check('a goal says where it stands, funded against its target',
        /Where each goal stands/.test(goals) && /25%/.test(goals)
        && /a month to reach it by then/.test(goals),
        goals.slice(0, 700));

      // The whole design: two goals funded by one account get no percentage,
      // because showing both as funded from the same money would say the
      // household has twice what it has.
      check('two goals on one account are refused a figure, and told why',
        /same money cannot fund both/.test(goals), goals.slice(0, 600));

      check('the goals banner renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-goals');
    }

    /* ------------------------------------------------- profile completion */

    {
      const before = consoleErrors.length;

      await go(page, '#/identity/person');
      await page.waitForTimeout(500);
      const people = await page.locator('.app-content').innerText();

      check('the people tab says how complete each profile is',
        /%/.test(people) && /Profiles/.test(people), people.slice(0, 400));

      // A bare percentage is a scold. The whole design rests on the number
      // being followed by what it is short of, so this checks the sentence
      // and not just the figure.
      check('and names the sections it is waiting on rather than only a figure',
        /waiting on/.test(people) || /sections/.test(people), people.slice(0, 400));

      check('the completion banner renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'identity-completion');
    }

    /* --------------------------------------------------- the identity wallet */

    /*
     * Identity documents as cards, and what the cards refuse to claim.
     *
     * Two things are being checked and they pull in opposite directions: the
     * card has to be *useful* — you can tell at a glance which document has
     * lapsed — and it has to be *honest*, which here means it must not carry
     * the number and must not imply anybody checked it.
     */
    {
      const before = consoleErrors.length;

      const seeded = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const db = app().db;
        const person = await db.repo('person').create({ name: 'Wallet Holder' });

        // One of each state, so the ordering has something to order.
        await db.repo('identityDocument').create({
          person: person.id, kind: 'Passport', number: 'Z9876543',
          expiresOn: '2020-01-01', issuedBy: 'RPO',
        });
        await db.repo('identityDocument').create({
          // Each kind has its own format rule in `data/formats.js`, so these
          // are real-shaped numbers rather than obviously fake ones.
          person: person.id, kind: 'Driving licence', number: 'KA0120191234567',
          expiresOn: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
        });
        await db.repo('identityDocument').create({
          person: person.id, kind: 'Voter ID', number: 'VOT7654321',
        });
        return { person: person.id };
      }, IN_PAGE.context);

      await go(page, '#/identity/identityDocument');
      await page.waitForTimeout(700);

      const strip = await page.evaluate(() => ({
        cards: [...document.querySelectorAll('.wallet-strip .wallet-card')].map((el) => ({
          text: /** @type {any} */ (el).innerText ?? '',
          href: el.getAttribute('href') ?? '',
        })),
        text: /** @type {any} */ (document.querySelector('.app-content'))?.innerText ?? '',
      }));

      check('identity documents are drawn as cards', strip.cards.length === 3,
        `${strip.cards.length} cards`);

      // The order is the finding, not decoration: the expired one first.
      // Case-insensitive: the card title is upper-cased in CSS, and
      // `innerText` returns what is rendered rather than what was written.
      check('and the expired one comes first',
        /passport/i.test(strip.cards[0]?.text ?? ''), strip.cards[0]?.text?.slice(0, 80) ?? '');

      /*
       * A document with no expiry is not a document that is fine.
       *
       * The first version of this check only looked for the words "no expiry
       * recorded" — which the card prints as its meta line whatever state it
       * is in. It passed against a mutation that made a missing date read as
       * *in date*, so it could not fail for the thing its own name described.
       * The badge is what carries the claim, so the badge is what is asserted.
       */
      const voterCard = strip.cards.find((one) => /voter/i.test(one.text));
      check('a document with no expiry says so rather than reading as in date',
        Boolean(voterCard) && /no expiry recorded/i.test(voterCard.text)
        && !/in date/i.test(voterCard.text),
        (voterCard?.text ?? 'no voter card').replace(/\n/g, ' ').slice(0, 200));

      // Every card carries when the record was last changed. `walletCard`
      // makes `updated` required for exactly this reason.
      check('every card says when the record was last changed',
        strip.cards.every((one) => /last changed|never changed/i.test(one.text)),
        strip.cards.map((one) => one.text.replace(/\n/g, ' ')).join(' | ').slice(0, 300));

      // The numbers. This is the sweep's rule applied at the point it matters
      // most — a hand-built card is exactly the surface that bypasses the
      // field renderer.
      for (const raw of ['Z9876543', 'KA0120191234567', 'VOT7654321']) {
        check(`the wallet does not print ${raw.slice(0, 2)}… in full`,
          !strip.text.includes(raw), strip.text.slice(0, 200));
      }
      check('but it does show the last four characters, so a card is recognisable',
        /6543/.test(strip.text) && /4321/.test(strip.text), strip.text.slice(0, 300));

      /*
       * And the claim a card must never make.
       *
       * Scoped to the cards, not the page. The first version asserted the
       * word "verified" appeared nowhere on the screen and failed on the
       * sentence that exists to deny it — *nothing here is verified, only
       * recorded*. A check that forbids a word punishes the honest use of it;
       * what matters is that no card carries it as a status.
       */
      check('no card claims to be verified',
        strip.cards.every((one) => !/verified/i.test(one.text)),
        strip.cards.map((one) => one.text.replace(/\n/g, ' ')).join(' | ').slice(0, 300));
      check('and it says plainly that nothing was checked against a registry',
        /DigiLocker/.test(strip.text) && /not verified|only recorded/i.test(strip.text),
        strip.text.slice(-400));

      check('a card links to the record it came from',
        (strip.cards[0]?.href ?? '').includes('identityDocument/'), strip.cards[0]?.href ?? '');

      check('the wallet renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'identity-wallet');

      // Put it back: later checks count records and read this screen.
      await page.evaluate(async ([spec, personId]) => {
        const { app } = await import(spec);
        for (const row of await app().db.repo('identityDocument').list({ limit: 50 })) {
          if (row.person === personId) await app().db.repo('identityDocument').remove(row.id);
        }
        await app().db.repo('person').remove(personId);
      }, [IN_PAGE.context, seeded.person]);
    }

    /* ------------------------------------------- a delete that cannot happen */

    {
      // The repository refuses a delete that would leave a required reference
      // dangling. This checks the screen agrees *before* the person commits:
      // a Delete button that is going to fail teaches somebody the button lies.
      const personId = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const person = await app().db.repo('person').create({ name: 'Blocked Someone' });
        await app().db.repo('healthRecord').create({
          person: person.id, date: '2026-08-01', kind: 'consultation', title: 'Check-up',
        });
        return person.id;
      }, IN_PAGE.context);

      await go(page, `#/identity/person/${personId}`);
      await page.locator('.app-content button:has-text("Delete")').first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });

      const dialog = await page.locator('.modal').innerText();
      check('a delete blocked by a required reference says so instead of offering Delete',
        /cannot be deleted/.test(dialog), dialog.slice(0, 300));
      // One dependent, so every count in the sentence is singular. Agreement
      // is checked because this dialog is the whole of what somebody is told,
      // and "1 health records need it" is how a screen loses their trust.
      check('and the sentence agrees with the number it is reporting',
        /1 record needs it/.test(dialog) && /1 health record\b/.test(dialog)
        && !/health records/.test(dialog), dialog.slice(0, 300));
      check('and the dialog offers no Delete button',
        (await page.locator('.modal-footer button:has-text("Delete")').count()) === 0, dialog.slice(0, 300));

      await page.locator('.modal-footer button').first().click();
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      const survived = await page.evaluate(async ({ spec, id }) => {
        const { app } = await import(spec);
        return Boolean(await app().db.repo('person').get(id));
      }, { spec: IN_PAGE.context, id: personId });
      check('and the person is still there afterwards', survived, String(survived));
    }

    /* ------------------------------------------------ masked identifiers */

    {
      const before = consoleErrors.length;

      // A passport number is the case the whole classification layer was built
      // for: sensitive, an identifier, and a list column — so before this it
      // was printed in full on a screen anyone walking past could read.
      const docId = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const people = await app().db.repo('person').list({ limit: 1 });
        const doc = await app().db.repo('identityDocument').create({
          person: people[0]?.id ?? '', kind: 'Passport', number: 'Z1234567',
          issuedBy: 'RPO Bengaluru', expiresOn: '2032-01-01',
        });
        return doc.id;
      }, IN_PAGE.context);

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
      /*
       * Annotated, because an array of `[string, RegExp]` pairs is inferred
       * as `(string | RegExp)[][]` and `expected.test` is then a type error
       * on a line that is perfectly correct at run time.
       */
      /** @type {[string, RegExp][]} */
      const ledgers = [
        ['people', /Person to person|No person-to-person|Nothing imported yet/i],
        ['lending', /Borrowing and lending|No borrowing|Nothing imported yet/i],
        ['insights', /Worth saying out loud|Nothing imported yet/i],
      ];
      for (const [tab, expected] of ledgers) {
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

    /* --------------------------------- how long the money lasts, on screen */

    {
      // Wired in the same tranche that built it. "The domain function exists
      // and no screen calls it" is the finding this repository keeps making,
      // and it is only ever found by driving the screen.
      const before = consoleErrors.length;

      await go(page, '#/finance');
      await page.waitForTimeout(800);
      const shown = (await page.locator('.app-content').innerText()).trim();

      check('the Finance screen says how long the money lasts',
        /runs the account out|exceeds what is in the account/i.test(shown),
        shown.slice(0, 900));

      // The refusal that matters most on a forecast: it must never tell a
      // household they are fine, because unrecorded spending happens daily and
      // this arithmetic cannot see it.
      check('and never tells the household they are fine',
        !/\b(you are fine|comfortable|plenty|safe)\b/i.test(shown), shown.slice(0, 900));

      // A forecast whose assumptions are hidden is a forecast presenting itself
      // as an answer.
      check('the assumptions are on the screen beside the figure',
        /Assuming:/.test(shown), shown.slice(0, 900));

      check('no arithmetic leaked into the forecast',
        !/Infinity|NaN|undefined/.test(shown), shown.slice(0, 900));

      check('the forecast renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-runway');
    }

    /* ------------------------- spending unlike its own history, on screen */

    {
      // The wiring for this failed silently three times while it was written —
      // a month key read from the wrong field, an unsorted array taken as
      // sorted, and an import that matched nothing. Every one produced no
      // error and no output, and the unit tests passed throughout. Only
      // driving a real transaction to a real screen tells a working panel from
      // an absent one.
      const before = consoleErrors.length;

      await go(page, '#/finance');
      await go(page, '#/finance/transaction/new');
      await page.waitForTimeout(600);
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-transaction-date').fill('2026-07-11');
      await page.locator('#f-transaction-kind').selectOption('expense');
      await page.locator('#f-transaction-amount').fill('85000');
      await page.locator('#f-transaction-category').selectOption('health');
      await page.locator('#f-transaction-payee').fill('Apollo Hospitals');
      await page.locator('#f-transaction-account').selectOption({ index: 1 });
      await page.locator('#f-transaction-payee').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/finance/insights');
      await page.waitForTimeout(700);
      const shown = (await page.locator('.app-content').innerText()).trim();

      check('a category never spent on before is named on the Insights screen',
        /first time anything has been spent there/i.test(shown), shown.slice(0, 800));

      check('and the amount is on the screen beside it',
        /85,000/.test(shown), shown.slice(0, 800));

      // The refusal that matters most, driven rather than asserted in a unit
      // test: with no history there is no ratio. Scoped to the sentence that
      // makes the claim — other findings on this screen legitimately carry a
      // multiple, and scanning the whole page for the word "times" was an
      // assertion about the wrong thing.
      const firstTime = /[^.]*first time anything has been spent there[^.]*\./i.exec(shown)?.[0] ?? '';
      check('a first occurrence is never given a multiple',
        firstTime.length > 0 && !/\btimes\b/i.test(firstTime), firstTime || '(no sentence)');

      // And nothing anywhere on the screen divided by zero on the way.
      check('no arithmetic leaked onto the screen',
        !/Infinity|NaN/.test(shown), shown.slice(0, 800));

      check('the insights screen renders it without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-unusual');
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

    /* ------------ repeating charges the records do not account for */

    {
      // The records say what the household meant to commit to; the statement
      // says what actually leaves. Nothing had ever put the two side by side.
      //
      // Driven through the real form because that is the whole lesson of the
      // receipt-match panel: a screen that is deliberately silent when it has
      // nothing to say looks identical, from outside, to one that never runs.
      const before = consoleErrors.length;

      const addCharge = async (payee, amount, date) => {
        // Away and back: the router keys on the hash, so navigating to the
        // same one twice does nothing and the second form never opens.
        await go(page, '#/finance');
        await go(page, '#/finance/transaction/new');
        await page.waitForTimeout(600);
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-transaction-date').fill(date);
        await page.locator('#f-transaction-kind').selectOption('expense');
        await page.locator('#f-transaction-amount').fill(amount);
        await page.locator('#f-transaction-payee').fill(payee);
        await page.locator('#f-transaction-account').selectOption({ index: 1 });
        await page.locator('#f-transaction-payee').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });
      };

      // Three months of a charge nobody recorded anywhere.
      const monthsAgo = (n) => {
        const d = new Date();
        d.setMonth(d.getMonth() - n);
        d.setDate(14);
        return d.toISOString().slice(0, 10);
      };
      for (const n of [3, 2, 1]) await addCharge('CLOUD BACKUP', '1180', monthsAgo(n));

      // And three of one that *is* recorded — a Netflix subscription was added
      // on the Digital screen above. This is the half that stops the panel
      // crying wolf about money the household has already written down.
      for (const n of [3, 2, 1]) await addCharge('NETFLIX', '649', monthsAgo(n));

      await go(page, '#/finance');
      await page.waitForTimeout(900);
      const text = (await page.locator('.app-content').innerText()).trim();

      check('a repeating charge no record explains is named on the Finance screen',
        /no record here explains/.test(text) && /CLOUD BACKUP/i.test(text),
        text.slice(0, 900));

      // The provenance matters as much as the figure: this one is read from
      // statements rather than from the list of records above it, and a
      // household should be told which.
      check('and the sentence says it was read from the statements, not the records',
        /not added to the figure above/.test(text), text.slice(0, 900));

      // The other direction. Netflix repeats identically and is recorded, so
      // reporting it here would be telling a household they have a commitment
      // they had in fact already entered.
      const claim = /no record here explains[^.]*\./.exec(text)?.[0] ?? '';
      check('a charge the household already recorded is not reported as unaccounted',
        claim.length > 0 && !/NETFLIX/i.test(claim), claim || '(no sentence)');

      check('the unaccounted figure renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'finance-unaccounted');
    }

    /* ----------------------------------------------------------- mileage */

    {
      const before = consoleErrors.length;

      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const people = await app().db.repo('person').list({ limit: 1 });
        const vehicle = await app().db.repo('vehicle').create({
          registration: 'KA01AB1234', make: 'Maruti', model: 'Swift',
          owner: people[0]?.id ?? '', kind: 'car',
        });
        // Three full tanks, so two measurable stretches.
        for (const row of [
          { date: '2026-05-01', odometer: '10000', litres: '35', amount: '3500' },
          { date: '2026-05-20', odometer: '10420', litres: '30', amount: '3000' },
          { date: '2026-06-10', odometer: '10850', litres: '32', amount: '3200' },
        ]) {
          await app().db.repo('fuelLog').create({
            vehicle: vehicle.id, ...row, fullTank: true,
          });
        }
      }, IN_PAGE.context);

      await go(page, '#/vehicles/vehicle');
      await page.waitForTimeout(700);
      const vehicles = await page.locator('.app-content').innerText();

      // Counted, not merely present: the registration appears in the list
      // below regardless, so `.test()` passed even when the banner rendered
      // every row as "Vehicle". An earlier version spread the mileage result
      // over the vehicle record and replaced it with an id; a check for
      // "km/l" passed, and so did a check that the registration appeared.
      const named = (vehicles.match(/KA01AB1234/g) ?? []).length;
      check('a vehicle says what it returns to a litre, and which vehicle it is',
        /km\/l/.test(vehicles) && /What each one returns/.test(vehicles)
        && named >= 2,
        `registration appeared ${named} time(s) — ${vehicles.slice(0, 700)}`);

      // The refusal is the point, and it has to be on the screen.
      check('and the screen says a missed fill-up cannot be detected',
        /roughly twice what it should/.test(vehicles), vehicles.slice(0, 1400));

      check('the mileage card renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'vehicles-mileage');
    }

    /* ------------------------------------------------------- connections */

    {
      const before = consoleErrors.length;

      const docId = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const people = await app().db.repo('person').list({ limit: 1 });
        const accounts = await app().db.repo('account').list({ limit: 1 });
        const doc = await app().db.repo('document').create({
          title: 'Connected lease deed', category: 'property',
          person: people[0]?.id ?? '',
        });
        // Two transactions with the same document attached. Before the fix
        // this reported nothing: an attachment was not a reference.
        for (const date of ['2026-06-01', '2026-07-01']) {
          await app().db.repo('transaction').create({
            date, kind: 'expense', amount: '5000', category: 'rent',
            account: accounts[0]?.id ?? '', documents: [doc.id],
          });
        }
        return doc.id;
      }, IN_PAGE.context);

      await go(page, `#/documents/document/${docId}`);
      await page.waitForTimeout(700);
      const detail = await page.locator('.app-content').innerText();

      check('a record says what is connected to it',
        /Connected records/.test(detail), detail.slice(0, 700));

      // The half that was invisible: an attachment is a reference.
      check('and an attachment counts, in the direction that matters',
        /records refer to it/.test(detail) && /via Documents/.test(detail),
        detail.slice(0, 1200));

      check('the connections card renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'record-connections');
    }

    /* ------------------------------------------- rent, and whose it was */

    {
      const before = consoleErrors.length;

      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const people = await app().db.repo('person').list({ limit: 1 });
        const owner = people[0]?.id ?? '';
        const account = await app().db.repo('account').create({
          name: 'Rent account', kind: 'savings', institution: 'HDFC Bank',
          accountNumber: '50100222111000', holder: owner, openingBalance: '0',
        });
        // Two flats let at the same rent, and one credit. Before attribution
        // both reported it as received and both offered a receipt.
        for (const name of ['Rose Villa', 'Lily Cottage']) {
          await app().db.repo('property').create({
            name, kind: 'apartment', owner, rented: true, monthlyRent: '35000',
            tenantName: 'R Krishnan',
          });
        }
        const now = new Date();
        const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-05`;
        await app().db.repo('transaction').create({
          date: day, kind: 'income', amount: '35000', category: 'rental income',
          account: account.id, direction: 'in',
        });
      }, IN_PAGE.context);

      await go(page, '#/reports');
      await page.waitForTimeout(800);
      const reports = await page.locator('.app-content').innerText();

      check('rent receipts name both lettings', /Rose Villa/.test(reports)
        && /Lily Cottage/.test(reports), reports.slice(0, 600));

      // The whole point: one payment must not become two signed receipts.
      check('a credit two lettings could claim is given to neither, and says so',
        /could belong to more than one letting/.test(reports), reports.slice(0, 1200));

      check('the rent report renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'reports-rent');
    }

    /* ------------------------------ a docx template, through the real input */

    {
      // Phase 3's engine reads a .docx; this proves a household can reach it.
      const before = consoleErrors.length;

      await go(page, '#/reports');
      await page.waitForTimeout(600);

      // Built here rather than inside the page: the same `zip` the application
      // ships, so this exercises the reader rather than a fixture the reader
      // was written around — and importing it in Node keeps the type checker
      // able to resolve it, which a `page.evaluate` import does not.
      const enc = (text) => new TextEncoder().encode(text);
      // A placeholder split across runs, which is what Word actually writes
      // once a person has edited the sentence.
      const templateXml = '<w:document><w:body><w:p>'
        + '<w:r><w:t>Received from </w:t></w:r>'
        + '<w:r><w:t>{{Ten</w:t></w:r><w:r><w:t>ant}}</w:t></w:r>'
        + '<w:r><w:t> the sum of {{Amount}}.</w:t></w:r>'
        + '</w:p></w:body></w:document>';
      const bytes = zip([
        { name: '[Content_Types].xml', data: enc('<Types/>') },
        { name: 'word/document.xml', data: enc(templateXml) },
      ]);

      await page.locator('#docx-template').setInputFiles({
        name: 'rent-agreement.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(bytes),
      });
      await page.waitForTimeout(600);

      const said = (await page.locator('.app-content').innerText()).trim();

      check('a .docx template is read and its fields listed',
        /2 fields found/.test(said) && /rent-agreement\.docx/.test(said), said.slice(0, 700));

      // The split placeholder is the whole difficulty. A naive reader finds
      // neither field and reports an empty template as read.
      check('and a placeholder Word split across runs is one of them',
        (await page.locator('#docx-field-Tenant').count()) === 1,
        said.slice(0, 700));

      check('the screen says an empty field keeps its marker',
        /keeps its marker/.test(said), said.slice(0, 700));

      check('reading a template raises no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'reports-template');
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
      // A receipt, and the payment it records, end to end.
      {
        await go(page, '#/finance/transaction');
        await page.waitForTimeout(400);
        await page.getByRole('button', { name: /Add/ }).first().click();
        await page.waitForSelector('.modal', { timeout: 5000 });
        await page.locator('#f-transaction-date').fill('2026-07-10');
        await page.locator('#f-transaction-kind').selectOption('expense');
        await page.locator('#f-transaction-amount').fill('48500');
        await page.locator('#f-transaction-payee').fill('Greenwood School');
        await page.locator('#f-transaction-account').selectOption({ index: 1 });
        await page.locator('#f-transaction-payee').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

        await go(page, '#/documents');
        await page.waitForTimeout(400);
        await page.locator('input[type=file]:not([capture])').setInputFiles({
          name: 'Fee receipt.pdf',
          mimeType: 'application/pdf',
          buffer: tinyPdf([
            'GREENWOOD PUBLIC SCHOOL', 'Fee Receipt',
            'Receipt No: GPS/2026/04412   Date: 12 Jul 2026',
            'Amount: Rs. 48,500.00',
          ]),
        });
        await page.waitForSelector('.modal', { timeout: 8000 });
        await page.locator('#f-document-title').fill('School fee receipt');
        await page.locator('#f-document-title').press('Enter');
        await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 });
        await page.getByRole('link', { name: /School fee receipt/ }).first().click()
          .catch(() => page.locator('text=School fee receipt').first().click());
        await page.waitForTimeout(1500);
        const shown = (await page.locator('.app-content').innerText()).trim();

        // `receiptMatchesIn` existed for a tranche with nothing calling it, and
        // the first wiring hooked it inside `paintReading` — which returns
        // early when a document's text was read and there are no identifiers to
        // offer, which is exactly what a receipt is. It never ran, and the
        // panel is silent when it has nothing to say, so only a check that
        // drives a real receipt against a real payment could tell.
        check('a receipt names the payment it is the receipt for',
          /The payment this receipt is for/.test(shown), shown.slice(0, 1200));
        check('and offers to file it against that payment',
          (await page.getByRole('button', { name: /File it against this/ }).count()) >= 1,
          shown.slice(0, 1200));
      }

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

      // Calendar connector health, driven through the real button. Nothing is
      // signed in, so the push raises a 401 — the same shape as a grant the
      // household has withdrawn, and the state that used to be invisible.
      {
        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          await app().db.setMeta('connector.health', {});
        }, IN_PAGE.context);

        await go(page, '#/calendar');
        await page.waitForTimeout(400);

        const sync = page.getByRole('button', { name: 'Sync to Google' });
        if (await sync.count()) {
          await sync.click();
          await page.waitForTimeout(1200);

          const stored = await page.evaluate(async (spec) => {
            const { app } = await import(spec);
            const health = await app().db.meta('connector.health', {});
            return health['google:calendar']?.status ?? null;
          }, IN_PAGE.context);

          check('a calendar push that fails is remembered, not just toasted',
            stored !== null, JSON.stringify(stored));

          // And it reaches the one place a household would look for it.
          await go(page, '#/settings');
          await page.waitForTimeout(600);
          const settings = (await page.locator('.app-content').innerText()).trim();

          check('and a broken connection is named in Settings',
            /Connections that need you/.test(settings)
            || /Google Calendar/.test(settings), settings.slice(0, 500));
        }

        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          await app().db.setMeta('connector.health', {});
        }, IN_PAGE.context);
      }

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

      // A third record, against a *different* person, carrying the same CKYC
      // identifier. This is the prompt's CRITICAL identity test, and the
      // reason it is driven through the form is that the engine reported it
      // for a whole tranche while no screen drew it.
      await go(page, '#/identity/kycRecord');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      await page.locator('#f-kycRecord-person').selectOption({ index: 2 });
      await page.locator('#f-kycRecord-institution').fill('Axis Bank');
      await page.locator('#f-kycRecord-recordedOn').fill('2026-02-20');
      await page.locator('#f-kycRecord-kin').fill('12345678901234');
      await page.locator('#f-kycRecord-institution').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/identity/kycRecord');
      await page.waitForTimeout(600);

      const conflicts = page.locator('.kyc-conflicts');
      const conflictText = (await conflicts.count()) ? await conflicts.innerText() : '';

      check('one CKYC identifier against two people reaches the screen',
        /KIN recorded against 2 people/i.test(conflictText)
        && /different people/i.test(conflictText),
        conflictText.slice(0, 400) || '(no conflict card)');

      // The engine returns the field name and never the value. A screen that
      // printed the identifier would undo that on its own.
      check('and the identifier itself is not printed anywhere on it',
        conflictText.length > 0 && !/12345678901234/.test(conflictText),
        conflictText.slice(0, 400));

      check('the screen refuses to merge or decide',
        /Nothing here is merged, corrected or decided/.test(conflictText),
        conflictText.slice(0, 400));

      // Order is the message. One identifier held against two people is not a
      // worse address disagreement, and putting it under one would bury the
      // only finding here that can mean somebody's identity is being used
      // twice. Asserted against the DOM because it is a claim about the DOM.
      const order = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.kyc-conflicts, .kyc-drift')];
        return cards.map((node) => (node.classList.contains('kyc-conflicts')
          ? 'conflicts' : 'drift'));
      });
      check('and the conflict card sits above the per-person drift',
        order[0] === 'conflicts' && order.includes('drift'), order.join(' > '));

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
      // `h2`: a card heading became one when the application stopped
      // jumping from h1 to h3 on every screen.
      .filter({ has: page.locator('h2', { hasText: /^Answer$/ }) })
      .first().innerText();
    check('the assistant answers a question from stored data',
      /net worth/i.test(answer), answer.slice(0, 120));

    /* ------------------------------- a listed row that said it was fine */

    /*
     * The badge must agree with the list it is in.
     *
     * `expiryReminders` decides a passport is worth showing 180 days out,
     * because that is what the schema declares for it. The dashboard then
     * re-decided urgency with a flat thirty days — so a passport 100 days from
     * expiry appeared under "Expiring & due" wearing a green badge.
     *
     * Nothing caught it: every unit test of the domain was right, every unit
     * test of the badge was right, and the disagreement lived in the gap
     * between them where only a rendered row can be looked at.
     */
    {
      const soon = new Date(Date.now() + 100 * 86400_000).toISOString().slice(0, 10);

      const holder = await page.evaluate(async ([spec, expires]) => {
        const { app } = await import(spec);
        const person = await app().db.repo('person').create({ name: 'Lead Holder' });
        await app().db.repo('identityDocument').create({
          person: person.id, kind: 'Passport', number: 'P1234567', expiresOn: expires,
        });
        return person.id;
      }, [IN_PAGE.context, soon]);

      await go(page, '#/dashboard');
      await page.waitForTimeout(900);

      const row = await page.evaluate(() => {
        const found = [...document.querySelectorAll('.app-content .list-item')]
          .find((el) => /passport/i.test(/** @type {any} */ (el).innerText ?? ''));
        if (!found) return null;
        const badge = found.querySelector('.badge');
        return {
          text: /** @type {any} */ (found).innerText ?? '',
          badge: badge?.textContent?.trim() ?? '',
          classes: badge?.className ?? '',
        };
      });

      check('a passport inside its own warning window reaches the dashboard',
        Boolean(row), 'no row mentioning a passport was drawn');

      check('and its badge does not say it is fine',
        Boolean(row) && !/badge--positive/.test(row.classes),
        row ? `${row.badge} (${row.classes})` : 'no row');

      // The control: a badge that rendered no tone at all would pass the line
      // above for the wrong reason.
      check('and the badge does carry a tone',
        Boolean(row) && /badge--(danger|warning)/.test(row.classes),
        row ? `${row.badge} (${row.classes})` : 'no row');

      await page.evaluate(async ([spec, personId]) => {
        const { app } = await import(spec);
        for (const one of await app().db.repo('identityDocument').list({ limit: 50 })) {
          if (one.person === personId) await app().db.repo('identityDocument').remove(one.id);
        }
        await app().db.repo('person').remove(personId);
      }, [IN_PAGE.context, holder]);
    }

    /* -------------------------------------------- nominations on the dashboard */

    {
      await go(page, '#/dashboard');
      await page.waitForTimeout(700);

      const widget = page.locator('.nominations');
      const said = (await widget.count()) ? await widget.innerText() : '';

      check('the dashboard says which records have nobody nominated',
        /Nobody nominated/i.test(said), said.slice(0, 300) || '(no nominations widget)');

      // The claim the whole module is built around, on the screen rather than
      // in a comment.
      check('and says plainly that a nominee is not an heir',
        /not who inherits/i.test(said), said.slice(0, 300));

      // The failure this tranche exists to prevent. A sealed value passing as a
      // name would put `enc:v1:…` on the dashboard and empty the gap list.
      check('no ciphertext reaches the dashboard',
        said.length > 0 && !/enc:v1:/.test(said), said.slice(0, 300));

      // The account given a nominee through the form is not in the gap list;
      // the ones without one are.
      check('the record with a nominee is not listed as a gap',
        !/HDFC Savings/.test(said), said.slice(0, 300));
    }

    /* -------------------------------------------------------------- wills */

    {
      const before = consoleErrors.length;

      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const people = await app().db.repo('person').list({ limit: 2 });
        const meera = people[0]?.name ?? 'Meera Narayan';
        const account = await app().db.repo('account').create({
          name: 'Legacy Savings', kind: 'savings', institution: 'HDFC Bank',
          accountNumber: '50100444333222', holder: people[0]?.id ?? '',
          openingBalance: '400000', nominee: meera,
        });
        const will = await app().db.repo('will').create({
          title: 'Will of 2026', testator: people[0]?.id ?? '',
          executedOn: '2026-01-11', whereKept: 'Bank locker',
        });
        await app().db.repo('beneficiary').create({
          will: will.id, name: 'Somebody Else Entirely',
          assetId: account.id, share: 'one half',
        });
      }, IN_PAGE.context);

      await go(page, '#/vault/will');
      await page.waitForTimeout(700);
      const wills = await page.locator('.app-content').innerText();

      // The refusal is on the screen, not in a comment.
      check('the vault says a note is not the will',
        /The will itself decides/.test(wills), wills.slice(0, 600));

      check('a nomination and a bequest naming different people are shown together',
        /name different people/.test(wills) && /Somebody Else Entirely/.test(wills),
        wills.slice(0, 1400));

      check('and neither is declared correct',
        /not for this application to say/.test(wills), wills.slice(0, 1400));

      check('the will comparison renders without a console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      if (SHOTS) await shot(page, 'vault-wills');
    }

    /* ------------------------------------------- what has been happening */

    {
      // The activity feed, as things rather than log lines. It used to be the
      // last eight audit entries, and not one of them said *which* record had
      // changed — an audit entry carries an id, and `describe` could only
      // reach the entity's label.
      await go(page, '#/dashboard');
      // The dashboard now resolves a title per story, so it paints later than
      // it used to. Waiting on a card rather than on a guessed number of
      // milliseconds, and reading `#app` — `.app-content` is replaced during
      // the paint, and reading it too early returns the header alone.
      await page.waitForSelector('.app-content .card', { timeout: 10_000 });
      await page.waitForTimeout(1200);
      const feed = (await page.locator('#app').innerText()).trim();

      // The KYC records are the newest things this run created, so they are
      // what the feed is about. Asserting a record created early would be
      // asserting that a CSV import of a hundred rows had not happened since —
      // which is how the first version of this check failed.
      check('the activity feed names the record it is about',
        /Axis Bank|HDFC Bank|Zerodha/.test(feed), feed.slice(-900));
      // One sitting is one line. Three KYC records added in a row must not
      // read as one line per field.
      //
      // Word-bounded: `kin` without them matches "banking" and "kind", and the
      // first version of this failed on the word "Investments" — the same
      // mistake the `wired:` probe was given boundaries to avoid, repeated one
      // file along.
      check('and does not repeat one record once per field changed',
        !/\b(kin|heldAddress|recordedOn)\b/.test(feed), feed.slice(-900));
    }

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
    /*
     * Sideways scroll, on every screen rather than on this one.
     *
     * This check existed and only ever ran on the dashboard, which is the
     * screen least likely to fail it: it is cards. `#/finance/transaction`
     * pushed a 390px phone to 413px and had presumably done so for as long as
     * the filter row has had two date inputs in it — a `date` input needs 9rem
     * to render `dd/mm/yyyy` without truncating its own control, and two of
     * them plus the words between them do not fit.
     *
     * The layout above it hid the cause. `.app` used a `1fr` track and its
     * items took the default `min-width: auto`, and both of those refuse to go
     * below min-content, so `.app-main` measured 442px on a 390px screen and
     * every child dutifully filled a parent that was already too wide. No
     * single element looked at fault. Releasing both — `minmax(0, 1fr)` and
     * `min-width: 0` — made the real offender visible at 413px.
     *
     * Two widths, because 390px is not the narrowest Android in use. At 320px
     * the chat screen reached 339px on a badge reading `end-to-end, with one
     * exception` — the qualifier on the encryption claim, and so the last text
     * in the application that should be pushed off screen. Nothing else failed
     * at 320px, and nothing at all failed at 360, 412, 600 or 768, which is why
     * those are not walked on every run.
     *
     * The criterion is whether the *document* scrolls. An element wider than
     * its parent is not the same question: the calendar's month grid is
     * deliberately given negative margins on a phone so it can escape the
     * card's padding, and an SVG path routinely reports a box larger than the
     * `<svg>` around it. Both are fine and neither scrolls the page.
     */
    const SCREENS = ['dashboard', 'identity', 'family', 'finance',
      'finance/transaction', 'finance/account', 'investments', 'documents',
      'vehicles', 'health', 'insurance', 'property', 'education', 'tasks',
      'calendar', 'notes', 'vault', 'digital', 'emergency', 'safety', 'chat',
      'reports', 'assistant', 'settings', 'belongings', 'timeline', 'travel'];

    const widest = () => page.evaluate(() => {
      const limit = window.innerWidth + 1;
      if (document.documentElement.scrollWidth <= limit) return null;
      // Name the widest offender rather than reporting that "something" is
      // too wide, which is unactionable.
      const worst = [...document.querySelectorAll('.app *')]
        .map((el) => ({ el, right: el.getBoundingClientRect().right }))
        .filter((row) => row.right > limit)
        .sort((a, b) => b.right - a.right)[0];
      return worst
        ? `${worst.el.tagName.toLowerCase()}.${typeof worst.el.className === 'string'
          ? worst.el.className : ''} reaches ${Math.round(worst.right)}px`
        : `document is ${document.documentElement.scrollWidth}px wide`;
    });

    const seesaw = [];
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150);

      for (const screen of SCREENS) {
        await go(page, `#/${screen}`);
        await page.waitForTimeout(350);
        const overflow = await widest();
        if (overflow) seesaw.push(`${screen} at ${width}px: ${overflow}`);
      }
    }

    check('no screen scrolls sideways on a phone', seesaw.length === 0,
      seesaw.join('; '));

    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '#/dashboard');
    await page.waitForTimeout(300);
    if (SHOTS) await shot(page, 'phone');

    /* ------------------------------------------------------ tap targets */

    /*
     * `css/base.css` carried the sentence "Every tap target reaches the 44px
     * minimum on a touch screen" above a rule that never applied to anything.
     * It sat in `base.css`, which loads *before* `components.css`, and
     * `.btn { min-height: 38px }` there has identical specificity — so the
     * later declaration won and the minimum reached no button at all.
     *
     * Measuring what the browser actually laid out on a 390px viewport found
     * eighteen of twenty-three distinct control kinds under 44px. The smallest
     * were 17px: `.tab`, a class used in `js/modules/belongings.js` that had
     * no stylesheet rule anywhere. Next were the 30px `.btn--small` controls
     * that reveal and copy a masked account number.
     *
     * A stylesheet cannot be trusted to describe itself, so this measures the
     * rendered boxes instead. It walks screens rather than checking one, since
     * the failures were per-component and only three modules would have shown
     * them.
     *
     * Excluded, and why: `.sr-only` is 1×1 on purpose — it exists for screen
     * readers and is never aimed at — and `.skip-link` is off-screen until it
     * takes focus, at which point it is full size.
     */
    {
      const MINIMUM = 44;
      const smallest = new Map();

      /*
       * Both widths, because they are now genuinely different layouts rather
       * than the same one scaled. Below 360px the calendar's month grid drops
       * its gaps and bleeds to both screen edges, which is the only way seven
       * days reach 44px on a 320px phone — at 390px none of those rules apply.
       * A control can therefore be sound at one width and not the other, and
       * the day cell was: 44px at 390px, 36px at 320px.
       */
      const SCREENS = ['dashboard', 'finance', 'family', 'documents', 'vault',
        'calendar', 'safety', 'settings', 'reports', 'belongings', 'investments'];

      for (const viewport of [390, 320]) {
        await page.setViewportSize({ width: viewport, height: 844 });
        await page.waitForTimeout(150);

        for (const module of SCREENS) {
          await go(page, `#/${module}`);
          await page.waitForTimeout(400);

          const measured = await page.evaluate(() => {
            const rows = [];
            for (const el of document.querySelectorAll(
              'button, a[href], input, select, textarea, [role="button"]')) {
              const box = el.getBoundingClientRect();
              if (box.width === 0 || box.height === 0) continue;
              const style = getComputedStyle(el);
              if (style.visibility === 'hidden' || style.display === 'none') continue;
              const control = /** @type {any} */ (el);
              if (control.disabled) continue;

              const classes = typeof el.className === 'string' ? el.className : '';
              // Deliberately not tap targets. See the comment above.
              if (/(^|\s)(sr-only|skip-link)(\s|$)/.test(classes)) continue;
              if (control.type === 'hidden') continue;

              rows.push({
                kind: classes.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
                  || el.tagName.toLowerCase(),
                width: Math.round(box.width),
                height: Math.round(box.height),
                label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
              });
            }
            return rows;
          });

          for (const row of measured) {
            const least = Math.min(row.width, row.height);
            const known = smallest.get(row.kind);
            // `viewport`, not `width` — `row.width` is the element's own width
            // and overwriting it would report the phone's size as the control's.
            if (!known || least < known.least) {
              smallest.set(row.kind, { least, ...row, module, viewport });
            }
          }
        }
      }

      await page.setViewportSize({ width: 390, height: 844 });

      // If this finds nothing it has proved nothing, and a selector typo or a
      // failed navigation would look exactly like a pass.
      check('the tap-target sweep actually found controls to measure',
        smallest.size >= 15, `only ${smallest.size} kinds of control were seen`);

      const undersized = [...smallest.values()]
        .filter((one) => one.least < MINIMUM)
        .sort((a, b) => a.least - b.least);

      check(`every tap target reaches ${MINIMUM}px on a phone`,
        undersized.length === 0,
        undersized.map((one) =>
          `${one.kind} is ${one.width}\u00d7${one.height} in ${one.module}`
          + ` at ${one.viewport}px${one.label ? ` (${one.label})` : ''}`).join('; '));

      // The one that started this: the controls that unmask an identifier.
      const reveal = smallest.get('btn.btn--icon.btn--small')
        ?? [...smallest.entries()].find(([kind]) => kind.includes('btn--small'))?.[1];
      check('and the small buttons are among them rather than an exception',
        !reveal || reveal.least >= MINIMUM,
        reveal ? `${reveal.kind} is ${reveal.width}\u00d7${reveal.height}` : '');
    }

    /* --------------------------------------------------------- the chat */

    /*
     * A real conversation, sent and read back.
     *
     * Bubbles are the part of a chat that can look right and be wrong: a
     * message on the wrong side, or on the right side because every message is
     * on that side. So this sends one and asserts it lands as *mine* and that
     * the thread knows which side that is.
     *
     * It also asserts what the screen refuses to claim. Read receipts, unread
     * counts, typing and presence do not exist — `message.readBy` is declared
     * in the schema and written by nothing — and a screen that grew a tick
     * would be reading it off a field that has never held a value.
     */
    {
      await page.setViewportSize({ width: 1280, height: 900 });

      // Through the empty state's own button, which is the path somebody with
      // no conversations actually has. Reaching for the list's Add button
      // instead is how this check first failed: that control sits inside a
      // disclosure that is folded away, so the test was clicking something
      // nobody could see — and so, at the time, was the empty state's advice.
      await go(page, '#/chat');
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: 'Start a conversation' }).click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      // Title, a participant and a start date — the three the schema requires.
      // `participants` is a multiref, which the form draws as a checkbox set.
      await page.locator('#f-conversation-title').fill('Household');
      // The label, not the input. `checkboxSet` renders the input `sr-only` and
      // puts the visible chip on the label, so the input is exactly what a
      // person cannot click — and a test that forced it would be exercising a
      // path the application does not offer.
      //
      // The person using this device, by name, rather than whichever chip is
      // first. A conversation between two other people is sealed to *their*
      // devices, so sending into one from here fails — correctly — with
      // "nobody in this conversation has a device that can read a message
      // yet". Picking the first chip made that the thing under test by
      // accident, and 0 bubbles looked like a rendering bug.
      const meName = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        return app().db.actor?.name ?? '';
      }, IN_PAGE.context);
      check('the sign-in is linked to a named person', Boolean(meName), meName);
      await page.locator('.modal [data-field="participants"] label.chip')
        .filter({ hasText: meName }).first().click();
      await page.locator('#f-conversation-startedAt').fill(todayIso());
      await page.locator('#f-conversation-title').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 8000 });

      await go(page, '#/chat');
      await page.waitForTimeout(700);

      const listed = await page.evaluate(() => /** @type {any} */ (
        document.querySelector('.app-content'))?.innerText ?? '');
      check('a conversation appears in the thread list', listed.includes('Household'),
        listed.slice(0, 120));
      check('and says nothing has been said in it yet',
        listed.includes('Nothing said yet'), listed.slice(0, 200));

      await page.getByRole('link', { name: 'Household' }).first().click();
      await page.waitForTimeout(700);

      /*
       * The composer before this device has a chat key.
       *
       * This is where the check found a real fault. The composer drew a text
       * box and a Send button on a device with no chat identity, took the
       * typing, and only then failed with an error toast. So the box and the
       * button must both be absent, the reason must be on screen, and the way
       * out of it must be a control here rather than advice to go elsewhere.
       */
      const cold = await page.evaluate(() => ({
        box: document.querySelectorAll('#chat-text').length,
        text: /** @type {any} */ (document.querySelector('.composer'))?.innerText ?? '',
      }));
      check('a device with no chat key is offered no message box',
        cold.box === 0, `${cold.box} boxes`);
      check('and is told why', cold.text.includes('no chat key'), cold.text.slice(0, 160));

      const sendBefore = await page.getByRole('button', { name: /^Send$/ }).count();
      check('and no Send button that would fail', sendBefore === 0, `${sendBefore} found`);

      // Enrol from the composer, which is where somebody who wanted to say
      // something is standing.
      await page.locator('.composer').getByRole('button', { name: 'Enrol this device' }).click();
      await page.waitForTimeout(900);

      const warm = await page.evaluate(() => ({
        box: document.querySelectorAll('#chat-text').length,
      }));
      check('enrolling from the composer gives it a message box',
        warm.box === 1, `${warm.box} boxes`);

      await page.locator('#chat-text').fill('Rent is paid');
      await page.getByRole('button', { name: /Send/ }).first().click();
      await page.waitForTimeout(900);

      const thread = await page.evaluate(() => ({
        bubbles: document.querySelectorAll('.bubble').length,
        mine: document.querySelectorAll('.bubble-row--mine').length,
        theirs: document.querySelectorAll('.bubble-row--theirs').length,
        text: /** @type {any} */ (document.querySelector('.app-content'))?.innerText ?? '',
      }));

      check('a sent message appears as a bubble', thread.bubbles > 0,
        `${thread.bubbles} bubbles`);
      check('and on the sender’s own side', thread.mine > 0 && thread.theirs === 0,
        `${thread.mine} mine, ${thread.theirs} theirs`);
      check('carrying its text', thread.text.includes('Rent is paid'));

      // Nothing may claim delivery or reading.
      check('no bubble claims a read receipt',
        !/\bread\b.*\u2713|seen|delivered/i.test(thread.text),
        thread.text.slice(0, 160));

      /* ------------------------------- search, filters, pins and stars */

      /*
       * The per-device chat state.
       *
       * All three flags live in `meta`, which never reaches the outbox, and
       * every screen that shows them says so. What is checked here is that
       * they do something: a filter that hides nothing and a star that
       * survives no repaint are decoration.
       */
      {
        // A second conversation, so filtering has something to exclude.
        await page.evaluate(async (spec) => {
          const { app } = await import(spec);
          const db = app().db;
          const me = db.actor?.personId ?? '';
          // `.id`, not the record. A multiref holding an object fails
          // integrity with "points at a person that is not here — Between
          // names [object Object]", which is a long way from saying so.
          const one = await db.repo('person').create({ name: 'Chat Second' });
          const two = await db.repo('person').create({ name: 'Chat Third' });
          const day = new Date().toISOString().slice(0, 10);

          await db.repo('conversation').create({
            title: 'Plumber', participants: [me], startedAt: day,
          });
          // Three participants, so the Groups filter has one to find.
          await db.repo('conversation').create({
            title: 'Parents', participants: [me, one.id, two.id], startedAt: day,
          });
        }, IN_PAGE.context);

        await go(page, '#/chat');
        await page.waitForTimeout(800);

        // Scoped to the thread blocks. `.app-content .list-item-title` also
        // matches the linked-devices card further down the screen, so the
        // search check was reading "This device" as a conversation.
        const titles = () => page.evaluate(() =>
          [...document.querySelectorAll('.thread-block .list-item-title')]
            .map((el) => /** @type {any} */ (el).innerText.trim()));

        const before = await titles();
        check('every conversation is listed under All', before.length >= 3,
          before.join(' | '));

        // Search, on the title.
        await page.locator('.chat-tools input[type="search"]').fill('Plumb');
        await page.waitForTimeout(500);
        const found = await titles();
        check('searching narrows the conversations',
          found.length === 1 && /Plumber/.test(found[0]), found.join(' | '));

        // A term nothing matches must not read as "you have no conversations".
        await page.locator('.chat-tools input[type="search"]').fill('zzzznothing');
        await page.waitForTimeout(500);
        const none = await page.evaluate(() => /** @type {any} */ (
          document.querySelector('.app-content'))?.innerText ?? '');
        check('a search matching nothing says nothing matches, not that there are none',
          /Nothing matches/.test(none) && !/No conversations yet/.test(none),
          none.slice(0, 200));

        await page.locator('.chat-tools input[type="search"]').fill('');
        await page.waitForTimeout(500);

        // Pin. The row must move to the top, not merely gain a badge.
        const rows = page.locator('.thread-block');
        const lastIndex = (await rows.count()) - 1;
        const lastTitle = (await rows.nth(lastIndex).locator('.list-item-title').innerText()).trim();
        await rows.nth(lastIndex).getByRole('button', { name: 'Pin' }).click();
        await page.waitForTimeout(700);

        const pinned = await titles();
        check('pinning moves a conversation to the top',
          pinned[0] === lastTitle, `${pinned[0]} vs ${lastTitle}`);
        check('and the row says so in a word, not only a colour',
          (await page.evaluate(() => /** @type {any} */ (
            document.querySelector('.thread-block'))?.innerText ?? '')).includes('pinned'),
          'no pinned badge');

        // Archive. It must leave All and appear under Archived, not vanish.
        await page.locator('.thread-block').first()
          .getByRole('button', { name: 'Archive' }).click();
        await page.waitForTimeout(700);

        const afterArchive = await titles();
        check('archiving takes a conversation out of All',
          !afterArchive.includes(lastTitle), afterArchive.join(' | '));

        await page.getByRole('button', { name: /^Archived \(/ }).click();
        await page.waitForTimeout(600);
        const inArchive = await titles();
        check('and it is in the archive rather than gone',
          inArchive.includes(lastTitle), inArchive.join(' | '));

        await page.getByRole('button', { name: /^All \(/ }).click();
        await page.waitForTimeout(600);

        /*
         * Starring, and the screen it feeds.
         *
         * The star has to survive a navigation, because the whole point of a
         * per-device flag is that it is stored rather than held in a variable
         * that a repaint discards.
         */
        await page.getByRole('link', { name: 'Household' }).first().click();
        await page.waitForTimeout(700);

        const starButton = page.getByRole('button', { name: 'Star' }).first();
        const canStar = await starButton.count();
        check('a message can be starred', canStar > 0, `${canStar} star controls`);

        if (canStar) {
          await starButton.click();
          await page.waitForTimeout(700);

          check('and the control then offers to unstar it',
            (await page.getByRole('button', { name: 'Unstar' }).count()) > 0);

          await go(page, '#/chat/starred');
          await page.waitForTimeout(700);
          const starred = await page.evaluate(() => /** @type {any} */ (
            document.querySelector('.app-content'))?.innerText ?? '');

          check('the starred screen shows it, with the conversation it came from',
            /Household/.test(starred) && !/Nothing starred yet/.test(starred),
            starred.slice(0, 250));

          // The one thing this screen must not let anybody assume.
          check('and says the stars are on this device only',
            /this device only/i.test(starred), starred.slice(0, 250));
        }

        await go(page, '#/chat');
        await page.waitForTimeout(600);
      }

      /* ---------------------------------------------- the chat settings */

      await go(page, '#/chat/settings');
      await page.waitForTimeout(600);

      const before = await page.evaluate(() =>
        document.documentElement.getAttribute('data-bubble'));
      check('a chat theme is applied', Boolean(before), String(before));

      const swatches = await page.locator('.bubble-swatch').count();
      check('four tints are offered', swatches === 4, `${swatches} swatches`);

      await page.getByRole('button', { name: 'Teal' }).click();
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => ({
        attr: document.documentElement.getAttribute('data-bubble'),
        stored: localStorage.getItem('familyos.chat.bubble'),
        pressed: document.querySelectorAll('.bubble-swatch[aria-pressed="true"]').length,
      }));

      check('choosing a tint changes the theme and is remembered',
        after.attr === 'secondary' && after.stored === 'secondary',
        JSON.stringify(after));
      check('and exactly one tint reads as chosen', after.pressed === 1,
        `${after.pressed} pressed`);

      const settingsText = await page.evaluate(() => /** @type {any} */ (
        document.querySelector('.app-content'))?.innerText ?? '');

      // The four things it must not imply it has.
      for (const [what, phrase] of [
        ['read receipts', 'No read receipts'],
        ['push', 'notification tray'],
        ['presence', 'No typing indicator'],
        ['invitations', 'No invitation links'],
      ]) {
        check(`the settings screen says it has no ${what}`,
          settingsText.includes(phrase), settingsText.slice(0, 120));
      }

      /* ------------------------------------- message size, and devices */

      /*
       * The size control, measured on a real bubble.
       *
       * Storing the choice and setting an attribute proves nothing: the
       * question is whether the text somebody could not read is bigger
       * afterwards. So this reads the computed font size off a message that
       * exists, changes the setting, and reads it again.
       */
      const readBubbleSize = () => page.evaluate(() => {
        const el = document.querySelector('.bubble-text');
        return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
      });

      // On the conversation, where a bubble exists. Measuring from the
      // settings screen returned 0 and made the comparison meaningless — a
      // check whose "before" is zero passes for any "after" at all.
      await go(page, '#/chat');
      await page.waitForTimeout(500);
      await page.getByRole('link', { name: 'Household' }).first().click();
      await page.waitForTimeout(600);
      const sizeBefore = await readBubbleSize();

      await go(page, '#/chat/settings');
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: 'Largest' }).click();
      await page.waitForTimeout(250);

      const sized = await page.evaluate(() => ({
        attr: document.documentElement.getAttribute('data-chat-size'),
        stored: localStorage.getItem('familyos.chat.size'),
      }));
      check('choosing the largest message size is remembered',
        sized.attr === 'largest' && sized.stored === 'largest', JSON.stringify(sized));

      await go(page, '#/chat');
      await page.waitForTimeout(500);
      await page.getByRole('link', { name: 'Household' }).first().click();
      await page.waitForTimeout(600);

      const sizeAfter = await readBubbleSize();
      check('and the text in a conversation is actually larger',
        sizeBefore > 0 && sizeAfter > sizeBefore,
        `${sizeBefore}px then ${sizeAfter}px`);

      /*
       * Withdrawing my own message.
       *
       * `ChatService.withdraw` had no caller anywhere in the application, so
       * nothing had ever checked that it does what it says. It must delete the
       * text and leave the row behind saying it was withdrawn — a message that
       * simply disappeared would look, to everybody else, like one that was
       * never sent.
       */
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByRole('button', { name: 'Withdraw' }).first().click();
      await page.waitForTimeout(800);

      const gone = await page.evaluate(() => ({
        bubbles: document.querySelectorAll('.bubble').length,
        text: /** @type {any} */ (document.querySelector('.app-content'))?.innerText ?? '',
      }));
      check('withdrawing a message removes its text', !gone.text.includes('Rent is paid'),
        gone.text.slice(0, 160));
      check('and leaves a line saying it was withdrawn',
        gone.bubbles > 0 && gone.text.includes('withdrawn'), gone.text.slice(0, 200));

      /*
       * And the sealed body is gone from the row, not merely hidden.
       *
       * The screen check above passed against a deliberately broken
       * `withdraw` that set the flag and kept the ciphertext: `read` returns
       * "withdrawn" from the flag alone and never looks at the body, so the
       * screen looks identical either way. Withdrawing that leaves the text
       * on the device is the failure this feature exists to prevent, and only
       * the stored row can say whether it happened.
       */
      const rows = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const all = await app().db.repo('message').list({ limit: 50 });
        return all.map((one) => ({
          withdrawn: Boolean(one.deletedForEveryone),
          body: String(one.body ?? ''),
        }));
      }, IN_PAGE.context);

      const dropped = rows.find((one) => one.withdrawn);
      check('and the sealed body is deleted from the stored row',
        Boolean(dropped) && dropped.body.length <= 2,
        JSON.stringify(dropped ?? rows).slice(0, 200));

      /*
       * Another household device, and the three things this screen can do
       * to one.
       *
       * Written straight into the table because a second phone is the one
       * thing a browser cannot be. `safetyNumberWith`, `markVerified` and
       * `revoke` had all existed with no screen calling any of them.
       */
      await page.evaluate(async ([spec, chatSpec]) => {
        const { app } = await import(spec);
        const { ChatService } = await import(chatSpec);
        const chat = new ChatService(app().db);
        const mine = await chat.identity();
        const me = app().db.actor?.personId ?? '';
        await app().db.repo('deviceKey').create({
          person: me,
          deviceId: 'other-phone',
          label: 'Second phone',
          // A different key from this device's, so the safety number between
          // them is a real comparison rather than a hash of one key twice.
          publicKey: `${String(mine.publicKey).slice(0, -4)}zzzz`,
          addedAt: new Date().toISOString(),
        });
      }, [IN_PAGE.context, IN_PAGE.chat]);

      await go(page, '#/chat/settings');
      await page.waitForTimeout(700);

      const devices = await page.evaluate(() => /** @type {any} */ (
        document.querySelector('.app-content'))?.innerText ?? '');
      check('another enrolled device is listed', devices.includes('Second phone'),
        devices.slice(0, 200));
      check('and is marked unverified until somebody checks it',
        devices.includes('unverified'), devices.slice(0, 260));

      await page.getByRole('button', { name: 'Show safety number' }).first().click();
      await page.waitForTimeout(400);
      const number = await page.evaluate(() => {
        const el = /** @type {any} */ (document.querySelector('.safety-number'));
        return { shown: el ? !el.hidden : false, text: el?.textContent?.trim() ?? '' };
      });
      check('its safety number can be shown', number.shown && number.text.length > 8,
        JSON.stringify(number).slice(0, 140));

      await page.getByRole('button', { name: 'It matched' }).first().click();
      await page.waitForTimeout(700);

      // That row's own badge. Asserting the page does not contain the word
      // "unverified" was wrong: this device's key is unverified too and
      // always will be — nobody compares a device with itself.
      const badgeFor = (label) => page.evaluate((want) => [...document.querySelectorAll('.device-block')]
        .find((el) => el.textContent?.includes(want))
        ?.querySelector('.badge')?.textContent?.trim() ?? '', label);

      const badge = await badgeFor('Second phone');
      check('and recording that it matched marks that device verified',
        badge === 'verified', badge || 'no badge');

      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByRole('button', { name: 'Revoke' }).first().click();
      await page.waitForTimeout(800);
      const revoked = await page.evaluate(() => /** @type {any} */ (
        document.querySelector('.app-content'))?.innerText ?? '');
      check('revoking it moves it to the revoked list rather than hiding it',
        revoked.includes('1 revoked'), revoked.slice(0, 300));

      /*
       * Storage, counted rather than claimed.
       *
       * One conversation was created above and one message was sent and then
       * withdrawn, so the numbers are known: the withdrawn one must be counted
       * separately, because its row survives and the space does not come back.
       */
      const storage = await page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll('.list-item')].map((el) => [
          el.querySelector('.list-item-title')?.textContent?.trim() ?? '',
          el.querySelector('.badge')?.textContent?.trim() ?? '',
        ])));

      /*
       * Compared against the database, not against a number typed here.
       *
       * This asserted `'1'` and broke the moment another block seeded a second
       * conversation — a check coupled to a fixture rather than to the thing
       * it is about. What the card must do is agree with what is stored.
       */
      const reallyThere = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const rows = await app().db.repo('conversation').list({ limit: 500, decrypt: false });
        return rows.filter((one) => !one.deletedAt).length;
      }, IN_PAGE.context);

      check('the storage card counts the conversations that are actually stored',
        storage.Conversations === String(reallyThere),
        `card says ${storage.Conversations}, database has ${reallyThere}`);
      check('and counts the withdrawn message separately from the readable ones',
        storage['Withdrawn messages'] === '1'
        && storage['Messages held on this device'] === '0',
        JSON.stringify(storage).slice(0, 240));

      await page.setViewportSize({ width: 390, height: 844 });
    }

    /* --------------------------------------------------- notifications */

    /*
     * The filters, against a record that actually appears.
     *
     * A filter check on an empty screen proves nothing — every chip matches
     * nothing and every assertion about "no results" passes for the wrong
     * reason. So this creates a policy expiring inside the reminder horizon
     * first, and then asserts the screen finds it, filters to it, and reports
     * honestly when a search matches nothing.
     */
    {
      await page.setViewportSize({ width: 1280, height: 900 });

      const soon = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
      await go(page, '#/insurance/policy');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Add/ }).first().click();
      await page.waitForSelector('.modal', { timeout: 5000 });
      // Every field the schema marks required, or the save is refused — which
      // is the repository doing its job, not a test problem.
      await page.locator('#f-policy-name').fill('Car insurance');
      await page.locator('#f-policy-kind').selectOption('vehicle');
      await page.locator('#f-policy-insurer').fill('Example General');
      await page.locator('#f-policy-policyNumber').fill('POL-0001');
      await page.locator('#f-policy-premium').fill('12000');
      await page.locator('#f-policy-renewsOn').fill(soon);
      await page.locator('#f-policy-name').press('Enter');
      await page.waitForSelector('.modal', { state: 'detached', timeout: 5000 });

      await go(page, '#/notifications');
      await page.waitForTimeout(600);

      const read = () => page.evaluate(() => ({
        rows: document.querySelectorAll('.app-content .list-item').length,
        chips: [...document.querySelectorAll('.app-content .chip')]
          .map((one) => one.textContent?.trim() ?? ''),
        text: /** @type {any} */ (document.querySelector('.app-content'))?.innerText ?? '',
      }));

      const all = await read();
      check('a policy renewing in nine days reaches the notifications screen',
        all.rows > 0, `${all.rows} rows`);

      // Derived from the data, so the chip only exists because an item does.
      check('and a category chip appears for it',
        all.chips.some((one) => /insurance/i.test(one)), all.chips.join(' | '));

      check('the chips carry counts rather than bare names',
        all.chips.some((one) => /\d/.test(one)), all.chips.join(' | '));

      // Filtering to a category that has nothing must hide the row.
      const other = all.chips.find((one) => !/insurance|^All/i.test(one));
      if (other) {
        await page.getByRole('button', { name: other }).click();
        await page.waitForTimeout(300);
        const narrowed = await read();
        check('choosing another category hides the policy',
          !narrowed.text.includes('Car insurance'), narrowed.text.slice(0, 80));
        await page.getByRole('button', { name: other }).click();
        await page.waitForTimeout(250);
      }

      // A search that matches nothing says so, and says it differently from
      // "nothing is due" — which would read as though the records vanished.
      await page.locator('.app-content input[type="search"]').fill('zzzznotathing');
      await page.waitForTimeout(350);
      const none = await read();
      check('a search matching nothing says nothing matches, not nothing is due',
        none.text.includes('Nothing matches') && !none.text.includes('Nothing is due'),
        none.text.slice(0, 140));

      check('and offers a way back', none.text.includes('Clear filters'));

      await page.getByRole('button', { name: 'Clear filters' }).click();
      await page.waitForTimeout(350);
      const back = await read();
      check('clearing the filters brings everything back', back.rows === all.rows,
        `${back.rows} of ${all.rows}`);

      // The screen must not imply a capability the application does not have.
      check('the screen says there is no read state and no push',
        back.text.includes('marked as read') && back.text.includes('notification tray'),
        back.text.slice(-220));

      await page.setViewportSize({ width: 390, height: 844 });
    }

    /* ------------------------------------------------------- dashboard */

    /*
     * The dashboard's sections, and the one number two screens share.
     *
     * The attention card and the Notifications tab are the same arithmetic —
     * `attentionFrom` — precisely so they cannot disagree about what needs
     * doing. Two implementations would drift, and the screen that disagreed
     * would be the one nobody checked. This asserts they match rather than
     * trusting that they share a function.
     *
     * It also asserts the sections are *there*. It is not what catches a
     * dashboard that throws outright — the run reaches the first dashboard
     * check long before this one, and that is where the diagnosis was made to
     * happen. What this catches is the quieter kind: the wallet losing its
     * carousel, a card showing a figure with no date against it, or the two
     * screens drifting apart on the count.
     */
    {
      await page.setViewportSize({ width: 390, height: 844 });
      await go(page, '#/dashboard');
      await page.waitForTimeout(600);

      const shape = await page.evaluate(() => ({
        cards: document.querySelectorAll('.app-content .card').length,
        carousels: document.querySelectorAll('.app-content .carousel').length,
        walletCards: document.querySelectorAll('.app-content .wallet-card').length,
        text: /** @type {any} */ (document.querySelector('.app-content'))?.innerText ?? '',
      }));

      check('the dashboard renders cards rather than throwing', shape.cards > 0,
        shape.text.slice(0, 100));

      // With one account added earlier in this run there is a figure to show,
      // so the wallet is a carousel rather than its empty state.
      check('the wallet is a carousel of cards',
        shape.carousels >= 1 && shape.walletCards >= 2,
        `${shape.carousels} carousels, ${shape.walletCards} cards`);

      check('the carousel is reachable by keyboard',
        await page.evaluate(() => /** @type {any} */ (
          document.querySelector('.carousel'))?.tabIndex === 0));

      check('and every wallet card says how old its figure is',
        await page.evaluate(() => [...document.querySelectorAll('.wallet-card')]
          .every((one) => (one.querySelector('.wallet-card-updated')?.textContent ?? '').trim())),
        'a card showed a figure without saying when it was true');

      // The same count, from two screens.
      const onDashboard = await page.evaluate(() => {
        const heading = [...document.querySelectorAll('.attention-card h2, .card h2')]
          .map((el) => el.textContent ?? '')
          .find((text) => /needs? your attention/.test(text));
        return heading ? Number(/^(\d+)/.exec(heading.trim())?.[1] ?? 1) : 0;
      });

      await go(page, '#/notifications');
      await page.waitForTimeout(500);
      const onTab = await page.evaluate(() => {
        const rows = document.querySelectorAll('.card .list .list-item');
        const heads = [...document.querySelectorAll('.card h2')].map((el) => el.textContent ?? '');
        const late = heads.filter((text) => /Already past|This week/.test(text)).length;
        return { rows: rows.length, groups: late };
      });

      check('the dashboard and the notifications tab agree on what is pressing',
        (onDashboard > 0) === (onTab.groups > 0),
        `dashboard says ${onDashboard}, the tab shows ${onTab.groups} pressing groups`);

      await go(page, '#/dashboard');
      await page.waitForTimeout(250);
    }

    /* --------------------------------------------- bottom navigation */

    /*
     * The five primary destinations, in the order they were specified.
     *
     * Read from the rendered bar rather than from `PRIMARY`, because asserting
     * a constant against itself proves nothing about what a thumb can reach.
     *
     * Order matters and was nearly wrong: the bar was built by filtering the
     * permitted module list, which comes back in *schema* order, so the five
     * right tabs came out in the wrong sequence — Profile second, Chat fifth.
     */
    {
      await page.setViewportSize({ width: 390, height: 844 });
      await go(page, '#/dashboard');
      await page.waitForTimeout(300);

      const tabs = await page.evaluate(() => [...document.querySelectorAll('.bottom-nav a')]
        .map((el) => /** @type {any} */ (el))
        .map((a) => ({
          module: a.dataset.module,
          label: a.querySelector('span:not(.nav-badge)')?.textContent?.trim(),
          width: Math.round(a.getBoundingClientRect().width),
          height: Math.round(a.getBoundingClientRect().height),
        })));

      check('the bottom bar carries exactly five tabs', tabs.length === 5,
        `${tabs.length}: ${tabs.map((one) => one.module).join(', ')}`);

      check('and they are the five specified, in order',
        tabs.map((one) => one.module).join(',')
          === 'dashboard,notifications,chat,finance,profile',
        tabs.map((one) => one.module).join(', '));

      check('every tab is labelled', tabs.every((one) => one.label && one.label.length > 1),
        JSON.stringify(tabs.map((one) => one.label)));

      check('Settings is no longer a primary tab',
        !tabs.some((one) => one.module === 'settings'));

      // Five targets across a phone: each must still be reachable by a thumb.
      const narrowest = Math.min(...tabs.map((one) => Math.min(one.width, one.height)));
      check('and each tab is still at least 44px', narrowest >= 44,
        `narrowest tab is ${narrowest}px`);

      // Both new destinations must actually render, not 404 into the fallback.
      for (const screen of ['notifications', 'profile']) {
        await go(page, `#/${screen}`);
        await page.waitForTimeout(500);
        const body = (await page.locator('.app-content').innerText()).trim();
        check(`${screen} opens from the bar`, body.length > 40 && !body.includes('[object '),
          body.slice(0, 90));
      }

      /*
       * And every other module has a link on Profile, in the DOM.
       *
       * The unit test proves the list; this proves the links. A group card
       * returning null, a role filter, or a route helper producing the wrong
       * href would all leave the list correct and the screen a dead end — and
       * with five tabs and no sixth, a module missing here is one somebody can
       * only reach by typing its URL.
       */
      await go(page, '#/profile');
      await page.waitForTimeout(600);

      // An array, not a Set. `page.evaluate` serialises its result as JSON, so
      // a Set arrives as `{}` — and `linked.has` is not a function.
      const linked = new Set(await page.evaluate(() => [...new Set(
        [...document.querySelectorAll('.app-content a[href^="#/"]')]
          .map((a) => (/** @type {any} */ (a).getAttribute('href') ?? '')
            .replace(/^#\//, '').split('/')[0])
          .filter(Boolean),
      )]));

      const stranded = SCHEMA_MODULES
        .map((one) => one.id)
        .filter((id) => !linked.has(id)
          && !['dashboard', 'notifications', 'chat', 'finance', 'profile'].includes(id));

      check('every module not on the bar is linked from Profile',
        stranded.length === 0, `unreachable: ${stranded.join(', ')}`);

      // The control: if nothing were linked at all the line above would pass
      // for the wrong reason, because every module would look primary.
      check('and Profile really is a page full of links', linked.size >= 15,
        `${linked.size} distinct modules linked`);

      /*
       * The sign-in card, on a copy with no backend configured.
       *
       * Which is the state this suite runs in, and the state most first
       * installs are in. A one-time code has to be sent and checked by a
       * server — a browser cannot check its own — so with no Apps Script URL
       * there is nothing to answer, and the card has to say that instead of
       * drawing a button whose only outcome is an error toast.
       *
       * That is the fault the chat composer had: a form that takes your
       * typing and fails afterwards. Worth not repeating, and worth checking.
       */
      await go(page, '#/profile');
      await page.waitForTimeout(600);

      const signin = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.app-content .card')]
          .find((one) => /Confirm who you are/.test(/** @type {any} */ (one).innerText ?? ''));
        return {
          found: Boolean(el),
          text: el ? /** @type {any} */ (el).innerText : '',
          inputs: el ? el.querySelectorAll('input').length : -1,
          buttons: el ? el.querySelectorAll('button').length : -1,
        };
      });

      check('the sign-in card is on Profile', signin.found, 'no card headed "Confirm who you are"');
      check('and with no backend it says so rather than offering a dead button',
        /no Google backend configured/.test(signin.text) && signin.inputs === 0
        && signin.buttons === 0,
        `${signin.inputs} inputs, ${signin.buttons} buttons`);

      /*
       * And the three sentences it may never leave out.
       *
       * They are the reason this feature is safe to ship at all: a code
       * confirms who you are and protects nothing, and a sign-in card is
       * exactly where somebody would assume otherwise.
       */
      check('it says a code is not what protects the records',
        /not what protects/.test(signin.text), signin.text.slice(0, 200));
      check('and that signing in this way decrypts nothing',
        /decrypts nothing/.test(signin.text), signin.text.slice(0, 300));
      check('and that a new phone still needs enrolling',
        /until it is enrolled/.test(signin.text), signin.text.slice(0, 400));

      // The tab for the screen you are on is the one marked current.
      await go(page, '#/notifications');
      await page.waitForTimeout(300);
      const current = await page.evaluate(() => {
        const active = /** @type {any} */ (
          document.querySelector('.bottom-nav a[aria-current="page"]'));
        return active?.dataset.module;
      });
      check('the current tab is marked as current', current === 'notifications', String(current));

      await go(page, '#/dashboard');
      await page.waitForTimeout(250);
    }

    /* ---------------------------------------------------- safe areas */

    /*
     * The status bar's space, actually paid.
     *
     * `index.html` sets `viewport-fit=cover`, which tells the WebView to draw
     * behind the system bars, and `capacitor.config.ts` said "the stylesheet
     * uses the safe-area insets, so the web layer handles the notch". It did
     * not: `safe-area-inset-top` appeared nowhere in the repository. Only the
     * bottom inset was ever paid, so on every Android phone with a notch or a
     * status bar the header rendered underneath the clock.
     *
     * `env()` cannot be set by a stylesheet or a test, which is why nothing
     * could have caught it. The insets now go through `--inset-*` tokens whose
     * fallback is `env()`, so this can put a phone's real numbers in and
     * measure what moves. The numbers below are a Pixel-class device in
     * portrait: 48px of status bar, 24px of gesture area.
     */
    {
      await page.setViewportSize({ width: 390, height: 844 });
      await go(page, '#/dashboard');
      await page.waitForTimeout(300);

      const before = await page.evaluate(() => {
        const header = document.querySelector('.app-header');
        const nav = document.querySelector('.bottom-nav');
        return {
          headerTop: header.getBoundingClientRect().top,
          headerHeight: Math.round(header.getBoundingClientRect().height),
          navBottom: Math.round(window.innerHeight - nav.getBoundingClientRect().bottom),
        };
      });

      const after = await page.evaluate(() => {
        const root = document.documentElement;
        root.style.setProperty('--inset-top', '48px');
        root.style.setProperty('--inset-bottom', '24px');
        const header = document.querySelector('.app-header');
        const nav = document.querySelector('.bottom-nav');
        const box = header.getBoundingClientRect();
        const style = getComputedStyle(header);

        // What the first thing inside the header is actually clear of.
        const firstChild = header.firstElementChild.getBoundingClientRect();

        return {
          headerHeight: Math.round(box.height),
          paddingTop: Math.round(parseFloat(style.paddingTop)),
          childTop: Math.round(firstChild.top),
          navHeight: Math.round(nav.getBoundingClientRect().height),
        };
      });

      check('the header pays the status bar inset',
        after.paddingTop === 48,
        `padding-top is ${after.paddingTop}px with a 48px inset`);

      check('and grows rather than pushing its content under the bar',
        after.headerHeight === before.headerHeight + 48
          && after.childTop >= 48,
        `header ${before.headerHeight} -> ${after.headerHeight}px, `
        + `first child starts at ${after.childTop}px`);

      check('the bottom navigation pays the gesture inset',
        after.navHeight >= before.navBottom + 24,
        `navigation is ${after.navHeight}px tall with a 24px inset`);

      // Without this, the two assertions above could both pass on a page that
      // never had a header in the first place.
      check('the safe-area check measured a real shell',
        before.headerHeight > 40 && before.headerHeight < 200,
        `header measured ${before.headerHeight}px before any inset`);

      await page.evaluate(() => {
        document.documentElement.style.removeProperty('--inset-top');
        document.documentElement.style.removeProperty('--inset-bottom');
      });
    }

    /* --------------------------------------------------- text contrast */

    /*
     * `css/tokens.css` says: "every foreground/background pair used for text
     * meets WCAG AA (4.5:1 for body, 3:1 for large text and UI boundaries) in
     * both themes."
     *
     * When that sentence was finally measured it was false. Nine pairs failed
     * in light and seven in dark, and one token caused most of them:
     * `--text-faint` was `--grey-500`, which is 4.27:1 on white and 3.91:1 on
     * `--surface-sunken`. A warning badge painted `--warning` on
     * `--warning-subtle` measured 2.89:1, and the brand mark put white on
     * `--accent`, which becomes the light `--blue-300` in dark mode — 2.23:1,
     * unreadable in exactly the theme where it is most looked at.
     *
     * This walks the rendered document in both themes rather than reading the
     * stylesheet, because the stylesheet is what made the claim.
     *
     * ## What it cannot see
     *
     * A style that only appears in a state the run never reaches. The offline
     * sync pill had the same 2.89:1 defect as the warning badge and this sweep
     * did not find it — the network never went down — it was found by reading
     * the rule after the badge pointed at it. A passing run means the pairs
     * that rendered are sound, not that every pair in the stylesheet is.
     *
     * Gradients are resolved to their declared stops plus the midpoint of each
     * consecutive pair. Those are real colours along the ramp, but they are not
     * a proof that the worst point on it was tested.
     */
    {
      const PROBE = () => {
        /**
         * A computed colour, in whatever form the browser serialised it.
         *
         * Two forms turn up here and they are not on the same scale.
         * `rgb(26, 115, 232)` carries 0-255 channels; `color(srgb 1 1 1 /
         * 0.92)` — which is how Chromium reports the `color-mix()` on
         * `.app-header` and `.bottom-nav` — carries 0-1 floats.
         *
         * Reading every number the same way turned the bottom navigation's
         * white into `rgb(1 1 1)`, composited it to `rgb(21 21 21)`, and
         * reported the two labels on it as failing. The application was
         * correct and the instrument was not, which is the failure mode a
         * measurement is supposed to protect against.
         */
        const parse = (value) => {
          if (!value) return null;
          const parts = value.match(/-?[\d.]+%?/g);
          if (!parts || parts.length < 3) return null;

          const scale = /^color\(/i.test(value.trim()) ? 255 : 1;
          const channel = (raw) => (raw.endsWith('%')
            ? (parseFloat(raw) / 100) * 255
            : parseFloat(raw) * scale);
          const alpha = (raw) => (raw === undefined
            ? 1
            : (raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)));

          return {
            r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]),
            a: alpha(parts[3]),
          };
        };

        const luminance = ({ r, g, b }) => {
          const channel = (v) => {
            const n = v / 255;
            return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };

        const over = (top, bottom) => ({
          r: top.r * top.a + bottom.r * (1 - top.a),
          g: top.g * top.a + bottom.g * (1 - top.a),
          b: top.b * top.a + bottom.b * (1 - top.a),
          a: 1,
        });

        const ratio = (one, other) => {
          const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
          return (light + 0.05) / (dark + 0.05);
        };

        /**
         * The colours a gradient passes through: its declared stops, plus the
         * midpoint of each consecutive pair.
         *
         * `transparent` computes to `rgba(0, 0, 0, 0)` — black with no alpha.
         * Treating that as a colour turns the skeleton shimmer, which fades
         * through transparent, into a near-black ground and reports the whole
         * page as failing. It is a hole in the layer, not a colour, so it is
         * dropped before the midpoints are taken.
         */
        const stopsOf = (image) => {
          const declared = (image.match(/rgba?\([^)]*\)/g) ?? [])
            .map(parse).filter((stop) => stop && stop.a > 0);
          if (!declared.length) return [];
          const all = [...declared];
          for (let i = 0; i + 1 < declared.length; i++) {
            const a = declared[i], b = declared[i + 1];
            all.push({
              r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2,
              a: (a.a + b.a) / 2,
            });
          }
          return all;
        };

        /**
         * Every colour that can be behind this element's text.
         *
         * Background colours first, to find the opaque ground. Then any
         * gradient between the text and that ground contributes its own
         * colours, composited over it. A gradient whose every stop is opaque
         * hides the ground, so the ground is dropped — otherwise white text on
         * a solid gradient is measured against the white page behind it and
         * reported as 1:1.
         */
        const groundsOf = (el) => {
          let node = el, acc = null, base = null;
          while (node && node.nodeType === 1) {
            const background = parse(getComputedStyle(node).backgroundColor);
            if (background && background.a > 0) {
              acc = acc ? over(acc, background) : background;
              if (acc.a >= 1 || background.a >= 1) { base = { ...acc, a: 1 }; break; }
            }
            node = node.parentElement;
          }
          if (!base) base = acc ? { ...acc, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };

          const grounds = [];
          let covered = false;
          for (let up = el; up && up.nodeType === 1; up = up.parentElement) {
            const image = getComputedStyle(up).backgroundImage;
            if (!image || image === 'none') continue;
            const stops = stopsOf(image);
            if (!stops.length) continue;
            if (stops.every((stop) => stop.a >= 1)) covered = true;
            for (const stop of stops) grounds.push({ ...over(stop, base), a: 1 });
          }

          if (!covered) grounds.push(base);
          return grounds.length ? grounds : [base];
        };

        const failures = [];
        let measured = 0;

        for (const el of document.querySelectorAll('*')) {
          // Text this element renders itself, not text belonging to a child.
          const ownsText = [...el.childNodes]
            .some((node) => node.nodeType === 3 && node.textContent.trim().length > 1);
          if (!ownsText) continue;

          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          if (+style.opacity === 0) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;

          const foreground = parse(style.color);
          if (!foreground || foreground.a === 0) continue;

          const size = parseFloat(style.fontSize);
          const bold = +style.fontWeight >= 700;
          const large = size >= 24 || (bold && size >= 18.66);
          const needed = large ? 3 : 4.5;

          // The worst ground wins: text over a gradient has to be readable
          // along it, not on average.
          let worstGround = null, worst = Infinity;
          for (const ground of groundsOf(el)) {
            const solid = foreground.a < 1 ? over(foreground, ground) : foreground;
            const here = ratio(solid, ground);
            if (here < worst) { worst = here; worstGround = ground; }
          }

          measured += 1;
          if (worst < needed) {
            const names = typeof el.className === 'string' && el.className
              ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
            failures.push({
              where: el.tagName.toLowerCase() + names,
              got: Math.round(worst * 100) / 100,
              needed,
              colour: style.color,
              ground: `rgb(${Math.round(worstGround.r)} ${Math.round(worstGround.g)}`
                + ` ${Math.round(worstGround.b)})`,
              text: el.textContent.trim().slice(0, 30),
            });
          }
        }
        return { failures, measured };
      };

      for (const theme of ['light', 'dark']) {
        await page.evaluate((name) => {
          document.documentElement.setAttribute('data-theme', name);
        }, theme);

        const worst = new Map();
        let measured = 0;

        /*
         * Every module, derived — not ten of twenty-five, written by hand.
         *
         * This file already complains about the same fault twice: a check
         * that "existed and only ever ran on the dashboard", and a hand-named
         * list beside a derivable one. The contrast sweep was the third,
         * naming ten modules while the schema declared twenty-five, so
         * fifteen screens had never had a colour pair measured in either
         * theme — including two added since.
         *
         * Widening it found **nothing**: every pair on every screen passes in
         * both themes. That is worth saying plainly rather than dressing up.
         * The value here is not a bug fixed, it is that a screen added
         * tomorrow is measured without anybody remembering to add it.
         */
        for (const module of [...SCHEMA_MODULES.map((one) => one.id),
          'profile', 'notifications', 'wellbeing']) {
          await go(page, `#/${module}`);
          await page.waitForTimeout(400);
          const result = await page.evaluate(PROBE);
          measured += result.measured;
          for (const row of result.failures) {
            const key = `${row.where}|${row.colour}|${row.ground}`;
            if (!worst.has(key) || worst.get(key).got > row.got) {
              worst.set(key, { ...row, module });
            }
          }
        }

        // A sweep that reads nothing reports no failures.
        check(`the ${theme} contrast sweep read some text`, measured > 200,
          `only ${measured} text elements were measured`);

        check(`every text pair meets WCAG AA in ${theme}`, worst.size === 0,
          [...worst.values()].sort((a, b) => a.got - b.got).slice(0, 8)
            .map((one) => `${one.where} ${one.got}:1 (needs ${one.needed}) `
              + `${one.colour} on ${one.ground} in ${one.module}`).join('; '));
      }

      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    }

    /* -------------------------------------------- identifiers, everywhere */

    /*
     * Is any identifier shown in full, anywhere?
     *
     * The brief requires Aadhaar, PAN, bank account, CKYC and card numbers
     * masked by default, and forbids sensitive values in a URL or the page
     * title. Nothing checked it. Three attempts were needed to get a check
     * that can actually fail:
     *
     * 1. **Ask `maskable()` which fields to watch.** That is the function
     *    under test. Unmasking `accountNumber` made the sweep stop seeding a
     *    sentinel into it, so the leak became invisible and the run passed
     *    clean. A check that derives its own subject from the code under test
     *    cannot fail.
     * 2. **A key-shape regex.** It flagged `receipt.orderId` and
     *    `deviceKey.deviceId` — an order number off a shop receipt and the id
     *    that tells two of your own phones apart. Neither is secret, and
     *    `classification.js` explains at length why masking everything is a
     *    visible bug.
     * 3. **A named list**, below. It is hand-maintained, which this repository
     *    normally treats as a defect; the mitigation is that every pair is
     *    checked to still exist in the schema, so a rename fails here loudly
     *    instead of quietly leaving the sweep watching nothing.
     *
     * The sentinels end in four uppercase letters because `mask()` keeps the
     * last four characters. That is what separates the three outcomes:
     * **full token seen** is a leak, **tail only** is masking proven on a real
     * screen, and **neither** means the field is never displayed at all — for
     * which this sweep proves nothing and says so.
     *
     * Runs last for a reason: it writes a record for every entity that has a
     * text field, and any check after it would be reading a household full of
     * probe data.
     */
    {
      const MUST_BE_MASKED = [
        ['account', 'accountNumber'], ['loan', 'accountNumber'],
        ['identityDocument', 'number'], ['kycRecord', 'kin'], ['kycRecord', 'pan'],
        ['employment', 'uan'], ['employment', 'pfNumber'], ['employment', 'employeeId'],
        ['policy', 'policyNumber'],
        ['vehicle', 'chassisNumber'], ['vehicle', 'engineNumber'], ['vehicle', 'fastagId'],
        ['property', 'surveyNumber'], ['property', 'khataNumber'],
        ['education', 'registrationNumber'], ['certificate', 'credentialId'],
        ['legalDocument', 'registrationNumber'], ['purchase', 'serialNumber'],
        ['vaccination', 'batchNumber'],
        ['vaultItem', 'password'], ['vaultItem', 'totpSecret'],
        ['digitalAsset', 'licenceKey'], ['beneficiary', 'assetId'],
      ];

      // Format-checked fields cannot hold a sentinel: the write would be
      // refused and the whole entity would drop out of the sweep unnoticed.
      const FORMATTED = {
        registration: 'KA01AB1234', ifsc: 'HDFC0001234', phone: '9876500000',
        upiId: 'probe@bank', latitude: 12.9, longitude: 77.6,
      };

      await page.setViewportSize({ width: 390, height: 844 });

      const seeded = await page.evaluate(async (input) => {
        const { spec, schemaSpec, wanted, formatted } = input;
        const watched = new Set(wanted.map(([e, k]) => `${e}.${k}`));
        const { app } = await import(spec);
        const { entities } = await import(schemaSpec);
        const db = app().db;

        const gone = wanted
          .filter(([e, k]) => !(entities[e]?.fields || []).some((f) => f.key === k))
          .map(([e, k]) => `${e}.${k}`);

        const person = await db.repo('person').create({ name: 'Probe Person', role: 'owner' });
        let will = null;
        try {
          will = await db.repo('will').create({ testator: person.id, title: 'Probe will' });
        } catch { /* the entity may not require what this assumes */ }

        const plan = [];
        const made = [];
        let n = 0;

        for (const [name, e] of Object.entries(entities)) {
          const row = {};
          const mine = [];

          for (const f of e.fields || []) {
            const text = f.type === 'text' || f.type === 'password';
            if (text && !Array.isArray(f.options) && !formatted[f.key]) {
              n += 1;
              const tail = String.fromCharCode(
                65 + Math.floor(n / 676) % 26, 65 + Math.floor(n / 26) % 26, 65 + (n % 26), 90,
              );
              row[f.key] = `SNTL${tail}`;
              mine.push({ token: `SNTL${tail}`, tail, entity: name, key: f.key,
                watched: watched.has(`${name}.${f.key}`) });
              continue;
            }
            if (formatted[f.key] !== undefined) { row[f.key] = formatted[f.key]; continue; }
            if (!f.required) continue;
            if (f.default !== undefined && f.default !== 'today') { row[f.key] = f.default; continue; }
            if (Array.isArray(f.options) && f.options.length) {
              // `Other`, so the number is free-form rather than checked as a
              // PAN — otherwise the brief's own example drops out of the sweep.
              row[f.key] = name === 'identityDocument' && f.key === 'kind' ? 'Other' : f.options[0];
              continue;
            }
            if (f.type === 'ref') row[f.key] = f.key === 'will' && will ? will.id : person.id;
            else if (f.type === 'multiref') row[f.key] = [person.id];
            else if (['date', 'day', 'datetime'].includes(f.type)) row[f.key] = new Date().toISOString().slice(0, 10);
            else if (['number', 'money', 'currency', 'percent'].includes(f.type)) row[f.key] = 1000;
            else row[f.key] = `Probe ${name}`;
          }

          if (!mine.length) continue;
          try {
            const created = await db.repo(name).create(row);
            made.push({ entity: name, module: e.module, id: created.id });
            plan.push(...mine);
          } catch { /* a record whose refs cannot be satisfied here */ }
        }
        return { made, plan, gone };
      }, {
        spec: IN_PAGE.context, schemaSpec: IN_PAGE.schema,
        wanted: MUST_BE_MASKED, formatted: FORMATTED,
      });

      check('every field this sweep watches still exists in the schema',
        seeded.gone.length === 0, seeded.gone.join(', '));

      const watchedPlan = seeded.plan.filter((one) => one.watched);
      check('and every one of them was actually seeded',
        watchedPlan.length === MUST_BE_MASKED.length,
        `${watchedPlan.length} of ${MUST_BE_MASKED.length}`);

      const hashes = [
        ...SCHEMA_MODULES.map((one) => `#/${one.id}`),
        // The same two registered outside the schema that the module walk
        // names. Written out because that walk's copy is block-scoped to it.
        '#/assistant', '#/timeline',
        // Each entity's own list screen as well as its record screen. A
        // module's default tab is one entity's list; the others are only
        // reached by naming the entity, and a hand-built card on one of those
        // tabs — the identity wallet is exactly that — would otherwise never
        // be looked at by this sweep.
        ...[...new Set(seeded.made.map((one) => `#/${one.module}/${one.entity}`))],
        ...seeded.made.map((one) => `#/${one.module}/${one.entity}/${one.id}`),
      ];

      const seen = new Set();
      const tails = new Set();
      const elsewhere = [];
      for (const hash of hashes) {
        await go(page, hash);
        const found = await page.evaluate(() => {
          const body = document.body.innerText || '';
          return {
            hits: [...new Set(body.match(/SNTL[A-Z]{3}Z/g) || [])],
            tails: [...new Set(body.match(/\b[A-Z]{3}Z\b/g) || [])],
            away: [...new Set(`${location.href} ${document.title}`.match(/SNTL[A-Z]{3}Z/g) || [])],
          };
        });
        for (const one of found.hits) seen.add(one);
        for (const one of found.tails) tails.add(one);
        if (found.away.length) elsewhere.push(`${hash}: ${found.away.join(',')}`);
      }

      const byToken = new Map(seeded.plan.map((one) => [one.token, one]));
      const leaked = [...seen].map((one) => byToken.get(one)).filter((one) => one?.watched);
      const controls = seeded.plan.filter((one) => !one.watched);
      const controlsSeen = controls.filter((one) => seen.has(one.token)).length;
      const proven = watchedPlan.filter((one) => !seen.has(one.token) && tails.has(one.tail));

      // The control. If ordinary field values never reach a screen, the
      // absence of the masked ones says nothing at all.
      check('the sweep can see field values at all', controlsSeen > 50,
        `${controlsSeen} of ${controls.length} ordinary values were found on a screen`);

      check('and it found identifiers displayed in their masked form',
        proven.length >= 15, `${proven.length} of ${watchedPlan.length} proven masked`);

      check('no identifier is shown in full on any screen', leaked.length === 0,
        leaked.map((one) => `${one.entity}.${one.key}`).join(', '));

      check('and none reaches a URL or the page title', elsewhere.length === 0,
        elsewhere.join(' | '));
    }

    await go(page, '#/dashboard');
    await page.waitForTimeout(300);

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
    /* ---------------------------------------------------- native shell */

    // The application inside a fake Capacitor bridge, in a real browser, on
    // the same files that ship. Not a unit test of `core/native.js` — that
    // exists too — but the three places the running app is supposed to behave
    // differently when there is a native shell around it.
    //
    // The bridge is shaped from `@capacitor/core`'s own source: `Plugins` is
    // populated only by `registerPlugin`, which returns a proxy whose methods
    // dispatch natively. Everything called through it is recorded.
    {
      const nativeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await nativeContext.addInitScript(() => {
        const calls = [];
        Object.defineProperty(globalThis, '__nativeCalls', { value: calls });

        /*
         * What one boot reads, counted.
         *
         * A fresh context is the only deterministic place to ask: by any
         * later point in this run the database holds whatever the checks
         * before it created, and a count would drift with them.
         *
         * Cursor opens, not `getAll` calls — `js/data/idb.js` walks a cursor
         * on purpose so that a windowed list of fifty does not materialise
         * forty thousand rows, and a probe that hooked `getAll` measured zero
         * while the application read sixty-three times.
         *
         * A count rather than a stopwatch, because a count is the same on a
         * loaded CI runner and a fast laptop. The timing is fine and was
         * measured separately: 186ms to a drawn shell and 372ms to the first
         * card with 2,000 transactions on the books. What this guards is the
         * shape — a change that turns sixty reads into six hundred.
         */
        globalThis.__reads = { opens: 0, byStore: {} };

        // Written out twice rather than looped over a pair, because an array
        // of `[prototype, nameOf]` is inferred as a union and `openCursor`
        // then exists on neither half of it.
        const tally = (store) => {
          globalThis.__reads.opens += 1;
          globalThis.__reads.byStore[store] = (globalThis.__reads.byStore[store] ?? 0) + 1;
        };

        const onStore = IDBObjectStore.prototype.openCursor;
        IDBObjectStore.prototype.openCursor = function countedStore(...args) {
          tally(this.name);
          return onStore.apply(this, args);
        };

        const onIndex = IDBIndex.prototype.openCursor;
        IDBIndex.prototype.openCursor = function countedIndex(...args) {
          tally(this.objectStore.name);
          return onIndex.apply(this, args);
        };

        const proxyFor = (name) => new Proxy({}, {
          get(_target, method) {
            // A proxy that answers `then` with a function is a thenable, and
            // awaiting it recurses forever. Everything else becomes a call.
            if (typeof method !== 'string' || method === 'then') return undefined;
            return (...args) => {
              calls.push({ plugin: name, method, args });
              if (method === 'writeFile') return Promise.resolve({ uri: 'file:///data/x' });
              if (method === 'addListener') return Promise.resolve({ remove() {} });
              return Promise.resolve();
            };
          },
        });

        /*
         * A WebView has no file picker, so neither does this shell.
         *
         * Headless Chromium *does* have `showSaveFilePicker`, and leaving it
         * in place made the check below unfalsifiable: with the native save
         * deliberately broken so the web path also ran, the picker answered
         * first and no anchor was ever created, so the check passed on code
         * that was wrong. Deleting it is both the faithful simulation of a
         * WebView and the thing that lets the check fail.
         */
        delete globalThis.showSaveFilePicker;

        // A web-path download leaves nothing behind to count: `download()`
        // removes the anchor in the same turn it clicks it, so
        // `querySelectorAll('a[download]')` is zero whether the fallback ran
        // or not — a check that cannot fail. The click itself is the event, so
        // the click is what gets recorded.
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function record() {
          if (this.hasAttribute('download')) {
            calls.push({ plugin: 'web', method: 'anchorDownload', args: [this.download] });
          }
          return click.call(this);
        };

        const built = ['App', 'Filesystem', 'Share'];
        globalThis.Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => 'android',
          isPluginAvailable: (name) => built.includes(name),
          registerPlugin: (name) => proxyFor(name),
        };
      });

      const shell = await nativeContext.newPage();
      const shellErrors = [];
      shell.on('pageerror', (err) => shellErrors.push(err.message));

      await shell.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
      await shell.waitForSelector('.keypad', { timeout: 20_000 });

      for (const digit of PIN) await shell.getByRole('button', { name: digit, exact: true }).click();
      await shell.getByRole('button', { name: 'Done' }).click();
      await shell.waitForTimeout(200);
      for (const digit of PIN) await shell.getByRole('button', { name: digit, exact: true }).click();
      await shell.getByRole('button', { name: 'Done' }).click();

      await shell.waitForSelector('text=Your recovery phrase', { timeout: 20_000 });
      await shell.locator('#kit-ack').check();
      await shell.getByRole('button', { name: 'I have written it down' }).click();
      await shell.waitForSelector('.app-nav', { timeout: 20_000 });

      check('the app boots and unlocks inside a native shell', true);
      check('and raises no error doing it', shellErrors.length === 0, shellErrors.join(' | '));

      /*
       * The read budget for one boot of an empty household.
       *
       * Measured, not chosen: sixty-five cursor opens, six rows. The number is
       * not small because the stores are — it is that several consumers each
       * read the same entities separately. `person` is opened five times on
       * one boot, and six more entities three times each: the dashboard's own
       * loader, `runAutomations`, and the estate, timeline and identity
       * services all ask the database rather than each other.
       *
       * That costs little today, which is why this is a budget and not a
       * refactor: at 372ms to the first card with 2,000 transactions there is
       * nothing here a household would feel, and a shared cache across
       * services would risk a stale read, which is a worse failure than a slow
       * boot. The number is recorded so that if it stops being little,
       * somebody finds out from a check rather than from a phone.
       */
      await shell.waitForTimeout(1200);
      const reads = await shell.evaluate(() => ({
        opens: globalThis.__reads.opens,
        worst: Object.entries(globalThis.__reads.byStore)
          .sort((a, b) => b[1] - a[1]).slice(0, 6),
      }));

      check('one boot reads the database a bounded number of times',
        reads.opens > 0 && reads.opens <= 90,
        `${reads.opens} cursor opens: ${reads.worst.map(([s, n]) => `${s}x${n}`).join(', ')}`);
      check('and no single store is read more than six times on one boot',
        reads.worst.every(([, n]) => n <= 6),
        reads.worst.map(([s, n]) => `${s}x${n}`).join(', '));

      // The files are already on the device. A worker there would build a
      // second copy of the shell in Cache Storage to serve requests that were
      // never going to reach a network.
      const workerInShell = await shell.evaluate(
        () => navigator.serviceWorker.getRegistration().then(Boolean),
      );
      check('no service worker is registered inside a native shell', !workerInShell,
        'it would cache a second copy of files the app already ships with');

      // Android sends the hardware back button to the activity, which finishes
      // it. Without this listener, back closes the app from any screen.
      // Waited for, not sampled. `.app-nav` is in the document before the
      // router has started, and the listener is claimed after — so reading
      // once here passed on a fast run and failed on a slow one, which is the
      // worst way for a check to be wrong.
      const claimed = await shell.waitForFunction(() => globalThis.__nativeCalls
        .some((c) => c.plugin === 'App' && c.method === 'addListener' && c.args[0] === 'backButton'),
      null, { timeout: 10_000 }).then(() => true, () => false);

      const listeners = await shell.evaluate(() => globalThis.__nativeCalls
        .filter((c) => c.plugin === 'App' && c.method === 'addListener')
        .map((c) => c.args[0]));
      check('the hardware back button is claimed from the platform', claimed,
        `listeners: ${listeners.join(', ') || 'none'}`);

      // The reason `@capacitor/filesystem` is installed at all. Both web paths
      // — the file picker and a click on `<a download href="blob:…">` — are
      // silent no-ops in a WebView, so every export in the application would
      // have appeared to work and produced nothing.
      // The specifier is passed in rather than written inline: it resolves
      // against the page, and a literal here would be resolved by the type
      // checker against this file, where no such module exists.
      await shell.evaluate(async (module) => {
        const { download } = await import(module);
        await download({ blobParts: 'a,b\n1,2\n', mime: 'text/csv', filename: 'export.csv' });
      }, './js/modules/reports.js');
      const after = await shell.evaluate(() => globalThis.__nativeCalls.slice(-6));

      const wrote = after.find((c) => c.plugin === 'Filesystem' && c.method === 'writeFile');
      const shared = after.find((c) => c.plugin === 'Share' && c.method === 'share');
      check('an export is written through the native filesystem', Boolean(wrote),
        `calls: ${JSON.stringify(after)}`);
      check('and handed to the share sheet', Boolean(shared));
      check('and carries the file, base64 encoded, not an empty write',
        typeof wrote?.args?.[0]?.data === 'string' && wrote.args[0].data.length > 4,
        JSON.stringify(wrote?.args?.[0]?.data));
      check('and keeps the filename it was given', wrote?.args?.[0]?.path === 'export.csv');

      // The anchor fallback must not also fire: two saves for one export, and
      // on a real device the second one silently does nothing.
      const fellThrough = after.filter((c) => c.method === 'anchorDownload');
      check('and does not also fall through to the web download path',
        fellThrough.length === 0,
        `the web download path also ran, for ${fellThrough.map((c) => c.args[0]).join(', ')}`);

      await nativeContext.close();
    }

    /* --------------------------------------------- headings and naming */

    /*
     * Two things a screen reader needs, checked across every screen rather
     * than on the one that happened to be open.
     *
     * **Heading order.** `pageHeader` emits the `h1` and `cardHeader` emitted
     * an `h3`, with no `h2` anywhere in the application — so every screen
     * jumped a level. Somebody navigating by heading heard the page title and
     * then level three, with nothing between, on all 138 screens a probe
     * walked. A card *is* the second level of a page, so the tag was simply
     * wrong; `.card-header h2` holds the size an `h3` had so nothing moved.
     *
     * **An accessible name on everything operable.** Three file inputs were
     * `.sr-only`, which hides an element from the eye and *keeps* it
     * announced — so a screen reader met an unnamed file input beside the
     * button that opens it. They are `aria-hidden` with `tabindex="-1"` now,
     * because each is an implementation detail with a named button in front
     * of it, and naming them would have made two controls where a person has
     * one.
     *
     * Walked over every module and every entity's own list, because both
     * faults were per-component: checking one screen would have found the
     * heading skip and missed the inputs entirely.
     */
    {
      /** @type {string[]} */
      const skips = [];
      /** @type {string[]} */
      const nameless = [];
      /** @type {string[]} */
      const unlabelled = [];

      const walked = [];
      for (const mod of SCHEMA_MODULES) walked.push(`#/${mod.id}`);
      for (const [name, def] of Object.entries(SCHEMA_ENTITIES)) {
        walked.push(`#/${def.module}/${name}`);
      }
      walked.push('#/profile', '#/settings', '#/notifications', '#/wellbeing', '#/timeline');

      /*
       * Screens a hash alone does not reach.
       *
       * Two of the three unnamed file inputs live behind something: the chat
       * picker only exists inside an open conversation, and the statement
       * importer inside Finance's own tab. Walking the module list alone left
       * both uncovered — mutating them back to unnamed changed nothing here,
       * which is a check that cannot fail for the very cases that prompted it.
       */
      const conversation = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const rows = await app().db.repo('conversation').list({ limit: 5 }).catch(() => []);
        return rows[0]?.id ?? null;
      }, IN_PAGE.context);
      if (conversation) walked.push(`#/chat/conversation/${conversation}`);
      walked.push('#/finance/import');

      for (const hash of walked) {
        await go(page, hash);

        const found = await page.evaluate(() => {
          /** A control a person can operate, and whether anything names it. */
          const named = (el) => {
            const aria = el.getAttribute('aria-label');
            if (aria && aria.trim()) return true;
            const by = el.getAttribute('aria-labelledby');
            if (by && by.split(/\s+/).some((id) => document.getElementById(id))) return true;
            if ((el.getAttribute('title') ?? '').trim()) return true;
            return ((el instanceof HTMLElement ? el.innerText : '') || el.textContent || '')
              .trim().length > 0;
          };

          const drawn = (el) => {
            const box = el.getBoundingClientRect();
            // `aria-hidden` is not drawn *for this purpose*: it is deliberately
            // not in the accessibility tree, which is the whole point of the
            // pattern the file inputs use.
            if (el.closest('[aria-hidden="true"]')) return false;
            return box.width > 0 || box.height > 0;
          };

          const out = { skips: [], nameless: [], unlabelled: [] };

          for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
            if (drawn(el) && !named(el)) {
              out.nameless.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
            }
          }

          for (const el of document.querySelectorAll('input, select, textarea')) {
            if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement
              || el instanceof HTMLTextAreaElement)) continue;
            if (el.type === 'hidden' || !drawn(el)) continue;
            const id = el.getAttribute('id');
            const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
              || el.closest('label')
              || el.getAttribute('aria-label')
              || el.getAttribute('aria-labelledby')
              || el.getAttribute('placeholder');
            if (!labelled) {
              out.unlabelled.push(`${el.tagName.toLowerCase()}[${el.type}].${String(el.className).slice(0, 30)}`);
            }
          }

          let last = 0;
          for (const heading of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
            const level = Number(heading.tagName.slice(1));
            if (last && level > last + 1) out.skips.push(`h${last} -> h${level}`);
            last = level;
          }

          return out;
        });

        for (const one of found.skips) skips.push(`${hash}: ${one}`);
        for (const one of found.nameless) nameless.push(`${hash}: ${one}`);
        for (const one of found.unlabelled) unlabelled.push(`${hash}: ${one}`);
      }

      // The premise. A walk that rendered nothing would satisfy all three.
      check('the accessibility walk actually opened screens', walked.length > 40,
        `${walked.length} screens`);

      check('no screen jumps a heading level', skips.length === 0,
        [...new Set(skips)].slice(0, 6).join(' | '));
      check('every control a person can operate has an accessible name',
        nameless.length === 0, [...new Set(nameless)].slice(0, 6).join(' | '));
      check('and every input has a label of some kind',
        unlabelled.length === 0, [...new Set(unlabelled)].slice(0, 6).join(' | '));
    }

    /* ------------------------------------------------ settings, measured */

    /*
     * Nineteen cards in one flat grid.
     *
     * The note at the top of `js/modules/settings.js` says the cards live in
     * `js/modules/settings/` "grouped by the question somebody came to this
     * screen to ask". That was true of the *files* and had never been true of
     * the screen: measured on a 390×844 phone it was 6,905px — **8.2 screens
     * of scrolling** — with nothing to navigate by, and a single 1,301px card
     * of OAuth scopes (19% of the page, read once during setup) sitting above
     * Security, Appearance and Backup.
     *
     * This measures the rendered document rather than reading the source,
     * because the source is what made the claim.
     */
    {
      await page.setViewportSize({ width: 390, height: 844 });
      await go(page, '#/settings');
      await page.waitForTimeout(900);

      const settings = await page.evaluate(() => {
        const content = document.querySelector('.app-content');
        const groups = [...document.querySelectorAll('.settings-group')];
        const tallest = [...document.querySelectorAll('.app-content .card')]
          .map((el) => ({
            title: (el.querySelector('h2')?.textContent ?? '').trim(),
            height: Math.round(el.getBoundingClientRect().height),
          }))
          .sort((a, b) => b.height - a.height)[0] ?? { title: '', height: 0 };

        return {
          height: content instanceof HTMLElement ? content.scrollHeight : 0,
          viewport: globalThis.innerHeight,
          groups: groups.map((el) => (el.querySelector('.settings-group-title')?.textContent ?? '').trim()),
          cards: document.querySelectorAll('.app-content .card').length,
          tallest,
          // Every card contributes a heading, including the folded ones.
          headings: document.querySelectorAll('.app-content .card h2').length,
          jumps: document.querySelectorAll('.settings-jump .chip').length,
        };
      });

      check('settings is grouped rather than one flat grid',
        settings.groups.length >= 5, JSON.stringify(settings.groups));
      check('and every group can be jumped to', settings.jumps === settings.groups.length,
        `${settings.jumps} jump chips for ${settings.groups.length} groups`);
      check('and every group is named', settings.groups.every((one) => one.length > 0),
        JSON.stringify(settings.groups));
      check('and it still draws every card it did before',
        settings.cards >= 19, `${settings.cards} cards`);

      /*
       * Every card carries a heading, folded ones included.
       *
       * `breachCard` was a `<details>` whose summary was bare text, so it
       * contributed nothing to heading navigation while all eighteen others
       * contributed one. The scope list now folds the same way and had to not
       * repeat that.
       */
      check('every card contributes a heading, including the folded ones',
        settings.headings >= settings.cards,
        `${settings.headings} headings for ${settings.cards} cards`);

      /*
       * The folded card, specifically — not a budget on every card.
       *
       * The first version of this check asserted that no card exceeded one
       * viewport, on the reasoning that card height does not depend on the
       * fixture. That was wrong and the suite said so: the audit log came out
       * at 951px because it lists whatever activity this run happened to
       * create, and so do conflicts and deleted items. A budget on those is a
       * budget on the fixture.
       *
       * What is worth pinning is the thing that was actually wrong: a
       * hundred-line scope reference open by default above Security and
       * Backup. Closed, it is a heading.
       */
      const folded = await page.evaluate(() => {
        const scopes = [...document.querySelectorAll('details.card')]
          .find((el) => /Google permissions/.test(el.textContent ?? ''));
        if (!(scopes instanceof HTMLElement)) return null;
        return { open: scopes.hasAttribute('open'),
          height: Math.round(scopes.getBoundingClientRect().height) };
      });
      check('the scope reference is folded away by default',
        folded !== null && !folded.open && folded.height < 120, JSON.stringify(folded));

      /*
       * And the two strings a broken sign-in needs are *not* folded with it.
       *
       * They were inside that card, and folding it took them too — the
       * commonest reason a Google sign-in fails has nothing to do with
       * scopes, so hiding them was the wrong call. Two existing checks failed
       * the moment it happened, which is how it surfaced.
       */
      const body = (await page.locator('.app-content').innerText()).trim();
      check('and the redirect URI is still visible without opening anything',
        /Authorised redirect URI/.test(body), body.slice(0, 300));

      await page.setViewportSize({ width: 1280, height: 900 });
    }

    /* --------------------------------------------- the secondary modules */

    /*
     * Seven modules that had no screen of their own, and the three of them
     * that hold a question one entity cannot answer.
     *
     * The important one is `property`. A tenancy can be written on the
     * property — `rented`, `tenantName`, `monthlyRent`, `leaseEndsOn` — and in
     * a whole `tenant` entity pointing at it, and **the application reads a
     * different one for each question**: `domain/rentreceipt.js` builds a
     * receipt from the property's fields and has never read a tenant record,
     * while the reminders derive from every expiry field and so fire for
     * either. Two households could each believe they had recorded a tenancy
     * and get different behaviour.
     */
    {
      const before = consoleErrors.length;

      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const db = app().db;

        // Agrees: nothing should be said about this one.
        const quiet = await db.repo('property').create({
          name: 'Quiet Flat', kind: 'apartment', rented: true, tenantName: 'Ravi',
          monthlyRent: 3_500_000,
        });
        await db.repo('tenant').create({
          name: 'Ravi', property: quiet.id, monthlyRent: 3_500_000,
        });

        // Disagrees on the name.
        const argued = await db.repo('property').create({
          name: 'Argued Flat', kind: 'apartment', rented: true, tenantName: 'Ravi',
        });
        await db.repo('tenant').create({ name: 'Someone Else', property: argued.id });

        // Only on the property: no reminder when the agreement ends.
        await db.repo('property').create({
          name: 'Lonely Shop', kind: 'commercial', rented: true, tenantName: 'Priya',
        });

        // Not let at all: not a finding.
        await db.repo('property').create({ name: 'Empty Plot', kind: 'land', rented: false });

        /*
         * Two tasks saying two things, arriving the two different ways they
         * actually can, and one that does not.
         *
         * `done` with no completion date is refused by `validate.js` — "A
         * completed task needs a completion date" — so it cannot be created
         * through the form. It reaches the store the way it really does:
         * `applyRemote`, which writes a row from the household's own
         * spreadsheet with no validation, deliberately, because a sync that
         * rejected a row would lose it. Creating it with `create` was the
         * first version of this fixture and the validator threw, which is the
         * check teaching the test what the application actually allows.
         *
         * A completion date on an open task has no rule at all, so that one
         * goes through the ordinary form path.
         */
        const seed = await db.repo('task').create({
          title: 'Hand edited', status: 'todo', completedOn: '2026-06-01',
        });
        await db.repo('task').applyRemote({
          ...seed, id: 'task-hand-edited', title: 'Done with no date',
          status: 'done', completedOn: '',
        });
        await db.repo('task').create({ title: 'Ordinary task', status: 'todo' });

        // An emergency list with two contacts claiming first place.
        await db.repo('emergencyContact').create({
          name: 'First Amma', phone: '9000000001', relationship: 'mother', priority: 1,
        });
        await db.repo('emergencyContact').create({
          name: 'First Appa', phone: '9000000002', relationship: 'father', priority: 1,
        });
      }, IN_PAGE.context);

      /** The text of one card, found by its heading. */
      const cardText = (heading) => page.evaluate((wanted) => {
        const head = [...document.querySelectorAll('.card h2')]
          .find((node) => (node.textContent || '').includes(wanted));
        const card = head && head.closest('.card');
        return card instanceof HTMLElement ? card.innerText : '';
      }, heading);

      await go(page, '#/property');
      await page.waitForTimeout(700);

      const tenancies = await cardText('recorded in two places');
      check('the property screen draws its tenancy card', tenancies.length > 0,
        (await page.locator('.app-content').innerText()).slice(0, 400));
      check('and names the one that disagrees', /Argued Flat/.test(tenancies),
        tenancies.slice(0, 500));
      check('and the one recorded in only one place', /Lonely Shop/.test(tenancies),
        tenancies.slice(0, 500));
      check('but not the one that agrees', !/Quiet Flat/.test(tenancies),
        tenancies.slice(0, 500));
      check('and not a property nobody is renting', !/Empty Plot/.test(tenancies),
        tenancies.slice(0, 500));

      // It says what each case costs, because naming a state is not enough to
      // act on.
      check('and says what the disagreement costs',
        /receipts use the property/i.test(tenancies), tenancies.slice(0, 600));

      // The generic list is still there. Nothing was removed.
      check('the property list is still on the screen',
        await page.locator('.list-item, table').count() > 0);

      await go(page, '#/tasks');
      await page.waitForTimeout(600);
      const tasks = await cardText('say two things');
      check('a completion date on a task that is not done is raised',
        /Hand edited/.test(tasks), tasks.slice(0, 400));
      check('and so is one that arrived through sync marked done with no date',
        /Done with no date/.test(tasks), tasks.slice(0, 400));
      check('and an ordinary open task is not',
        !/Ordinary task/.test(tasks), tasks.slice(0, 400));

      await go(page, '#/emergency');
      await page.waitForTimeout(600);
      const reach = await cardText('in a hurry');
      check('two contacts claiming first place is named',
        /First Amma/.test(reach) && /First Appa/.test(reach), reach.slice(0, 400));

      /*
       * The four that point elsewhere rather than recomputing.
       *
       * `policy.nominee` and `digitalAsset.legacyInstruction` are read by
       * `domain/estate.js`, and the education dates are already reminders. A
       * second implementation of one question is the fault this repository
       * has spent the week removing.
       */
      /** @type {[string, RegExp][]} */
      const pointers = [
        ['insurance', /estate review/i],
        ['digital', /estate review/i],
        ['education', /Notifications tab/i],
        ['notes', /nothing here is worked out/i],
      ];
      for (const [id, pattern] of pointers) {
        await go(page, `#/${id}`);
        await page.waitForTimeout(500);
        const said = await cardText('already is');
        check(`${id} says where its answer already is`, pattern.test(said),
          said.slice(0, 300));
      }

      check('the secondary screens raise no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    /* ------------------------------------------- a link that is not a link */

    /*
     * The path the form does not cover.
     *
     * `data/formats.js` refuses `javascript:` and `data:` when a URL is typed
     * into the form, with a comment saying exactly why. That is the write
     * path, and it is not the only one: `Repository.applyRemote` writes a row
     * arriving from the household's own Google Sheet straight to the store
     * with no validation at all — deliberately, because a sync that rejected
     * a row would lose it, and silent data loss is the worse failure.
     *
     * So this check does not go through the form. It writes through
     * `applyRemote`, exactly as a sync would, and then opens the real screen.
     */
    {
      const before = consoleErrors.length;

      const seeded = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const db = app().db;
        const real = await db.repo('digitalAsset').create({
          name: 'Ordinary domain', kind: 'domain', url: 'https://example.in',
        });
        const hostile = {
          ...real,
          id: 'da-hostile',
          name: 'Arrived through sync',
          url: 'javascript:globalThis.__ranTheLink = true',
        };
        await db.repo('digitalAsset').applyRemote(hostile);
        const back = await db.repo('digitalAsset').get('da-hostile');
        return { stored: back?.url ?? null, ok: real.id };
      }, IN_PAGE.context);

      // The premise. If validation had silently cleaned it, the check below
      // would pass against a screen that had never been given anything bad.
      check('a hostile link really does reach the store through sync',
        seeded.stored === 'javascript:globalThis.__ranTheLink = true',
        String(seeded.stored));

      /*
       * The record screen, not the list.
       *
       * `url` is `list: false` in the schema, so it is never a column — it is
       * `detailValue` in `crud.js` that turns it into an anchor, and that runs
       * on the record a person opens.
       */
      await go(page, '#/digital/digitalAsset/da-hostile');
      await page.waitForTimeout(700);

      const anchors = await page.evaluate(() => [...document.querySelectorAll('a')]
        .map((a) => a.getAttribute('href') ?? '')
        .filter((href) => /javascript:/i.test(href)));
      check('and no anchor on the screen carries it', anchors.length === 0,
        anchors.join(' | '));

      // The value is still shown. Hiding it would leave a household unable to
      // see what is actually in their record.
      const screen = (await page.locator('.app-content').innerText()).trim();
      check('but the stored text is still shown, not swallowed',
        /Arrived through sync/.test(screen), screen.slice(0, 500));

      // And the ordinary one is still a working link, on its own record.
      await go(page, `#/digital/digitalAsset/${seeded.ok}`);
      await page.waitForTimeout(700);
      const good = await page.evaluate(() => [...document.querySelectorAll('a')]
        .some((a) => (a.getAttribute('href') ?? '').startsWith('https://example.in')));
      check('while an ordinary link is still a link', good);

      check('nothing ran', await page.evaluate(() => !globalThis.__ranTheLink));
      check('the digital screen raises no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));
    }

    /* ---------------------------------------------------------- health */

    /*
     * Four record lists that could not previously disagree out loud.
     *
     * `health` was a generic CRUD module: four tabs, four tables, and nothing
     * that noticed a course of tablets marked ongoing whose end date passed in
     * March, or an appointment last Tuesday nobody marked attended. Those are
     * the records contradicting themselves, and no single list can show it.
     *
     * The checks below seed one of each contradiction and one quiet
     * counterpart, so a screen that simply listed everything would fail as
     * loudly as one that listed nothing.
     */
    {
      const before = consoleErrors.length;

      const seeded = await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const db = app().db;
        const day = (offset) => {
          const d = new Date();
          d.setDate(d.getDate() + offset);
          return d.toISOString().slice(0, 10);
        };

        const person = await db.repo('person').create({ name: 'Health Person' });
        const who = person.id;

        // Five questions, one of each kind.
        await db.repo('medication').create({
          person: who, name: 'Amoxicillin', ongoing: true, endsOn: day(-120),
        });
        await db.repo('medication').create({
          person: who, name: 'Ibuprofen', ongoing: false,
        });
        await db.repo('appointment').create({
          person: who, title: 'Dentist', date: day(-9), status: 'scheduled',
        });
        await db.repo('vaccination').create({
          person: who, vaccine: 'Tetanus', date: day(-400), nextDoseOn: day(-30),
        });
        await db.repo('healthRecord').create({
          person: who, title: 'Knee scan', date: day(-200), kind: 'imaging',
          followUpOn: day(-60),
        });

        // And the quiet ones, which must not appear as questions.
        await db.repo('medication').create({
          person: who, name: 'Thyroxine', ongoing: true,
        });
        await db.repo('appointment').create({
          person: who, title: 'Eye test', date: day(21), status: 'scheduled',
        });
        await db.repo('healthRecord').create({
          person: who, title: 'Blood test', date: day(-10), kind: 'lab report',
        });

        return { who, ranOut: day(-120), nextDose: day(-30) };
      }, IN_PAGE.context);

      await go(page, '#/health');
      await page.waitForTimeout(600);

      const screen = (await page.locator('.app-content').innerText()).trim();

      /**
       * The text of one card, found by its heading.
       *
       * Matching a record's name anywhere on the page proves nothing here:
       * every one of these names is also in the table below, so a check for
       * `/Amoxicillin/` passes with the questions card completely empty. Same
       * fault as reading a name off the dashboard and calling it a reminder.
       */
      const cardText = (heading) => page.evaluate((wanted) => {
        const head = [...document.querySelectorAll('.card h2')]
          .find((node) => (node.textContent || '').includes(wanted));
        const card = head && head.closest('.card');
        return card instanceof HTMLElement ? card.innerText : '';
      }, heading);

      const raised = await cardText('do not agree about');
      check('the questions card is drawn at all', raised.length > 0, screen.slice(0, 400));

      /*
       * The sentence, not the name.
       *
       * Each of these is the wording that only the questions card produces,
       * so it cannot be satisfied by the record appearing in its own table.
       */
      /** @type {[string, RegExp][]} */
      const questions = [
        ['a course of tablets that ran out', /Is Amoxicillin still being taken/i],
        ['one stopped with no date', /When did Ibuprofen stop/i],
        ['an appointment nobody answered', /Did the appointment for Dentist happen/i],
        ['a next dose with nothing later recorded', /Has the next dose of Tetanus been given/i],
        ['a follow-up date that went by', /Was Knee scan followed up/i],
      ];
      for (const [what, pattern] of questions) {
        check(`the health screen raises ${what}`, pattern.test(raised), raised.slice(0, 800));
      }

      // The counterparts. A screen listing everything would pass every check
      // above and be useless.
      check('and a repeat prescription with no end date is not a question',
        !/Thyroxine/i.test(raised), raised.slice(0, 800));
      check('and an appointment still ahead is not a question',
        !/Eye test/i.test(raised), raised.slice(0, 800));
      check('and a record with no follow-up date is not a question',
        !/Blood test/i.test(raised), raised.slice(0, 800));

      // Longest unanswered first, across kinds rather than grouped by list.
      const order = ['Amoxicillin', 'Knee scan', 'Tetanus', 'Dentist']
        .map((name) => raised.indexOf(name));
      check('and the longest unanswered is at the top, across kinds',
        order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
        `${order.join(', ')} in ${raised.slice(0, 500)}`);

      /*
       * Nothing on this screen states a medical fact.
       *
       * Every finding is about the records. A word like "overdue" or "missed"
       * would be this application making a claim about somebody's treatment
       * out of a tick box nobody remembered to untick.
       */
      for (const word of ['overdue', 'at risk', 'you should', 'urgent']) {
        check(`the health screen never says "${word}"`,
          !new RegExp(word, 'i').test(raised), raised.slice(0, 500));
      }
      check('and does not call an unanswered appointment missed',
        !/Dentist[^\n]*missed/i.test(raised), raised.slice(0, 500));

      // What is current, derived from the dates rather than the tick box.
      // Both these records have `ongoing: true`; only one is still running.
      const current = await cardText('Being taken');
      check('what is being taken is derived, not read from the tick box',
        /Thyroxine/.test(current) && !/Amoxicillin/.test(current),
        current.slice(0, 400));

      // The absences, on the screen rather than only in a comment.
      /** @type {[string, RegExp][]} */
      const absences = [
        ['steps and sleep', /steps, exercise, sleep/i],
        ['heart rate and blood pressure', /heart rate, blood pressure/i],
        ['cycle predictions', /cycle tracking or predictions/i],
        ['interaction checking', /no drug database/i],
        ['doses taken', /doses taken or missed/i],
      ];
      for (const [what, pattern] of absences) {
        check(`the health screen says it cannot show ${what}`, pattern.test(screen),
          screen.slice(-900));
      }

      // Nothing was removed: the generic tabs and lists are still there.
      const tab = page.locator('.chip-row button', { hasText: 'Vaccinations' }).first();
      const hasTabs = await tab.count() > 0;
      check('and the four record lists are still reachable', hasTabs);
      if (hasTabs) {
        await tab.click();
        await page.waitForTimeout(500);
        const vaccinations = (await page.locator('.app-content').innerText()).trim();
        check('and a tab still opens its list', /Tetanus/.test(vaccinations),
          vaccinations.slice(0, 400));
      }

      /*
       * The payoff of the one schema change, end to end.
       *
       * A follow-up, a next dose and an appointment all reached the dashboard
       * reminders. The tablets running out did not — the one date a household
       * has to act on *before* the day arrives. `medication.endsOn` is an
       * expiry field now, so a course ending soon has to show up on the first
       * screen a household opens.
       */
      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const d = new Date();
        d.setDate(d.getDate() + 4);
        await app().db.repo('medication').create({
          person: (await app().db.repo('person').list({ limit: 200 }))
            .find((p) => p.name === 'Health Person').id,
          name: 'Metformin', ongoing: true, endsOn: d.toISOString().slice(0, 10),
        });
      }, IN_PAGE.context);

      /*
       * The Notifications tab, not the dashboard.
       *
       * Two wrong targets before this one. Reading the whole dashboard passed
       * with the expiry flag removed — creating the record writes an audit
       * entry and the activity widget prints the name, so the check could not
       * fail. The `Expiring & due` card is the right *kind* of place and is
       * off by default: `wallet` and `attention` cover the same records better
       * on a phone, and the attention card deliberately shows three rows.
       *
       * Notifications is where the list actually lives. It is built by
       * `AttentionService.everything`, the same arithmetic the dashboard card
       * counts, and it carries no activity feed to match a name by accident.
       */
      await go(page, '#/health');
      await go(page, '#/notifications');
      await page.waitForTimeout(700);

      const waiting = (await page.locator('.app-content').innerText()).trim();
      check('a course of tablets running out reaches the notifications tab',
        /Metformin/.test(waiting), waiting.slice(0, 900));

      check('the health screen raises no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      void seeded;
    }

    /* ----------------------------------------------------- screen time */

    /*
     * The stack that was built and never drawn.
     *
     * The native plugin, `js/core/screentime.js` and `js/services/screentime.js`
     * all existed and no module imported the service — the same fault that
     * left `ChatService.send`, `markVerified`, `revoke` and `withdraw`
     * unreachable. The first check here is therefore not about screen time at
     * all: it is that a person can get to the screen by tapping, from Profile,
     * without typing a URL.
     *
     * The rest drive four of the blocked states in sequence in one browser. A
     * check that opened the screen once would pass on a module that printed
     * the same sentence for every state, which is the whole thing the
     * separation exists to prevent — so each state is compared against the
     * ones before it, not only against a pattern.
     */
    {
      const before = consoleErrors.length;

      /*
       * Dismiss what an earlier check left on screen, the way a person would.
       *
       * An error toast has no timer — `toast()` gives `kind: 'error'` a
       * duration of zero on purpose, because an error somebody has to read
       * should not vanish while they read it. One left over from the recovery
       * phrase check sat over the foot of Profile and swallowed the tap:
       * Playwright waited ten seconds for a row that was visible, enabled and
       * stable the whole time. Clicking its own Dismiss button is the honest
       * clear-down; `force: true` on the row would have hidden the problem
       * rather than removed it, and the check below would have stopped being
       * able to fail.
       */
      for (const close of await page.locator('.toast button[aria-label="Dismiss"]').all()) {
        await close.click().catch(() => {});
      }

      await go(page, '#/profile');
      /*
       * `:visible`, and by destination rather than by label.
       *
       * The router leaves the previous screen's node in `.app-content` while
       * the next one is still resolving, so a plain `.first()` picked a row
       * that was in the document and had no box — a click that timed out on a
       * screen a person can see perfectly well. Matching the href is also the
       * stronger assertion: it is the destination that has to exist, not the
       * wording.
       */
      const wellbeingLink = page.locator('a.list-item[href="#/wellbeing"]:visible').first();
      const rows = await page.locator('a.list-item[href="#/wellbeing"]').count();
      const reachable = await wellbeingLink.count() > 0;
      check('screen time is reachable by tapping, not only by typing a URL', reachable,
        `the screen-time stack was built and no module imported it (${rows} rows in the document)`);
      check('and the row says what it goes to',
        reachable && /screen time/i.test(await wellbeingLink.innerText()));

      const covering = await page.evaluate(() => {
        const row = [...document.querySelectorAll('a.list-item')]
          .find((a) => a.getAttribute('href') === '#/wellbeing');
        if (!row) return 'no row';
        row.scrollIntoView({ block: 'center' });
        const box = row.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        if (!top || row.contains(top)) return '';
        const path = [];
        for (let n = top; n && path.length < 5; n = n.parentElement) {
          path.push(`${n.tagName}.${String(n.className).slice(0, 40)}`);
        }
        return path.join(' < ');
      });
      check('nothing is sitting on top of the row', covering === '', covering);

      let tapped = '';
      if (reachable) {
        // Centred first. The bottom navigation is fixed, so a row near the
        // foot of a long Profile is on the page and under the tab bar.
        await wellbeingLink.scrollIntoViewIfNeeded().catch(() => {});
        tapped = await wellbeingLink.click({ timeout: 10_000 })
          .then(() => '', (err) => String(err.message).replace(/\s+/g, ' ').slice(0, 500));
      }
      check('and the row can actually be tapped', reachable && tapped === '', tapped);
      await page.waitForTimeout(450);

      const landed = await page.evaluate(() => globalThis.location.hash);
      check('and the tap lands on it', landed.includes('wellbeing'), landed);

      const said = {};
      const readScreen = async () => (await page.locator('.app-content').innerText()).trim();
      const reopen = async () => {
        // Through the dashboard, so the module is re-entered rather than left
        // showing what it painted before the state changed.
        await go(page, '#/dashboard');
        await go(page, '#/wellbeing');
        return readScreen();
      };
      const consentWays = () => page.getByRole('link', { name: /where consent is recorded/i }).count();
      const settingsButtons = () => page.getByRole('button', { name: /usage access settings/i }).count();

      // Somebody is signed in by now and nobody has asked them.
      said.unasked = await readScreen();
      check('a person who has not been asked is told that, not told it is unavailable',
        /has not been asked/i.test(said.unasked)
          && !/not available|unavailable/i.test(said.unasked),
        said.unasked.slice(0, 400));
      check('and there is a way to the screen where consent is recorded',
        await consentWays() === 1);
      // Usage access has no prompt, so a button claiming to ask for it would
      // describe a request Android never makes.
      check('and no settings button, because a settings page cannot fix an unasked question',
        await settingsButtons() === 0);

      // A person who said no. Their answer stands, so this state offers no
      // way to be asked again.
      await page.evaluate(async (specs) => {
        const { app } = await import(specs[0]);
        const { withdraw } = await import(specs[1]);
        await withdraw(app().db, 'screenTime', { subject: app().db.actor.personId });
      }, [IN_PAGE.context, IN_PAGE.consent]);

      said.refused = await reopen();
      check('a person who said no is told nothing is read',
        /said no/i.test(said.refused) && /nothing is read/i.test(said.refused),
        said.refused.slice(0, 400));
      check('and is not offered a way to be asked again', await consentWays() === 0);

      // Consent given, and a browser still cannot read: the device half is
      // checked separately from the consent half rather than folded into it.
      await page.evaluate(async (specs) => {
        const { app } = await import(specs[0]);
        const { grant } = await import(specs[1]);
        await grant(app().db, 'screenTime', { subject: app().db.actor.personId });
      }, [IN_PAGE.context, IN_PAGE.consent]);

      said.noPlugin = await reopen();
      check('consent given and a browser still says which half is missing',
        /no screen-time service/i.test(said.noPlugin), said.noPlugin.slice(0, 400));
      check('and the consent link is gone once consent is not the problem',
        await consentWays() === 0);

      // Nobody signed in at all: not the same as nobody having asked.
      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        app().db.setActor({ personId: '', role: 'owner' });
      }, IN_PAGE.context);

      said.noPerson = await reopen();
      check('with nobody signed in it says so, rather than "not available"',
        /nobody is signed in/i.test(said.noPerson)
          && !/not available|unavailable/i.test(said.noPerson),
        said.noPerson.slice(0, 400));

      // The point of keeping the states apart, checked as a property rather
      // than four patterns that could all match one sentence.
      const sentences = Object.values(said);
      check('and all four blocked states print different sentences',
        new Set(sentences).size === sentences.length,
        Object.keys(said).join(', '));

      // Every absence a phone's own wellbeing page shows and this one does
      // not, on the screen rather than only in a comment.
      /** @type {[string, RegExp][]} */
      const absences = [
        ['categories', /no categories/i],
        ['screen time while walking or driving', /walking or driving/i],
        ['listening volume', /listening volume|hearing/i],
        ['app timers and bedtime mode', /app timers/i],
      ];
      for (const [what, pattern] of absences) {
        check(`the screen says it cannot show ${what}`, pattern.test(said.noPerson),
          said.noPerson.slice(0, 600));
      }

      // No reading was taken, so nothing may look like one.
      check('and no reading is drawn when there is none',
        await page.locator('.wellbeing-bar').count() === 0);

      check('the screen-time screen raises no console error',
        consoleErrors.length === before, consoleErrors.slice(before).join(' | '));

      // Put the signed-in person back for anything after this.
      await page.evaluate(async (spec) => {
        const { app } = await import(spec);
        const who = await app().db.meta('auth.currentPerson');
        app().db.setActor({ personId: who ?? '', role: 'owner' });
      }, IN_PAGE.context);
    }

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
  } catch (err) {
    /*
     * One throw used to discard every result.
     *
     * The report is printed after this block, so anything that threw inside it
     * went straight to `main().catch()` — which prints a stack trace and
     * exits. Four hundred checks' worth of answers, collected and then thrown
     * away, because one step further down hit a `waitForSelector` that never
     * resolved.
     *
     * Recording it as a failure instead means the run still says what it had
     * established before it fell over, and the exception is one line among
     * them rather than the only line.
     */
    check('the run reached the end without throwing', false,
      // The first line names the failure; the call log under it names *what*
      // it was waiting for, which is the half worth keeping.
      String(err.message ?? err).split('\n').slice(0, 6).join(' ').slice(0, 300));
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
