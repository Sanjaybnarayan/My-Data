/**
 * Which rules might apply to this application, and what it actually does
 * about each — Phase 20's applicability review, done as step 12 of the build
 * prompt's own execution strategy rather than left to the end.
 *
 * ## The rule this file exists to obey
 *
 * > **DO NOT claim regulatory compliance without implementation, testing,
 * > evidence and applicability review.**
 *
 * and, in the compliance section itself, *"Never claim compliance
 * automatically."* So this is deliberately **not** a compliance claim. It is an
 * inventory of what a rule would want, what the code does, and what it does
 * not — with every "implemented" pointing at a file and every "tested"
 * pointing at a suite, so a status cannot outrun the thing it describes.
 *
 * ## Nothing here is VERIFIED, and that is not an oversight
 *
 * The prompt's status list ends `VERIFIED` and `LEGAL_REVIEW_REQUIRED`.
 * Verification means somebody qualified checked the control against the
 * obligation and signed their name to it. Nobody has. `tools/compliance.mjs`
 * refuses a `VERIFIED` row for that reason, so the day one appears it has to
 * be a deliberate act with a name attached.
 *
 * This file is written by a programmer reading a schema, not by a lawyer
 * reading a statute. Every regime here carries `LEGAL_REVIEW_REQUIRED` at the
 * top level, and the documents in `docs/COMPLIANCE/` say so in the first
 * paragraph rather than the last.
 *
 * ## What "applies" means here
 *
 * The application is an offline-first record keeper that a household runs for
 * itself. It is not a data fiduciary processing other people's data, not a
 * regulated entity, and it files nothing with anybody. That changes the
 * analysis for most of this list, and where it does, the regime says so
 * instead of being padded out with controls nobody owes.
 */

/** The prompt's statuses, in the order it gives them. */
export const STATUS = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  DESIGNED: 'DESIGNED',
  IMPLEMENTED: 'IMPLEMENTED',
  TESTED: 'TESTED',
  VERIFIED: 'VERIFIED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  LEGAL_REVIEW_REQUIRED: 'LEGAL_REVIEW_REQUIRED',
});

/** Whether a regime bears on this application at all. */
export const APPLIES = Object.freeze({
  /** Directly, on the household's own records. */
  DIRECTLY: 'directly',
  /** Only if the household chooses to do something it can do here. */
  CONDITIONALLY: 'conditionally',
  /** Not to this application. The reason is always given. */
  NOT_TO_THIS: 'not to this application',
  /** A programmer cannot tell. Said plainly rather than guessed. */
  UNCERTAIN: 'uncertain',
});

/**
 * Statuses that assert something about the code and must cite it.
 * @type {readonly string[]}
 */
export const EVIDENCED = Object.freeze([
  STATUS.IMPLEMENTED, STATUS.TESTED, STATUS.VERIFIED,
]);

const control = (id, requirement, status, evidence = {}, gap = null) =>
  ({ id, requirement, status, evidence, gap });

/**
 * The twenty regimes the prompt names a document for.
 *
 * `applies` is about the regime; each control's `status` is about this code.
 * A regime can apply directly and still have every control `NOT_STARTED` —
 * that is the honest shape of an application that has not done the work, and
 * flattening the two into one word is how "compliance" becomes a claim.
 */
