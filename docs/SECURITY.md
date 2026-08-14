# Security

State as audited at `68b9b65`. Findings only — nothing was changed.

## What is sound

- **WebCrypto throughout.** AES-256-GCM, PBKDF2 at 600,000 rounds, WebAuthn
  PRF. No homemade cryptography anywhere.
- **Two-level key hierarchy.** A random data key, wrapped separately by PIN,
  fingerprint, recovery phrase and (optionally) a Drive-escrowed key. Changing
  a PIN re-wraps and re-encrypts nothing.
- **The OAuth token is never persisted.** Memory only, renewed silently.
- **Backend verifies every request** against Google's `tokeninfo` and an
  owner/member list.
- **No `eval`, no `innerHTML` assignment, no hard-coded credentials, no
  `process.env`, no mock APIs in shipping code.** All verified by scan.
- **A parse check compiles every module**, catching syntax errors in screens
  no test imports.

## Weaknesses, in severity order

1. **Authorization is client-side only.** `js/security/rbac.js` decides what a
   `child` may see, inside the child's browser. The backend checks membership,
   not role. **A role is a UI convenience here, not a security boundary**, and
   must not be described as one until mirrored server-side.
2. **Google unlock makes the Google account sufficient to decrypt.** Opt-in,
   stated on the button and in `escrow.js`. It is the largest exposure a
   household can choose.
3. **93% of fields are plaintext** in IndexedDB and in the backup Sheet.
4. **No rate limiting** on the Apps Script deployment.
5. **No CSP on `index.html`.** `oauth-callback.html` has a strict one.
6. **No MFA, no session revocation, no device management.**

## Tests that exist

`tests/security.test.mjs` covers crypto round-trips, key wrapping, PIN
strength, RBAC rules, sanitisation and session limits.
`tests/escrow.test.mjs` covers the Drive escrow and the three device cases.

Not covered: XSS, CSRF, injection, upload safety, rate limits, API security
under a hostile client — several of which are only meaningful once a server
exists.
