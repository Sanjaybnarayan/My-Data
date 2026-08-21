#!/usr/bin/env node
/**
 * Register the URL scheme Google will send the sign-in answer to.
 *
 *   node tools/native-scheme.mjs <client-id>   write it into android/ and ios/
 *   node tools/native-scheme.mjs --check       fail if they disagree with the config
 *
 * ## Why this is a tool rather than a line in the manifest
 *
 * The scheme is the reversed client id, so it is different for every household
 * that deploys this — `com.googleusercontent.apps.123-abc`, where the digits are
 * theirs. It cannot be committed, for the same reason `familyos.config.json`
 * is gitignored: a fork should not carry somebody else's identifiers.
 *
 * Without it the flow fails in the most confusing way available. The browser
 * tab opens, Google accepts the sign-in, and the redirect goes nowhere at all —
 * the operating system has nothing registered for that scheme, so the app is
 * never told, and the household is left looking at a browser tab that says
 * everything worked.
 *
 * `--check` bites only when `familyos.config.json` names a native client id.
 * A clone with no configuration is a clone that cannot sign in yet, and failing
 * a build over that would be failing over the ordinary state of a fresh copy.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemeFor } from '../js/auth/pkce.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
const PLIST = join(ROOT, 'ios/App/App/Info.plist');
const CONFIG = join(ROOT, 'familyos.config.json');

const MARK = 'familyos:oauth-scheme';

export function configuredClientId(path = CONFIG) {
  if (!existsSync(path)) return '';
  try {
    return JSON.parse(readFileSync(path, 'utf8')).googleNativeClientId ?? '';
  } catch {
    return '';
  }
}

/** The scheme currently registered on Android, or ''. */
export function androidScheme(xml = read(MANIFEST)) {
  return /<!-- familyos:oauth-scheme -->[\s\S]*?android:scheme="([^"]+)"/.exec(xml)?.[1] ?? '';
}

/** The scheme currently registered on iOS, or ''. */
export function iosScheme(plist = read(PLIST)) {
  const block = /<key>CFBundleURLTypes<\/key>[\s\S]*?<\/array>\s*<\/dict>\s*<\/array>/.exec(plist);
  return /<string>(com\.googleusercontent\.apps\.[^<]+)<\/string>/.exec(block?.[0] ?? '')?.[1] ?? '';
}

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export function writeAndroid(xml, scheme) {
  const filter = `
            <!-- ${MARK} -->
            <!--
              Google sends the sign-in answer to the reversed client id. Without
              this the tab opens, the sign-in succeeds, and the redirect goes
              nowhere: nothing is registered for the scheme, so the application
              is never told. Written by tools/native-scheme.mjs.
            -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${scheme}" />
            </intent-filter>
`;

  const without = xml.replace(
    new RegExp(`\\n\\s*<!-- ${MARK} -->[\\s\\S]*?</intent-filter>\\n`, 'g'), '\n',
  );
  // After the launcher filter, inside the same activity.
  return without.replace(/(<\/intent-filter>\n)(\s*<\/activity>)/, `$1${filter}$2`);
}

export function writePlist(plist, scheme) {
  const block = `	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>${MARK}</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>${scheme}</string>
			</array>
		</dict>
	</array>
`;
  const without = plist.replace(
    /\t<key>CFBundleURLTypes<\/key>\n\t<array>[\s\S]*?<\/array>\n/, '',
  );
  return without.replace(/^<dict>\n/m, `<dict>\n${block}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const given = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const clientId = given || configuredClientId();

  if (!clientId) {
    if (check) {
      console.log('no googleNativeClientId configured — nothing to check');
      process.exit(0);
    }
    console.error('Usage: node tools/native-scheme.mjs <android-or-ios-oauth-client-id>');
    console.error('\nGet one from console.cloud.google.com → Credentials → Create OAuth client');
    console.error('ID → Android (package com.familyos.app, plus your signing SHA-1) or iOS');
    console.error('(bundle id com.familyos.app). See docs/NATIVE_SIGN_IN.md.');
    process.exit(1);
  }

  const scheme = schemeFor(clientId);
  if (!scheme.startsWith('com.googleusercontent.apps.')) {
    console.error(`${clientId} does not look like a Google client id`);
    process.exit(1);
  }

  if (check) {
    const problems = [];
    if (existsSync(MANIFEST) && androidScheme() !== scheme) {
      problems.push(`android registers "${androidScheme() || 'nothing'}", config says "${scheme}"`);
    }
    if (existsSync(PLIST) && iosScheme() !== scheme) {
      problems.push(`ios registers "${iosScheme() || 'nothing'}", config says "${scheme}"`);
    }
    if (problems.length) {
      console.error('The native projects do not match the configured client id:\n');
      for (const problem of problems) console.error(`  ${problem}`);
      console.error('\nRun `node tools/native-scheme.mjs` to write it.');
      process.exit(1);
    }
    console.log(`both platforms register ${scheme}`);
    process.exit(0);
  }

  if (existsSync(MANIFEST)) writeFileSync(MANIFEST, writeAndroid(read(MANIFEST), scheme));
  if (existsSync(PLIST)) writeFileSync(PLIST, writePlist(read(PLIST), scheme));
  console.log(`registered ${scheme}`);
  console.log('  android/app/src/main/AndroidManifest.xml');
  console.log('  ios/App/App/Info.plist');
}