export const REGIMES = Object.freeze([
  {
    id: 'DPDP',
    name: 'Digital Personal Data Protection Act, 2023',
    doc: 'DPDP.md',
    applies: APPLIES.CONDITIONALLY,
    why: 'A household keeping its own records is not a Data Fiduciary. The Act '
      + 'bears on this application the moment records about somebody else are '
      + 'kept here — household staff most clearly, and any adult member who has '
      + 'not agreed to be in it.',
    controls: [
      control('consent-recorded', 'Consent taken, recorded and withdrawable',
        STATUS.TESTED, { file: 'js/data/consent.js', test: 'tests/consent.test.mjs' }),
      control('purpose-limitation', 'Data used only for the purpose it was given for',
        STATUS.DESIGNED, { doc: 'docs/DATA_CONSENT.md' },
        'Purposes are recorded and shown; nothing enforces them at the point of use.'),
      control('retention-limits', 'Kept no longer than the purpose needs',
        STATUS.TESTED, { file: 'js/data/retention.js', test: 'tests/retention.test.mjs' }),
      control('erasure', 'Erasure on request, propagated to copies',
        STATUS.IMPLEMENTED, { file: 'js/data/retention.js' },
        'Local and Drive copies are removed; the household Sheet is a backup '
        + 'this application does not prune on erasure.'),
      control('breach-notice', 'Notify the Board and affected people of a breach',
        STATUS.DESIGNED,
        { file: 'js/domain/breach.js', test: 'tests/breach.test.mjs' },
        // DESIGNED, and deliberately not higher. The control asks for two
        // things and only one of them is software's job.
        //
        // **Detection is not built and will not be.** No application can tell
        // that a copy of a household's records was taken — a stolen phone, a
        // shared Drive link, a photograph of a screen produce no event here.
        // What exists reports *indicators* that already existed, each saying
        // what it does not mean, and says in as many words that finding none
        // is not evidence that nothing happened.
        //
        // **Notifying the Board is refused outright**, on the screen and in
        // the module: a filing generated from a household's guess would be
        // worse than none.
        //
        // What is genuinely done is the affected-people half — who would have
        // to be told, which this application knows because it holds the
        // records, and which now includes people whose data is not the
        // household's own.
        'Not detection, and it does not claim to be. Indicators that already '
        + 'existed — an audit log that does not add up, a signed-out device '
        + 'that synced since, a burst of exports, a run of refusals — are '
        + 'gathered with what each does *not* mean. Who would have to be told '
        + 'is answered, including staff and children. Detecting a breach and '
        + 'notifying a regulator are both absent, and both say so.'),
      control('children', 'Verifiable parental consent for a child under 18',
        STATUS.IMPLEMENTED,
        { file: 'js/data/consent.js', test: 'tests/consent.test.mjs' },
        // IMPLEMENTED, not TESTED, and deliberately not more. There is now a
        // purpose, a record naming which adult decided and when, and a screen
        // that raises the question — which is more than nothing and less than
        // the control asks for. **Verifiable** is the word doing the work:
        // nothing here verifies that the person recording the decision is the
        // child's parent or guardian, and this application has no way to.
        'An adult can now record a decision about a child\'s records, and the '
        + 'gap is surfaced until they do. Nothing *verifies* the adult is the '
        + 'parent or guardian — the application has no means to — so this is '
        + 'a recorded decision, not verifiable parental consent. It gates '
        + 'nothing: records are kept either way.'),
    ],
  },
  {
    id: 'IT_ACT',
    name: 'Information Technology Act, 2000 and the SPDI Rules, 2011',
    doc: 'IT_ACT.md',
    applies: APPLIES.CONDITIONALLY,
    why: 'The SPDI Rules bind a body corporate handling sensitive personal data. '
      + 'A household is not one. The security practices they describe are still '
      + 'the closest thing to a named standard this application can be measured '
      + 'against, so it is measured against them.',
    controls: [
      control('reasonable-security', 'Reasonable security practices for sensitive data',
        STATUS.TESTED, { file: 'js/security/crypto.js', test: 'tests/security.test.mjs' }),
      control('sensitive-categories', 'Passwords, financial and health data treated as sensitive',
        STATUS.TESTED, { file: 'js/data/classification.js', test: 'tests/classification.test.mjs' }),
      control('access-control', 'Access limited to those who need it',
        STATUS.TESTED, { file: 'js/security/rbac.js', test: 'tests/security.test.mjs' }),
      control('policy-published', 'A published privacy policy',
        STATUS.NOT_APPLICABLE, {},
        'Nothing is collected from anybody outside the household.'),
    ],
  },
  {
    id: 'CERT_IN',
    name: 'CERT-In Directions, 2022',
    doc: 'CERT_IN.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'The Directions bind service providers, intermediaries, data centres and '
      + 'body corporates. This application is none of those: it runs on the '
      + "household's own devices and in the household's own Google account, and "
      + 'operates no service for anybody.',
    controls: [
      control('log-retention', 'Retain logs for 180 days in Indian jurisdiction',
        STATUS.NOT_APPLICABLE, {},
        'No service is operated. The audit trail is local and the household '
        + 'controls how long it keeps it.'),
      control('incident-reporting', 'Report incidents within six hours',
        STATUS.NOT_APPLICABLE, {},
        'No service, and no operator to report.'),
      control('clock-sync', 'Synchronise to NTP',
        STATUS.NOT_APPLICABLE, {}, "The device's own clock is used."),
    ],
  },
  {
    id: 'UIDAI',
    name: 'Aadhaar Act and UIDAI regulations',
    doc: 'UIDAI.md',
    applies: APPLIES.DIRECTLY,
    why: 'Aadhaar numbers get typed into a family record keeper whether or not it '
      + 'asks for them, and the rules on storing and displaying them bind '
      + 'whoever holds one.',
    controls: [
      // TESTED rather than IMPLEMENTED because the absence is now checked
      // rather than asserted: `tests/refusals.test.mjs` reads everything that
      // ships and fails on a UIDAI host, an auth or e-KYC call, or any URL
      // addressed to the authority. The words `Aadhaar` and `KYC` are all
      // over this application and should be — a number is stored and an
      // institution's copy is modelled. What must not exist is a *call*.
      control('no-authentication', 'No Aadhaar authentication or e-KYC performed',
        STATUS.TESTED, { file: 'js/domain/kyc.js', test: 'tests/refusals.test.mjs' },
        null),
      control('masked-display', 'Aadhaar shown masked by default',
        STATUS.TESTED, { file: 'js/data/classification.js', test: 'tests/classification.test.mjs' }),
      control('not-indexed', 'Aadhaar not written into searchable plaintext',
        STATUS.TESTED, { file: 'js/domain/identifiers.js', test: 'tests/identifiers.test.mjs' }),
      control('encrypted-at-rest', 'Stored encrypted',
        STATUS.TESTED, { file: 'js/security/fieldcrypto.js', test: 'tests/security.test.mjs' }),
      control('not-a-primary-key', 'Aadhaar never used as the identifier for a person',
        STATUS.TESTED, { file: 'js/data/schema.js', test: 'tests/kyc.test.mjs' }),
    ],
  },
  {
    id: 'CKYC_2_0',
    name: 'CKYCRR and the CKYC 2.0 framework',
    doc: 'CKYC_2_0.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'The registry framework binds reporting entities — banks, insurers, '
      + 'intermediaries. A household is not one and cannot file with the '
      + 'registry. What is kept here is a note of what each institution says '
      + 'it holds.',
    controls: [
      control('no-registry-claim', 'Never present local notes as registry data',
        STATUS.TESTED, { file: 'js/modules/identity.js', test: 'tests/kyc.test.mjs' }),
      control('no-fabricated-integration', 'No CKYCRR connector, real or simulated',
        STATUS.TESTED, { file: 'docs/KYC.md', test: 'tests/architecture.test.mjs' }),
      control('kin-format', 'A KIN is validated in shape only, never verified',
        STATUS.TESTED, { file: 'js/domain/kyc.js', test: 'tests/kyc.test.mjs' }),
    ],
  },
  {
    id: 'RBI',
    name: 'RBI directions on customer data and Account Aggregators',
    doc: 'RBI.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'These bind regulated entities and licensed Account Aggregators. This '
      + 'application reads statements the household already has and holds no '
      + 'licence of any kind.',
    controls: [
      control('no-aa-integration', 'No Account Aggregator connector, real or simulated',
        STATUS.TESTED, { file: 'docs/FAMILY_OS_MASTER_ARCHITECTURE.md', test: 'tests/architecture.test.mjs' }),
      control('no-credential-storage', "No bank login is stored or used",
        STATUS.TESTED, { file: 'docs/STATUS.md', test: 'tests/architecture.test.mjs' }),
      control('card-data', 'Card numbers masked and never stored in the clear',
        STATUS.TESTED, { file: 'js/domain/identifiers.js', test: 'tests/identifiers.test.mjs' }),
    ],
  },
  {
    id: 'PMLA',
    name: 'Prevention of Money Laundering Act and Rules',
    doc: 'PMLA.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'Record-keeping and reporting obligations fall on reporting entities. A '
      + 'household keeping its own statements is not one, and has nothing to '
      + 'file.',
    controls: [
      control('no-str', 'No suspicious transaction reporting is performed or implied',
        STATUS.NOT_APPLICABLE, {}),
      control('no-risk-scoring', 'No customer risk categorisation exists',
        STATUS.NOT_APPLICABLE, {},
        'The unusual-spending finder is a household-facing note, not a risk score.'),
    ],
  },
  {
    id: 'ABDM',
    name: 'Ayushman Bharat Digital Mission',
    doc: 'ABDM.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'ABDM binds participating health information providers and users. This '
      + 'application holds health notes a household typed for itself and joins '
      + 'no network.',
    controls: [
      control('no-abha', 'No ABHA linkage, real or simulated',
        STATUS.TESTED, { file: 'docs/PROJECT_AUDIT.md', test: 'tests/architecture.test.mjs' }),
      control('health-encrypted', 'Diagnoses and conditions encrypted at rest',
        STATUS.TESTED, { file: 'js/data/schema.js', test: 'tests/security.test.mjs' }),
      control('health-access', 'Health records not readable by every role',
        STATUS.TESTED, { file: 'js/security/rbac.js', test: 'tests/security.test.mjs' }),
    ],
  },
  {
    id: 'SEBI',
    name: 'SEBI regulations on investment records and advice',
    doc: 'SEBI.md',
    applies: APPLIES.CONDITIONALLY,
    why: 'Holding a record of your own investments is unregulated. Offering '
      + 'advice is not, and an application that computes returns is one design '
      + 'decision away from appearing to give it.',
    controls: [
      control('no-advice', 'Nothing recommends buying, selling or holding',
        STATUS.TESTED, { file: 'js/domain/portfolio.js', test: 'tests/architecture.test.mjs' }),
      control('no-broker-integration', 'No broker connector, real or simulated',
        STATUS.TESTED, { file: 'docs/MCP.md', test: 'tests/architecture.test.mjs' }),
      control('returns-explainable', 'Every computed return shows its inputs',
        STATUS.TESTED, { file: 'js/domain/costbasis.js', test: 'tests/costbasis.test.mjs' }),
    ],
  },
  {
    id: 'TAX',
    name: 'Income Tax Act and GST, as they touch record keeping',
    doc: 'TAX.md',
    applies: APPLIES.CONDITIONALLY,
    why: 'Records kept here may end up supporting a return. That makes their '
      + 'accuracy and retention a real concern, and makes any figure the '
      + 'application computes something a person might file.',
    controls: [
      control('source-preserved', 'The original document is never overwritten',
        STATUS.TESTED, { file: 'js/services/documents.js', test: 'tests/provenance.test.mjs' }),
      control('financial-year', 'Indian financial year boundaries used, not calendar',
        STATUS.TESTED, { file: 'js/core/dates.js', test: 'tests/core.test.mjs' }),
      control('no-tax-computation', 'No tax liability is computed or implied',
        STATUS.IMPLEMENTED, { file: 'docs/STATUS.md' },
        'Tax certificates are read and filed; nothing computes what is owed.'),
      control('retention-8y', 'Records retained long enough for assessment and reopening',
        STATUS.DESIGNED, { file: 'js/data/retention.js' },
        'Retention periods are configurable but no default is set from tax law.'),
    ],
  },
  {
    id: 'MOTOR_VEHICLES',
    name: 'Motor Vehicles Act, as it touches vehicle records',
    doc: 'MOTOR_VEHICLES.md',
    applies: APPLIES.CONDITIONALLY,
    why: 'A household records registration, insurance and fitness dates. The '
      + 'obligations are on the owner; the application affects whether they are '
      + 'reminded in time.',
    controls: [
      control('expiry-reminders', 'Insurance, PUC and fitness expiry surfaced before the date',
        STATUS.TESTED, { file: 'js/domain/reminders.js', test: 'tests/domain.test.mjs' }),
      control('chassis-encrypted', 'Chassis and engine numbers encrypted, not indexed',
        STATUS.TESTED, { file: 'js/domain/extract.js', test: 'tests/extract.test.mjs' }),
      control('no-rto-integration', 'No RTO or VAHAN connector, real or simulated',
        STATUS.TESTED, { file: 'docs/AGREEMENTS_AND_VEHICLES.md', test: 'tests/architecture.test.mjs' }),
    ],
  },
  {
    id: 'PROPERTY',
    name: 'Property and tenancy law, as it touches records',
    doc: 'PROPERTY.md',
    applies: APPLIES.CONDITIONALLY,
    why: 'Rent receipts generated here may be relied on by a tenant and by a tax '
      + 'assessor. A document this application produces is a document somebody '
      + 'may act on.',
    controls: [
      control('receipt-provenance', 'A generated receipt records what produced it',
        STATUS.TESTED, { file: 'js/domain/rentreceipt.js', test: 'tests/docx.test.mjs' }),
      // Checked across everything that ships, not only the generator: a claim
      // of legal effect made on a screen *about* a document is the same
      // claim, and confining the check to js/reports would let the sentence
      // move one file to the left and survive.
      control('no-legal-effect-claim', 'No generated document claims legal effect',
        STATUS.TESTED,
        { doc: 'docs/GENERATED_DOCUMENTS.md', test: 'tests/refusals.test.mjs' }),
      control('receipt-from-payment', 'A receipt is issued only for money that arrived',
        STATUS.TESTED, { file: 'js/domain/rentreceipt.js', test: 'tests/docx.test.mjs' }),
      control('one-letting-or-none', 'A payment is attributed to one letting or to none',
        STATUS.TESTED, { file: 'js/domain/rentreceipt.js', test: 'tests/docx.test.mjs' }),
      control('tenant-records', 'A tenant record with its own ledger',
        STATUS.IMPLEMENTED,
        { file: 'js/data/schema.js', test: 'tests/phase10.test.mjs' },
        // Was NOT_STARTED with "no tenant entity, no lease history", both of
        // which Phase 10 built and neither of which anybody came back to
        // correct. What is still missing is the *ledger* half, and that is
        // now what this says.
        'The `tenant` entity carries the letting, its dates, rent and deposit. '
        + 'There is still no per-tenant ledger and no arrears figure — rent '
        + 'received is attributed by `js/domain/rentreceipt.js`, not totalled '
        + 'against what was due.'),
    ],
  },
  {
    id: 'STAFF',
    name: 'Household staff: wages, hours and record keeping',
    doc: 'STAFF.md',
    applies: APPLIES.DIRECTLY,
    why: 'This is where the household holds records about somebody who is not a '
      + 'member of it, and employs them besides. Both the data-protection and '
      + 'the employment questions are live.',
    controls: [
      control('pay-vs-agreement', 'What was agreed is never conflated with what was paid',
        STATUS.TESTED, { file: 'js/domain/staffpay.js', test: 'tests/household.test.mjs' }),
      control('leave-recorded', 'Paid and unpaid leave distinguished',
        STATUS.TESTED, { file: 'js/data/schema.js', test: 'tests/household.test.mjs' }),
      control('staff-consent', "A staff member's consent to being recorded",
        STATUS.IMPLEMENTED,
        { file: 'js/data/consent.js', test: 'tests/consent.test.mjs' },
        // The engine is wired now and the question is raised. What is still
        // missing is the other half: the staff member has no way to see this
        // themselves, so the record says the household asked, on the
        // household's word alone. See `staff-access`.
        'Adding someone who works for the household now raises the question, '
        + 'and an unanswered one is reported as happening without a record. '
        + 'The person themselves still has no way to see or dispute it — that '
        + 'is `staff-access`, and it is not built. It gates nothing.'),
      control('staff-access', 'A staff member seeing what is held about them',
        STATUS.IMPLEMENTED,
        { file: 'js/security/rbac.js', test: 'tests/security.test.mjs' },
        // IMPLEMENTED and not TESTED, because the control asks for an access
        // *path* and what exists is a supervised view. The role is real and
        // isolates properly — a staff actor reaches their employment record
        // and nothing else, proved against the household's own records. What
        // does not exist is any way for the person to reach it themselves.
        'There is a `staff` role that sees the employment record about them '
        + 'and nothing else, and a screen the household opens to show them. '
        + 'It is **not** a login: this application has no per-person '
        + 'credential, so the person cannot see it on their own and a role '
        + 'switch would be reversible by whoever it was meant to restrict. '
        + 'Their leave is held and not shown — a leave row names the job, not '
        + 'the person, and the rule needs the subject on the row.'),
    ],
  },
  {
    id: 'ELECTRONIC_RECORDS',
    name: 'Electronic records: retention, integrity and admissibility',
    doc: 'ELECTRONIC_RECORDS.md',
    applies: APPLIES.DIRECTLY,
    why: 'Everything here is an electronic record, and some of it may one day be '
      + 'produced as evidence of what was held and when.',
    controls: [
      control('audit-trail', 'Every change recorded with who, when and what',
        STATUS.TESTED, { file: 'js/data/audit.js', test: 'tests/data.test.mjs' }),
      control('provenance', 'Where each value came from is kept with it',
        STATUS.TESTED, { file: 'js/data/provenance.js', test: 'tests/provenance.test.mjs' }),
      control('original-preserved', 'The source file is kept unmodified',
        STATUS.TESTED, { file: 'js/services/documents.js', test: 'tests/provenance.test.mjs' }),
      control('tamper-evidence', 'A record that has been altered can be shown to have been',
        STATUS.TESTED,
        { file: 'js/data/chain.js', test: 'tests/chain.test.mjs' },
        // TESTED, not VERIFIED, and the gap is stated rather than left for
        // somebody to discover: this detects tampering, it does not prevent
        // it, and it is defeated by anybody who can recompute the chain —
        // which is anybody who can unlock the application. Closing that needs
        // an anchor outside the device. docs/AUDIT_CHAIN.md sets out what
        // that would take and does not pretend it is here.
        'Each entry carries the hash of the one before it from the same device, '
        + 'so an alteration, a deletion or an insertion is detectable. It is '
        + 'not prevented, and it is defeated by anybody who can write to this '
        + 'database and recompute the chain. There is no external anchor.'),
    ],
  },
  {
    id: 'ELECTRONIC_SIGNATURES',
    name: 'Electronic signatures',
    doc: 'ELECTRONIC_SIGNATURES.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'Nothing here signs anything, and that is a decision rather than an '
      + 'omission. A homemade signature mechanism on a will or a deed would be '
      + 'the most damaging thing this application could offer.',
    controls: [
      control('no-signature-mechanism', 'No signing, and no appearance of it',
        STATUS.TESTED, { file: 'js/domain/estate.js', test: 'tests/legal.test.mjs' }),
      control('not-the-instrument', 'A recorded will is a note, and says so',
        STATUS.TESTED, { file: 'js/modules/vault.js', test: 'tests/legal.test.mjs' }),
    ],
  },
  {
    id: 'ISO_27001',
    name: 'ISO/IEC 27001 information security management',
    doc: 'ISO_27001.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'Certification is for an organisation with a management system, an '
      + 'auditor and a scope statement. There is no organisation here. Some '
      + 'Annex A controls still describe things this code either does or does '
      + 'not do, and those are worth naming.',
    controls: [
      control('a8-24-cryptography', 'A.8.24 Use of cryptography',
        STATUS.TESTED, { file: 'js/security/crypto.js', test: 'tests/security.test.mjs' }),
      control('a5-15-access', 'A.5.15 Access control',
        STATUS.TESTED, { file: 'js/security/rbac.js', test: 'tests/security.test.mjs' }),
      control('a8-15-logging', 'A.8.15 Logging',
        STATUS.TESTED, { file: 'js/data/audit.js', test: 'tests/data.test.mjs' }),
      control('a5-30-continuity', 'A.5.30 ICT readiness for business continuity',
        STATUS.DESIGNED, { file: 'js/security/escrow.js' },
        'Key escrow and a recovery phrase exist. There is no tested restore path '
        + 'and no backup document — see the audit.'),
      control('management-system', 'An ISMS: scope, risk treatment, internal audit',
        STATUS.NOT_APPLICABLE, {}, 'There is no organisation to certify.'),
    ],
  },
  {
    id: 'ISO_27701',
    name: 'ISO/IEC 27701 privacy information management',
    doc: 'ISO_27701.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'An extension to 27001, and the same answer follows. Its vocabulary for '
      + 'controller and processor obligations is still the clearest way to say '
      + 'what this application does with data about people.',
    controls: [
      control('classification', 'Personal data identified and classified',
        STATUS.TESTED, { file: 'js/data/classification.js', test: 'tests/classification.test.mjs' }),
      control('minimisation', 'Only what is needed is collected',
        STATUS.DESIGNED, { doc: 'docs/DATA_GOVERNANCE.md' },
        'The schema is generous by design — a household decides what to fill in. '
        + 'Nothing enforces minimisation.'),
      control('subject-access', 'A person can see what is held about them',
        STATUS.IMPLEMENTED, { file: 'js/reports/build.js' },
        'Export exists for the household. There is no per-person subject access '
        + 'request path, and no route for a non-member such as staff.'),
    ],
  },
  {
    id: 'SOC2',
    name: 'SOC 2 trust services criteria',
    doc: 'SOC2.md',
    applies: APPLIES.NOT_TO_THIS,
    why: 'A SOC 2 report is an auditor\'s opinion on a service organisation. '
      + 'There is no service and no service organisation. The criteria are '
      + 'included because they are a familiar way to ask what the security '
      + 'story is.',
    controls: [
      control('cc6-logical-access', 'CC6 Logical and physical access',
        STATUS.TESTED, { file: 'js/security/rbac.js', test: 'tests/security.test.mjs' }),
      control('cc7-monitoring', 'CC7 System operations and monitoring',
        STATUS.TESTED,
        { file: 'js/data/diagnostics.js', test: 'tests/diagnostics.test.mjs' },
        // TESTED for the observability half and honest about the rest. There
        // is no operator here, so "monitoring" in CC7's sense cannot exist —
        // which is the same reason this whole regime carries NOT_TO_THIS.
        'Failures, refusals and failed syncs are recorded on the device, '
        + 'redacted, and shown in Settings — so a run of the same failure is '
        + 'tellable from a one-off. Nobody is watching them: no alerting, no '
        + 'view across devices, and nothing is transmitted anywhere. See '
        + 'docs/OBSERVABILITY.md.'),
      control('a1-availability', 'A1 Availability',
        STATUS.NOT_APPLICABLE, {}, 'Nothing is served to anybody.'),
    ],
  },
  {
    id: 'INTERNATIONAL_PRIVACY',
    name: 'GDPR, UK GDPR and US state privacy law',
    doc: 'INTERNATIONAL_PRIVACY.md',
    applies: APPLIES.UNCERTAIN,
    why: 'A household in India using an application on its own devices is '
      + 'outside these regimes as ordinarily understood. Whether that survives '
      + 'a member living in the EU or the UK, or data resting in a Google '
      + 'account, is a question a programmer should not answer.',
    controls: [
      control('lawful-basis', 'A lawful basis for each purpose',
        STATUS.LEGAL_REVIEW_REQUIRED, {},
        'The household exemption is the obvious answer and its edges are not '
        + 'for this file to draw.'),
      control('data-location', 'Where the data rests',
        STATUS.IMPLEMENTED, { file: 'js/sync/drive.js' },
        "On the device, and in the household's own Google account. Region is "
        + "Google's to determine and is not chosen here."),
      control('erasure-rights', 'Erasure, portability and access',
        STATUS.IMPLEMENTED, { file: 'js/data/retention.js' },
        'Deletion and export exist as household operations. Neither is framed '
        + 'as a rights request, and there is no requester other than the owner.'),
    ],
  },
]);

