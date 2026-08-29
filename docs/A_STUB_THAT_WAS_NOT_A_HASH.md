# A stub that was not a hash

*A test asserted that a household's email address cannot be read out of the
one-time-code cache key. It passed. The address came back out in one line —
because the thing standing in for SHA-256 in the test harness returned its
input unchanged, and the test checked for a substring rather than for
recovery.*

## Not a vulnerability

The deployed code has always been right. `otpKey` hashes the address with a
real SHA-256 in Apps Script, and that is what runs in a household's
deployment. What follows is about what the tests were proving, which was less
than they appeared to.

## The stub

`tests/appsscript.mjs` opens by explaining itself:

> *"The stubs are deliberately literal. `PropertiesService` really is a string
> map; `CacheService` really does expire; `UrlFetchApp` really does return an
> object with `getResponseCode` and `getContentText`. **A stub that is more
> convenient than the real thing tests something that was never deployed.**"*

One of them was not literal:

```js
computeDigest: (_algorithm, value) => Buffer.from(String(value)),
```

An identity function wearing a hash's name.

## What that did to a test

`otpKey` builds the cache key a code is stored under:

```js
prefix + Utilities.base64EncodeWebSafe(
  Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, otpNormalise(address)))
```

Under the stub, that is `prefix + base64(address)`:

```
key under the stub : otp_code_YXNoYUBleGFtcGxlLmNvbQ
reversed           : asha@example.com
```

And the test guarding it:

```js
const keys = [...api.cache._map.keys()].join(' ');
assert.equal(keys.includes('asha@example.com'), false);
```

Base64 contains no such substring, so the assertion held. It asserted the
address was **unrecognisable**; it was read as saying the address was
**unrecoverable**. Only the second is the property worth having, and base64
provides none of it.

A test can be green because the code is right, or because the harness made the
question impossible to ask. Nothing distinguishes those two from the outside.

## The fix

The stub is now a real SHA-256, which is what "literal" meant all along:

```js
computeDigest: (_algorithm, value) => createHash('sha256').update(String(value)).digest(),
```

Apps Script returns signed bytes and Node unsigned ones. Nothing here does
arithmetic on the digest — it goes straight to base64, and `Buffer.from` wraps
either identically — so the difference is written down rather than simulated.

The existing test now also decodes each key and looks for the address in the
result, so it fails if the digest ever stops being one.

**All 2,951 tests passed before and after the stub changed**, which is the
evidence that nothing had come to depend on the identity behaviour.

## And the functions underneath, which had no tests at all

Five of the six were named nowhere in `tests/`. They are now covered, and the
first of them is the test that could not have been written honestly before:

- **`otpKey`** — an address cannot be read back out of the key it makes, the
  digest is 32 bytes, and the same address always makes the same key (it has
  to: the key is how a verify finds what a request stored).
- **`otpHash`** — salted with the address, so two people sent the same six
  digits do not store the same hash. Without it either code would verify
  against either address.
- **`otpNormalise`** — trim and lower case and nothing cleverer, pinned
  because `otpPersonFor`, the rate limiter and the cache key all compare
  through it: a change here silently changes who matches whom.
- **`otpMask`** — one letter and the domain for an address, four digits for a
  phone, whatever its length.
- **`cleanPersonId`** — its own comment says it "decides whose records a
  caller may reach". Path traversal, quotes, spaces, angle brackets and 65
  characters all become empty, and empty is the safe value because
  `ownRecordAllows` refuses it. The 64-character bound is pinned on both
  sides so it is a decision rather than a number somebody can nudge.

## Mutations

| Mutation | Caught by |
| --- | --- |
| `otpHash` drops the address salt | the salting test |
| `otpKey` stops hashing | the recovery test, and the strengthened original |
| **the identity stub restored** | the strengthened original |
| `cleanPersonId` accepts anything | 3 tests |
| the length bound moves 64 → 128 | 2 tests |

The third is the one that matters: the harness cannot quietly drift back to
proving less than it says.

## What this does not do

No product code changed — the diff is three test files. This buys regression
cover on the backend, which is where this repository says a bug is a security
bug, and it removes one place where a green suite meant less than it looked
like. It fixes no defect, because there was not one to fix.
