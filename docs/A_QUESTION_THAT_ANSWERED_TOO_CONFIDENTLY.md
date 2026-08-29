# A question that answered too confidently

*Ask FamilyOS "what is expiring soon?" and it would tell you nothing was — while
a warranty ran out, a tenancy ended and a vaccination fell due.*

## The nine and the nineteen

The `expiring` intent read nine entities:

```js
for (const name of ['policy', 'vehicle', 'document', 'identityDocument',
  'subscription', 'digitalAsset', 'holding', 'property', 'certificate']) {
```

The schema declares **nineteen** with an `expiry` field, and `expiryReminders`
already reads every one of them — it iterates the schema rather than a list.
The ten the handler never named were invisible to it:

`appointment` · `education` · `healthRecord` · `medication` · `recurringPayment`
· `task` · `tenant` · `vaccination` · `vehicleService` · `warranty`

## What made it worse than incomplete

The handler does not say "some of these I cannot see". With nothing in its nine,
it returns:

> Nothing is due to expire in the next year.

A flat, confident negative, covering ten kinds of record it never looked at. A
household trusting that answer would miss a medication course finishing, a
service falling due, a tenancy ending on a date they had recorded specifically
so they would not have to remember it.

That is the same shape as *an absence asserted from a read error*, which this
repository has now found seven times — except here the absence is asserted from
a read that was never attempted.

## The list already existed

`datedEntities()` derives exactly this from the schema. The dashboard already
uses it, and its own comment records why:

> `medication` became dated when a course running out started producing a
> reminder, so it is derived now and naming it here as well is how the two
> lists would begin to disagree.

So the fix is one line: the assistant calls the function the dashboard already
calls. It was the caller that never followed when the list became derivable.

A hand-maintained list beside a derivable one, for the tenth time in this
repository.

## Checked, in a way that cannot go stale

Two tests, both failing against the old handler:

- an expiring warranty is named in the answer;
- the handler reads **every** entity `datedEntities()` returns, asserted by
  recording which repositories the answer actually touched.

The second is derived rather than counted, so a twentieth dated entity is
covered the day somebody adds one — which is the entire point of not typing the
list.

## What was not done, and why

**No language model.** `ai/assistant.js` is offline on purpose: a household's
medical and financial records are not sent anywhere to answer "when does the
insurance expire". Adding a model reverses that, and it is a decision for the
household rather than a gap to be closed quietly.

**`ai/mcp.js` still has no caller**, and the architecture document now says so
in a form that fails the build if anybody wires it. It had read
*"AI governance — partial, one outbound gate"* behind a probe that only checked
the export existed, and a gate nothing passes through governs nothing. The file
itself was always honest — it says outright that it is a surface, not a server,
and that wiring it is a deployment decision. The row describing it was the part
that overstated.

## A note on writing docs in this repository

Three times while making these changes, prose tripped a checker written to
catch the real thing: a comment quoting the broker hostnames it promised never
to use, a scorecard cell containing a backticked probe prefix, and an
architecture row citing a term it was describing.

Each time the checker was right and the prose was wrong. A tool that scans
source text cannot tell an example from an instance, and it should not try —
the alternative is a checker that a sufficiently chatty comment can talk its
way past.