/**
 * Statuses that assert something about the code without citing any.
 *
 * The reason `tools/compliance.mjs` exists. A matrix where a row can say
 * IMPLEMENTED with nothing behind it is a matrix that will say it everywhere
 * within a year, and the word will stop meaning anything.
 *
 * @param {ReadonlyArray<{id: string, controls: ReadonlyArray<{
 *   id: string, status: string, evidence?: object
 * }>}>} [regimes]
 */
export function unevidenced(regimes = REGIMES) {
  const bad = [];
  for (const regime of regimes) {
    for (const row of regime.controls) {
      if (!EVIDENCED.includes(row.status)) continue;
      const { file, test, doc } = row.evidence ?? {};
      if (!file && !test && !doc) {
        bad.push(`${regime.id}/${row.id} is ${row.status} and cites nothing`);
      }
      if (row.status === STATUS.TESTED && !test) {
        bad.push(`${regime.id}/${row.id} is TESTED and names no test suite`);
      }
    }
  }
  return bad;
}

/**
 * TESTED controls whose cited suite would never be run.
 *
 * `tools/compliance.mjs` already refuses a citation pointing at a file that
 * does not exist. Existing is not the same as running: `tests/run.mjs`
 * executes what matches `*.test.mjs` and nothing else, so a suite renamed to
 * `security.mjs` would still be on disk, still resolve, and silently stop being
 * executed — while a control went on saying TESTED about it.
 *
 * Every one of the forty-one is runnable today. That is the reason to check it
 * rather than a reason not to: a property that holds by care holds until
 * somebody is in a hurry.
 *
 * @param {ReadonlyArray<{id: string, controls: ReadonlyArray<{
 *   id: string, status: string, evidence?: object
 * }>}>} regimes
 * @param {(path: string) => boolean} runs whether the suite runner executes it
 */
