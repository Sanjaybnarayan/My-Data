# SOC 2 Trust Services Criteria

**Not a compliance claim. No SOC 2 report exists, has been sought, or is
planned.** An applicability review by a programmer. Legal review required. See
[MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Not to this application.** A SOC 2 report is an independent auditor's opinion
on a *service organisation's* controls, prepared for that organisation's
customers. There is no service, no service organisation, and no customer.

The criteria are answered below because they are a familiar way to ask what the
security story is, not because a report is contemplated.

| Criterion | Status | Evidence |
| --- | --- | --- |
| CC6 Logical and physical access | `TESTED` | `js/security/rbac.js` |
| CC7 System operations and monitoring | `NOT_STARTED` | — |
| A1 Availability | `NOT_APPLICABLE` | Nothing is served to anybody |

## CC6 — access

Covered in [ISO_27001.md](ISO_27001.md). Authorization in the repository,
enforced again on the server from a schema-generated policy; encryption at rest
bound to entity, record and field; session timeout; rate-limited unlock; a
device registry that notices an unrecognised device.

## CC7 — monitoring, and the gap

**There is no observability of any kind.**

The audit trail records changes to records. It says nothing about the health of
the system: no error aggregation, no sync-failure alerting, no measure of how
often an extraction fails or an import is abandoned. `docs/PHASE_AUDIT_0_13.md`
lists `OBSERVABILITY.md` among the required documents that do not exist, and it
does not exist because the thing it would describe does not either.

This is worth stating in a compliance document because it is the criterion where
a plausible-sounding answer would be easiest to write. The application logs
things; a reader could take that for monitoring. It is not.

## A1 — availability

There is no availability commitment because nothing is served. The application
works offline by design, and a failure of the household's network or of Google's
services degrades sync rather than access — `docs/ARCHITECTURE.md` covers the
offline model.
