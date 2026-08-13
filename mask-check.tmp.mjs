import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['tools/serve.mjs', '8322'], { stdio: ['ignore','pipe','inherit'] });
await new Promise(r => server.stdout.once('data', r));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:8322/index.html', { waitUntil: 'networkidle' });
const PIN = '482913';
for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
await page.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(400);
for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
await page.getByRole('button', { name: 'Done' }).click();
await page.waitForSelector('text=Your recovery phrase', { timeout: 20000 });
await page.locator('#kit-ack').check();
await page.getByRole('button', { name: 'I have written it down' }).click();
await page.waitForSelector('.app-nav', { timeout: 20000 });

const id = await page.evaluate(async () => {
  const { app } = await import('./js/context.js');
  const people = await app().db.repo('person').list({ limit: 1 });
  const doc = await app().db.repo('identityDocument').create({
    person: people[0]?.id ?? '', kind: 'passport', number: 'Z1234567',
    issuedBy: 'RPO Bengaluru', expiresOn: '2032-01-01',
  });
  return doc.id;
});

await page.evaluate(() => { location.hash = '#/identity/identityDocument'; });
await page.waitForTimeout(900);
const list = await page.locator('.app-content').innerText();
console.log('LIST  full number visible? ', list.includes('Z1234567'));
console.log('LIST  masked tail visible? ', /X+\s*4567/.test(list));

await page.evaluate((i) => { location.hash = '#/identity/identityDocument/' + i; }, id);
await page.waitForTimeout(900);
const detail = await page.locator('.app-content').innerText();
console.log('DETAIL full number hidden? ', !detail.includes('Z1234567'));
console.log('DETAIL shows masked tail?  ', /X+\s*4567/.test(detail));
const eye = await page.getByRole('button', { name: /Show/ }).count();
console.log('DETAIL reveal control?     ', eye > 0);
if (eye) {
  await page.getByRole('button', { name: /Show/ }).first().click();
  await page.waitForTimeout(300);
  console.log('DETAIL reveals on request? ', (await page.locator('.app-content').innerText()).includes('Z1234567'));
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); server.kill();