export function citingUnrunTests(regimes = REGIMES, runs = () => true) {
  const bad = [];
  for (const regime of regimes) {
    for (const row of regime.controls) {
      if (row.status !== STATUS.TESTED) continue;
      const test = row.evidence?.test;
      if (test && !runs(test)) {
        bad.push(`${regime.id}/${row.id} is TESTED and cites ${test}, which the suite does not run`);
      }
    }
  }
  return bad;
}

/**
 * Controls held below TESTED that do not say why.
 *
 * The register's honesty runs the other way from the checks above it. Those
 * stop a control claiming more than its evidence supports; this stops one
 * sitting below what it has done without stating a reason — because a status
 * with no reason is indistinguishable from a status nobody has revisited,
 * and this repository has now found four documents that drifted exactly
 * that way.
 *
 * Fourteen of the sixteen already carried a gap when this was written. The
 * two that did not were `UIDAI/no-authentication` and
 * `PROPERTY/no-legal-effect-claim` — both refusals, both asserted rather than
 * tested, and both now TESTED with a suite that reads what ships. So the
 * check found nothing to excuse and everything to hold.
 *
 * A gap is not an admission of failure. `DPDP/children` states that nothing
 * verifies the adult is the guardian, which is why it is IMPLEMENTED and not
 * TESTED — the requirement is *verifiable* parental consent and the
 * application has no means to verify. Writing that down is the control doing
 * its job.
 *
 * @param {ReadonlyArray<{id: string, controls: ReadonlyArray<{
 *   id: string, status: string, gap?: string|null
 * }>}>} [regimes]
 */
