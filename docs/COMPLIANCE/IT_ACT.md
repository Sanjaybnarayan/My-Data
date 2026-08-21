# Information Technology Act, 2000 and the SPDI Rules, 2011

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Conditionally, and mostly as a yardstick.** Rule 8 of the SPDI Rules binds a
*body corporate* handling sensitive personal data. A household is not a body
corporate. But the Rules name the categories of sensitive data and describe
"reasonable security practices", and that is the nearest thing to a written
standard this application can be held against — so it is held against it.

## Sensitive categories, and what happens to each

The Rules list passwords, financial information, health, biometrics and sexual
orientation. This application holds three of them.

| Category | Held as | Treatment |
| --- | --- | --- |
| Passwords | `vaultItem`, `digitalAsset` | Encrypted; never in a list column |
| Financial | `account`, `transaction`, `holding`, `loan` | Account and card numbers encrypted and masked; balances plaintext |
| Health | `healthRecord`, `medication`, `vaccination` | Diagnoses encrypted; readable by fewer roles |

Balances and transaction amounts are **not** encrypted, and that is deliberate
rather than an oversight: a search index over ciphertext finds nothing and a
table cannot sort a column it cannot read. `docs/DATA_CLASSIFICATION.md` records
the reasoning and `Settings → Privacy` shows a household which fields are which.

## Reasonable security practices

| Requirement | Status | Evidence |
| --- | --- | --- |
| Reasonable security practices | `TESTED` | `js/security/crypto.js` |
| Sensitive categories identified | `TESTED` | `js/data/classification.js` |
| Access limited | `TESTED` | `js/security/rbac.js` |
| Published privacy policy | `NOT_APPLICABLE` | Nothing is collected from outside the household |

What that amounts to concretely: AES-256-GCM per entity, record and field; one
data key wrapped separately by a PIN, a WebAuthn credential and a recovery
phrase; authorization enforced in the repository rather than the interface, so a
screen cannot forget it; session timeout and rate-limited unlock.

## What the Rules would want that is absent

They contemplate a documented security policy and a designated grievance
officer. Neither exists, and for a household neither obviously should. The
honest position is that the *practices* are implemented and the *paperwork* of a
body corporate is not, because there is no body corporate.

Section 43A liability turns on negligence causing wrongful loss. Nothing here
addresses that, and nothing here should pretend to.
