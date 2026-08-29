/**
 * Documents that tell somebody what to do, checked against what is there.
 *
 * `docs/SETUP.md` is the one file in this repository whose readers are not
 * developers: a household follows it once, by hand, and cannot tell a
 * complete instruction from an incomplete one. It said "copy in the five
 * files from `apps-script/`" and then named four of the six scripts. The two
 * it left out were `Policy.gs` — which `Sheets.gs` calls with no guard, so a
 * deployment without it throws on every push and pull — and `Otp.gs`.
 *
 * A hand-maintained list beside a derivable one. This derives it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

setSuite('docs');

describe('the setup instructions name every file they tell somebody to copy', () => {
  const scripts = readdirSync(join(ROOT, 'apps-script'))
    .filter((f) => f.endsWith('.gs'))
    .sort();
  const setup = readFileSync(join(ROOT, 'docs/SETUP.md'), 'utf8');

  /*
   * The bullet listing the scripts, and nothing else.
   *
   * Checking the whole document was a check that could not fail: the prose
   * beneath the list explains why `Policy.gs` matters, so deleting it *from
   * the list* left it named on the page and the test stayed green. Only the
   * line somebody copies from counts.
   */
  const listLine = setup.split('\n').find((l) => /^\s*-\s+`\w+\.gs`/.test(l)) ?? '';

  test('every script in apps-script/ is named on the line somebody copies from', () => {
    assert.ok(scripts.length > 0, 'the directory is empty, which cannot be right');
    assert.ok(listLine, 'docs/SETUP.md no longer has a bullet listing the scripts');
    for (const file of scripts) {
      assert.includes(listLine, `\`${file}\``, `${file} is not on the list in docs/SETUP.md`);
    }
  });

  test('and the list names nothing that is not there', () => {
    // The other direction: a file removed from `apps-script/` but left in the
    // instructions sends somebody looking for a file that does not exist.
    for (const named of listLine.match(/`(\w+\.gs)`/g) ?? []) {
      const file = named.replace(/`/g, '');
      assert.includes(scripts, file, `docs/SETUP.md names ${file}, which is not in apps-script/`);
    }
  });

  test('and the manifest, which is a separate step in the editor', () => {
    assert.includes(setup, '`appsscript.json`');
  });

  test('the count it states matches the count there is', () => {
    // The original said "five files" beside a list of four scripts plus the
    // manifest. Both halves have to move together or the sentence misleads
    // exactly the reader who is counting along.
    const written = /all (two|three|four|five|six|seven|eight|nine|ten) scripts/.exec(setup);
    assert.ok(written, 'docs/SETUP.md no longer states how many scripts there are');
    const words = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    assert.equal(words[words.indexOf(written[1])], words[scripts.length - 2],
      `docs/SETUP.md says ${written[1]} scripts, apps-script/ has ${scripts.length}`);
  });
});

describe('and they say how to update a deployment, not only how to make one', () => {
  const setup = readFileSync(join(ROOT, 'docs/SETUP.md'), 'utf8');

  test('the update path is Manage deployments, not New deployment', () => {
    /*
     * "New deployment" mints a second web app on a different `/exec` URL and
     * leaves the old one serving the old code, so the change appears not to
     * take effect and nothing reports an error. Every `.gs` fix in this
     * repository depends on somebody doing this correctly.
     */
    assert.includes(setup, 'Manage deployments');
    assert.includes(setup, 'New version');
    assert.includes(setup, 'Do not use "New deployment" for an update');
  });
});
