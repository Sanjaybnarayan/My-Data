# A Record Stored And Never Listed

`js/services/evidence.js`, a Messages tab in `js/modules/finance.js`,
`docs/SMS_STORAGE.md`'s closing gap. Tested in `tests/services.test.mjs` and
the browser suite.

## What was wrong with keeping something nobody could see

The previous tranche began storing messages and ended with *"no screen listing
the kept messages"*. That is not a cosmetic gap. The argument for keeping a
message at all is that it is **evidence** — and evidence a household cannot
look at is just retained data, which is the thing rule 53 spends its whole
length being careful about.

`smsMessage` was already in the Finance module, so `#/finance/smsMessage`
rendered a table. Nothing linked to it. A route with no way to reach it is the
same problem wearing a URL.

## The tab, and what it refuses to offer

Messages sits beside Loans, and it is in `NO_ADD`: **there is no Add button.**
A message record comes from a message. Offering a blank form for one would
invite a household to type what a bank said, which is the opposite of evidence
— and a typed "message" would carry the SMS source priority while having none
of its provenance.

A browser check asserts the button is absent.

## The banner is not a list of messages

Above the table sit the two findings from `domain/evidence.js`, and neither is
a property of any row in it:

- **Paid, and not in the ledger.** A receipt and a bank alert agreeing about an
  amount and a day, with no imported statement row between them. The absence of
  a row is not something a table of messages can show.
- **Sources that disagree.** Counted, with the sentence that every figure is
  kept as recorded and nothing here decides which is right.
- **How much is corroborated**, said as a count and immediately qualified:
  *that is corroboration, not verification — none of these sources is a person
  having checked it.*

The orphan card says plainly that nothing has been added, and what a household
might do instead: import the statement these belong to, or add the payment by
hand if there is no statement for it. It offers no button that would do either
automatically.

## Decrypted deliberately, again

`EVIDENCE_LOAD` asks for `smsMessage` with `decrypt: true`. That is the trap
`docs/SEALED_VALUES.md` recorded one entity along: a message's text is sealed,
and a screen that names *which* message is meant needs at least the sender. It
is written out rather than left to the default, with a test asserting it, for
the same reason as there.

## What the browser found, twice

**The screen renders; my assertion was wrong.** The check asserted the sender
read `HDFCBK`. It reads **`pasted`** — because the Import screen is where the
message came from and it says so. Asserting the bank's short code was asserting
something the screen had never claimed, and it failed for four runs while I
looked for a rendering fault that did not exist.

The way out was a standalone probe that drove the real application through
enrolment and printed what was actually on the page, rather than another guess
at a wait. The screen had been correct the whole time:

```
Messages
FROM     RECEIVED       CATEGORY      AMOUNT
pasted   15 Aug 2026    UPI_PAYMENT   ₹50,000.00
```

**And navigating away broke the next block.** Leaving the page on Messages made
the following check time out waiting for the Import screen's file input. The
suite is one long session on one page, and a check that moves is a check that
has to move back.

## What is still not built

`explainability()` from `docs/EXPLAINABILITY.md` is the last headless engine in
this stack. A message's own record screen shows its fields but not the
`evidenceFor` chain — the per-row answer exists in `EvidenceService` and reaches
no screen yet.