export function unexplained(regimes = REGIMES) {
  /** @type {readonly string[]} */
  const below = [STATUS.DESIGNED, STATUS.IMPLEMENTED];
  const out = [];
  for (const regime of regimes) {
    for (const row of regime.controls) {
      if (!below.includes(row.status)) continue;
      const gap = String(row.gap ?? '').trim();
      const unsaid = `${regime.id}/${row.id} is ${row.status} and does not explain what is missing`;
      if (!gap) {
        out.push(unsaid);
        continue;
      }
      // A placeholder is not an explanation. Two conditions rather than one,
      // and each catches what the other cannot: the length floor stops a
      // token, and the word list stops a *long* excuse — "TODO: come back to
      // this once we have decided what to do" clears forty characters and
      // explains nothing.
      //
      // Mutation testing was careful about this. Redefining the constructor's
      // `gap = null` default to a placeholder changes nothing today, because
      // all fourteen applicable controls pass an explicit gap and none falls
      // back to it. That mutation is inert rather than uncaught, and this
      // note says so instead of claiming a catch that did not happen.
      if (gap.length < MEANINGFUL_GAP || /^(?:tbd|todo|n\/?a|none|unstated|unknown)\b/i.test(gap)) {
        out.push(unsaid);
      }
    }
  }
  return out;
}

