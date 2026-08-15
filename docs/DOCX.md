# Word documents, and what a receipt may assert

Phase 3's last item. The prompt asks for *DOCX templates*; the format turned out
to be the easy half.

## Fifty lines, and no dependency

A `.docx` is a ZIP of XML parts, exactly as an `.xlsx` is — and
`reports/xlsx.js` already exported a store-only ZIP writer for that reason. So
`reports/docx.js` is four small XML parts handed to `zip`, with no dependency
added to a repository that has three and no build step.

It writes a deliberately small subset: headings, paragraphs, bold runs, a
two-column table, and blank space to sign in. That is what a household document
*is*. Anything richer would be a word processor; this is a form filler.

Two details that are not cosmetic, both pinned by tests:

- **`[Content_Types].xml` goes first.** Word looks for it at the start rather
  than through the central directory.
- **`xml:space="preserve"` on every run.** Without it Word drops leading and
  trailing spaces, and a label runs into its value.

And the escaping is the whole risk. A tenant called *Ram & Co.* produces XML
Word refuses to open — not a mangled document, a **corrupt** one. Same class of
bug the iCalendar writer had, guarded the same way: escape once, at the
boundary, and test the characters that break it.

## The harder half: which direction a receipt may be issued in

A household is a landlord in `property` — `rented`, `monthlyRent`, `tenantName`
— and a tenant in `recurringPayment` with `kind: 'rent'`. Both are recorded, and
**only one of them may be issued from here.**

A receipt is a statement by *the person who received the money*. Generating one
for rent the household **paid** would mean writing, in their landlord's voice,
that the landlord received it — a document asserting somebody else's
acknowledgement, produced by the party who benefits from the claim. Tenants need
those for HRA and often cannot get them, and that pressure is exactly what makes
writing one dangerous rather than helpful.

So receipts are issued for rent **received**, where the household is the one
making the statement and signing it.

## What it will not fill in

| Not filled in | Why |
| --- | --- |
| A payment with no record | `monthlyRent` is what the rent *is*, not evidence any arrived. A month with no matching credit produces **no document** and is listed as unreceipted |
| A part payment as full rent | ₹20,000 against a ₹35,000 lease is somebody's decision to describe, not this one's to guess at |
| The first of the month | The receipt carries the day the money **arrived**. A date nothing happened on is a small lie a tax officer is entitled to notice |
| A landlord's PAN | Above ₹1,00,000 a tenant needs one. This **reports** that the year crosses the line; the number belongs to the person signing, and printing one automatically is how the wrong one ends up on a document |
| A signature | The document leaves room. The household signs it because it is true |

The year's total is counted from what was **received**, not twelve times the
rent — a household whose tenant missed two months does not owe receipts for
them, and a total including them would overstate their rental income on a
document they sign.

## What the mutation testing caught

**11 of 11**, and the list is worth reading as a statement of what this refuses:
a part payment receipted as full rent, money paid *out* receipted as rent
received, a receipt dated the first of the month, a document for a month nobody
paid, a year counting unpaid months, the PAN threshold never reported, and a
property not rented out issuing receipts. Each is a document somebody would have
signed.

## A ratchet firing in its useful direction

`property.rented`, `property.monthlyRent` and `property.tenantName` were on the
unread-fields inventory and are read now, so the suite failed until they came
off it — the half of that check that catches a list going stale rather than one
growing. 86 → 83.

## Still not done

- **Nothing reads a `.docx`.** This writes them. Reading one means unzipping and
  parsing WordprocessingML, which is a larger job than writing a fixed subset,
  and no document intelligence path needs it yet.
- **No other template.** An authorisation letter, a nomination form and a
  declaration are the obvious next three, and each needs the same question asked
  first: who is making the statement, and are they the one signing it?
- **Nothing files the receipt back against the transaction it describes.** The
  same gap the receipt *reader* has, from the other end.
