# Mail That Never Arrived

`js/sync/gmail.js`, `js/modules/receipts.js`, `apps-script/Gmail.gs`,
`js/locale/en.js`, `tests/inbox.test.mjs`.

## The rule this breaks

v6.0: **never silently ignore sync, AI-extraction or reconciliation errors**,
and **never silently lose data**.

## What was found

`GmailClient.mail` lists message ids, then fetches each message through a small
concurrency pool. The pool's comment was right about what it should do:

> A failure on one message yields null rather than losing the other hundred and
> ninety-nine.

Continuing past a failure is correct. **Forgetting it happened is not.**

```js
try {
  out[index] = await work(items[index]);
} catch {
  out[index] = null;          // and nothing else
}
```

```js
return {
  messages: messages.filter(Boolean),   // the nulls disappear here
  query,
  truncated: ids.length >= limit,
};
```

Gmail returning 429 for thirty of a hundred listed messages produced **seventy
messages and no indication that thirty were missing.** `truncated` reports that
the *list* was capped, which is a different fact, and was the only one the
caller could see.

Downstream, `js/modules/receipts.js` accumulates `run.searched += scan.searched`
— a count of what *arrived* — and the screen says:

```
143 read · 12 receipts · 3 new
```

A receipt Gmail refused to hand over is then indistinguishable from a receipt
that does not exist. **This is the third instance of one shape this session: an
absence asserted from a read error** — after `Assistant.load` swallowing a
decryption failure and reporting "no transactions are recorded", and
`unreadableAmounts` for figures this device cannot parse.

Rate limiting is not a hypothetical here. The pool exists *because* Gmail rate
limits, and its own comment says so: *"all at once trips Gmail's rate limit"*.
The failure it was built to survive is the failure it was not counting.

## The other route was already honest

`AppsScriptTransport.mail` proxies `apps-script/Gmail.gs`, whose loop has **no
per-message catch at all** — a Gmail failure throws out of the whole call and
the client sees an error. Nothing can be lost quietly there.

So the two routes, documented as returning "the same shape", behaved
differently on a partial failure: one loud, one silent. `Gmail.gs` now returns
`unreachable: 0` explicitly, so the client reads one field for both routes
rather than guessing which it is talking to — and zero there is a statement,
not a default.

## What changed

`#pool` counts what it could not fetch and returns `{ out, unreachable }`.
`mail()` passes the count out beside `messages`. `receipts.js` accumulates it
per mailbox, shows it in the per-mailbox line, and puts it **above** the
counts in the scan summary:

> Gmail listed 30 messages it would not hand over, so they were not read. The
> counts above are what came back, not what the mailbox holds. Scanning again
> usually reaches them — a refusal is normally a rate limit.

First and not last, because every figure above it is about what arrived.

`truncated` was deliberately left alone. Folding the loss into it would say
*"there is more mail"*, which is a different and wrong sentence — the list was
not capped; the messages were refused.

## How it is checked

`tests/inbox.test.mjs`, two cases, mutation-tested three ways:

```
M1  never count (the original)              FAIL  a message Gmail will not hand over is counted
M2  count every message, failed or not      FAIL  a message Gmail will not hand over is counted
                                            FAIL  a scan that loses nothing says so
M3  report the loss through `truncated`     FAIL  a message Gmail will not hand over is counted
```

M2 is the reason for the second test. A counter stuck above zero satisfies the
first case and warns on every clean scan, so the clean scan is asserted too.
M3 is the reason the first test asserts `truncated === false` — the tempting
shortcut is caught rather than left to review.

## Along the way

The scan summary's three explanatory paragraphs were inline English. They now
go through `js/locale/en.js` with the new one, which lowered the unrouted-string
ratchet from **3490 to 3482** and paid for the lines the change needed —
`js/modules/receipts.js` is at its 1007-line ceiling and may not grow.

Typing the Gmail test's fixture options removed three type findings — the
defaults `refuse = () => false` and `onCall = () => {}` infer as a function
returning the *literal* false and one taking no arguments — so the typecheck
budget tightens from **158 to 157**.

## What this does not establish

**No message is known to have been lost on a household's device.** No scan has
been observed hitting a rate limit in practice. The fault is that if one did,
the application reported a smaller mailbox rather than a failed read. This makes
the failure visible; it does not make it rarer.

**The count is of listed ids that could not be fetched.** A message Gmail never
listed — because the search missed it, or the window did not cover it — is
outside this and always was; `truncated` and the pass-walking loop are what
speak to that.