/**
 * How long a stated gap has to be before it counts as an explanation.
 *
 * A sentence somebody wrote for a reader, not a token written for a checker.
 * The shortest real one in the register is comfortably over this.
 */
export const MEANINGFUL_GAP = 40;

/**
 * Anything claiming to be verified.
 *
 * Always empty, and the check is the point: verification means a person
 * qualified to judge signed their name to it, and nobody has.
 *
 * @param {ReadonlyArray<{id: string, controls: ReadonlyArray<{
 *   id: string, status: string
 * }>}>} [regimes]
 */
export function claimingVerified(regimes = REGIMES) {
  return regimes.flatMap((regime) => regime.controls
    .filter((row) => row.status === STATUS.VERIFIED)
    .map((row) => `${regime.id}/${row.id}`));
}

/** Counts, for the matrix. */
export function summary(regimes = REGIMES) {
  const byStatus = {};
  let controls = 0;
  for (const regime of regimes) {
    for (const row of regime.controls) {
      controls += 1;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }
  }
  return {
    regimes: regimes.length,
    controls,
    byStatus,
    gaps: regimes.flatMap((regime) => regime.controls
      .filter((row) => row.status === STATUS.NOT_STARTED)
      .map((row) => ({ regime: regime.id, control: row.id, gap: row.gap }))),
  };
}
