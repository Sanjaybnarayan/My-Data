# A comment is not a cipher

*One line of documentation said the Google refresh token was encrypted. It was
not, and had never been. This is the shortest, most expensive instance of the
fault this repository keeps finding.*

## The line

```js
/** Where the refresh token lives. Encrypted; see `data/schema.js` meta rules. */
export const REFRESH_KEY = 'auth.googleRefreshToken';
```

There are no meta rules in `data/schema.js`. The store is declared in full as:

```js
meta: { keyPath: 'key', indexes: [] },
```

and `Database.setMeta` is three lines that write straight to the adapter. So a
Google **refresh token** — long-lived authority over the household's Drive,
Sheets and Gmail — sat in plaintext in IndexedDB, behind a comment stating that
it did not, pointing at a file that says nothing on the subject.

## Why this one mattered more than the storage itself

The plaintext was a defect. The comment was worse, because it was **load
bearing in the wrong direction**: anybody auditing this file — including the
first draft of `docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` — reads that line and
moves on. A claim with nothing checking it does not merely fail to help; it
actively spends the attention that would have found the problem.

This repository has now found that shape nine times. It is the reason
`tools/architecture.mjs` exists, the reason `tools/self-description.mjs`
exists, and the reason the fix below comes with a probe.

## What it is now

Sealed with `encryptText` under the household data key, with AAD binding the
ciphertext to its own meta key — so a value lifted out of `meta` and pasted
under a different key fails its authentication tag rather than decrypting. The
same argument `fieldcrypto.js` makes per cell.

Three decisions inside that are worth stating, because each had a tempting
wrong answer:

**A device that cannot seal it does not store it.** The obvious fallback —
write it in the clear and carry on — makes the seal optional, and an optional
seal is the plaintext it replaced with an extra branch. A device that cannot
seal the token signs in again. That is an inconvenience; the fallback is a leak.

**A token written before this is used, then re-sealed.** Discarding it would
sign the household out of Google the moment they updated, which is a worse
thing to do to somebody than the exposure being fixed.

**Signing out still works on a locked device.** It is the one operation
somebody handing over a phone needs to succeed, so an unreadable token falls
back to the access token — exactly what the `||` did before any of this.

## The claim can now fail

```
| The Google refresh token is sealed, not merely said to be | exists |
  `wired:js/auth/googlenative.js#REFRESH_AAD` |
```

Renaming the constant breaks the build. That is the difference between this
sentence and the one it replaced.

**4 of 4 mutations caught**: falling back to plaintext, skipping the re-seal,
dropping the AAD, and reading a locked device as "no token".

## What is still true

This makes the token **as strong as the household's PIN, and no stronger** —
the data key unwraps under the same PIN. The brief's §17 asks for Android
Keystore, which would put it behind hardware the PIN cannot be brute-forced
out of. That is a native storage bridge, it is not built, and
`docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` records it as the remaining
improvement rather than claiming Keystore has been used.

The path also remains **dormant**: `tools/native-scheme.mjs` reports no
`googleNativeClientId` configured, so nothing in the shipping build reaches
this code. Fixing it now means it is safe the day somebody switches it on,
which is the only day it would otherwise have been noticed.
