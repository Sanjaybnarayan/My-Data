# The Category Nobody Read

Phase 6, third tranche. `js/domain/ledger.js`, tested in `tests/ledger.test.mjs`
and in the browser suite.

## What I set out to measure, and what I found instead

The plan was the **family ledger**, the last open item in Phase 6's scope. The
substrate is there: `transaction.person` — the form calls it *"Spent by"* — is
on every record, and `fromRecords` copies it onto every ledger row.

It is read by nothing. Six of six rows carried it; no screen, ledger, insight or
summary groups by household member. That gap is real and is recorded at the
bottom of this file.

Measuring it turned up something larger underneath.

## The bug

`fromRecords` never passed `record.category` to the categoriser. Every ledger
screen re-derived the category from the payee text instead. Measured on five
transactions entered through the form:

```
  payee            they chose   the ledger said   kind
  Big Bazaar       groceries    p2p-out           person
  Landlord         rent         p2p-out           person
  Dr Anita Rao     health       p2p-out           person
  Truffles         dining       p2p-out           person
  Vidya Niketan    education    e-commerce        merchant

  hand-entered categories kept : 0 of 5
```

`looksLikePerson` accepts any one-to-four capitalised words with no company
suffix, so four of the five read as people. The consequences, all measured:

| | Reported | True |
| --- | --- | --- |
| Money out | ₹71,700 | ₹71,700 |
| **Counted as spending** | **₹9,200** | ₹71,700 |
| Counted as transfers to people | ₹62,500 | ₹0 |

**87% of the household's spending disappeared from the spending total**, and the
Insights screen said:

> *"3 people have taken more from this account than has come back."*

Naming a supermarket, a landlord and a doctor.

## Why the design was right and the application was wrong

`ledger.js` re-reads rather than stores, and the reasoning is sound and worth
keeping:

> *Naming a business, or correcting one counterparty, changes what every past
> transaction means. Re-reading applies a correction to the whole history at
> once.*

That is true **of a bank narration**. It is not true of a category a person
picked from a dropdown. A hand-entered row has no narration at all — the field
is `hidden: true` and only the importer writes it — so the only thing left to
re-read is the free-text payee, which is the weakest signal in the record, while
the strongest one sat unread beside it.

So the rule is narrow: **a row with no narration is the household's own word.**
Imported rows are re-derived exactly as before, and every retroactive-correction
property of that design is untouched.

## Two things deliberately not treated as a choice

**An imported row.** It has a narration. Re-reading it is the design.

**`other`.** That is the dropdown's default value, so it means nobody picked
anything. Honouring it would switch the categoriser off for every record where a
person left the field alone, which is most of them. A test asserts the heuristic
still runs in that case.

## Where a category maps to something coarser

`rent` and `maintenance` become `bills`. That is not a loss introduced here —
the importer's own `utility` rule already matches both words and files them the
same way. `gifts` and `donation` have no home and become uncategorised
*spending*, which keeps them in the right total even though the label is lost.

`business` is left unmapped on purpose: earning from a business and putting
capital into one are opposite movements, and guessing which would be worse than
keeping it uncategorised on the correct side. It falls back by direction.

## A judgement call: a record beats an override

An override is a blanket statement about a counterparty *name*, and its
documented contract is that it "wins over every rule". For a hand-entered row
that name is the same weak free-text payee this whole change exists to stop
trusting, so the choice made on the record itself — the narrower evidence —
wins.

The practical argument decided it. If the record loses, there is no way at all
to make one transaction differ from its counterparty's rule. If the override
loses, a household that disagrees edits the record, which is the natural way to
fix one record.

## What mutation testing found

Twelve mutations. Ten caught on the first pass, two survived.

| Mutation | Caught by |
| --- | --- |
| **The original bug, restored** | *is not thrown away and replaced by a guess* |
| **An imported row is overruled by its stored category** | *an imported row is still re-read from its narration* |
| **The dropdown default counts as a choice** | *the dropdown default is not a choice* |
| **`isP2P` is left as the heuristic set it** | *a shop is not a person merely because its name has two words* |
| **An unmapped expense is filed as income** | *a category with no mapping still lands in the right half* |
| **A chosen category also overrules a named business** | *a counterparty the household marked as their own business stays theirs* |
| **A shop stays labelled a person** | **survived** — now caught |
| **`dining` filed as `retail`** | **survived** — now caught |

The first survivor is a genuinely unreached branch: no screen reads
`counterpartyKind === 'person'`, because `peopleLedger` filters on `isP2P`. It
stays, because `tools/statement.mjs` dumps the field to CSV where somebody would
read the word "person" beside a supermarket — and it is now locked by a test
that asserts the field directly rather than through a ledger that happens not to
look.

The second was the whole **mapping table being unverified except three rows**. A
scrambled-but-valid table would have passed everything. Three checks now hold
it:

- every option on the transaction form has a destination, so adding one to the
  schema fails until somebody decides where it goes (it found `gifts` when
  tested by deletion);
- every destination is a category that exists;
- the ones a household would notice are pinned by hand, and income never lands
  on the spending side or the reverse.

## 905 tests passed with this broken

None of them looked. Every existing ledger test built its fixture the way the
**importer** does — with a narration — which is the path that always worked.

That is the third time this seam has produced a bug in this repository, after
the transfer-direction defect and the balance one. **A test suite whose fixtures
all come from one writer will never see what the other writer produces.** The
new tests build records the way the form does, and the browser check drives an
actual form, because the difference between the two shapes is the bug.

## Not done

- **The family ledger, which is what I set out to build.**
  `transaction.person` is recorded on every transaction and read by nothing.
  Measured: a household of three, ₹79,500 of spending in a month, every row
  tagged with who paid — and no screen, ledger or insight groups by member. The
  arithmetic is trivial; what is missing is that nobody has decided what the
  question is. *"Who paid for what"* and *"who owes whom"* are different
  reports, and the second needs a rule about what is shared and what is
  personal, which nothing here records.
- **An imported row whose category a person has since edited by hand** is still
  re-derived, because nothing distinguishes an edited category from an imported
  one. That needs a flag on the record, which is a schema change.
- **`looksLikePerson` is unchanged.** It is still a heuristic and still wrong
  about "Big Bazaar" in isolation; this change means a chosen category no longer
  lets it be wrong where it matters. Narrowing the heuristic itself would affect
  imported rows and is a separate question.
