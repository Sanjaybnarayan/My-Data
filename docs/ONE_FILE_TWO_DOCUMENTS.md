# The Obvious Way To Split A File Is Wrong

`docs/DOCUMENT_FORMATS.md` carried an item: **one file, two documents.**
`Invoice__RTO.pdf` is a dealer's GST tax invoice on page 1 and a Karnataka RTO
tax receipt on page 2 — different issuers, different numbers, different dates
and different totals — and `readDocument` returns one amount. Under rule 57
both are economic events and at most one of them would ever be recorded.

This tranche measured the obvious implementation and **did not build it.**

## What the measurement says

The obvious signal is the document kind, page by page: where the pages of a
file disagree about what they are, the file is more than one document. Run
across all twenty-two real documents:

| File | Kinds, page by page | Really |
| --- | --- | --- |
| Invoice + RTO receipt | `bill, receipt` | **two documents** |
| House agreement | `agreement, agreement, bill, unknown` | one agreement |
| Rent agreement | `agreement, agreement, agreement, receipt, bill` | one agreement |
| Tata AIG motor policy | `policy, unknown, unknown, policy, …` | one policy |

**Three false splits for one true one.** A lease says "payable" on the page
that sets the rent, and a rental agreement says "received" on the page about
the deposit; a thirteen-page policy schedule says `policy` on the pages with a
header and nothing on the pages of terms. None of those is a second document,
and splitting them would produce a phantom bill with a due date — the failure
`domain/extract.js` exists to prevent, arriving through the mechanism meant to
improve it.

So per-page kind is not merely imperfect here. It is **worse than the silence
it replaces**, because a missing second document is a gap and a phantom one is
a claim.

## What would work, and why it is not built either

The true signal on the one genuine case is not the kind. It is that page 2
carries its **own issuer, its own document number and its own total**, none of
which match page 1's — a receipt from the Transport Department beside an
invoice from a dealer.

That is a real rule and it is not written, for a reason worth stating: there is
**one** genuinely two-document file in the corpus. A general mechanism
generalised from a single example, in a place where the naive version fails
three times out of four, is not something to ship on the strength of one
observation. It needs more than one example to be built against, and the
household's own documents are where those would come from.

The item stays open, and it stays open *with a reason* rather than as a
to-do nobody remembers refusing.

## What was built: a `certificate` kind

The blood donation certificate read `unknown`. It now reads `certificate`.

The rule pairs `certificate` with `presented to` rather than matching what a
certificate is nominally about, and the reason is measured. The OCR of that
file gives:

```
Certificate of Apyreciation
Presented to
for ddnating blood voluntarily
```

`Appreciation` came out `Apyreciation` and `donating` came out `ddnating`. A
rule matching *appreciation* or *donating blood* matches nothing — verified,
zero hits including on the certificate itself. It would have to be written
against those specific typos, which is fitting to one file rather than reading.

`certificate` and `presented to` both survived. Across twenty-two documents
that pair matches exactly one file: the certificate. Nothing else.

There is **no reader and no category mapping**. `Mr / Mer B.` / `Soniet` is
what the OCR made of the recipient's name, and extracting a person from that
would be inventing one. Naming the kind is the whole of what this delivers,
and it is a small thing.

## Mutation testing found a false claim in my own comment

Nine mutations, eight caught. The ninth moved the `certificate` rule **above**
`vehicle` — and every test still passed.

My comment had said the ordering was "the whole of it": that a registration
certificate stays a vehicle document *because* `vehicle` is matched first.
That is not true. The two rules are **disjoint** — a certificate that registers
something never says `presented to` — so the ordering does nothing at all with
the rule as written. It matters only if the rule is later loosened, which the
second mutation confirms.

The comment now says that, and the ordering is described as belt and braces
rather than as the mechanism. A comment asserting a mechanism that is not
operating is the same defect as a test that cannot fail: the next reader
believes it.
