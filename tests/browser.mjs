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
import { mkdir } from 'node:fs/promises';
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

      if (SHOTS) await shot(page, 'settings-privacy');
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
      check('the heading carries the day and not just a rule',
        /9 Aug 2026/.test(await page.locator('.ledger-day').first().innerText()));
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
