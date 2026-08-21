# Database Schema

Generated from `js/data/schema.js`, which is the single source of truth: object
stores, indexes, validators, forms, list columns, Sheets tabs, reminder fields
and report columns are all derived from it.

## Shape today

- **43**<!--live:entities--> entities, **519**<!--live:fields--> fields, across **19**<!--live:modules--> modules
- **35**<!--live:encryptedFields--> fields encrypted — **6.7%**<!--live:encryptedPercent--> — the rest is plaintext locally and in the
  backup Sheet
- Store: **IndexedDB**. No foreign keys, no constraints, no `CHECK`.
- Roles: `owner`, `spouse`, `adult`, `child`, `guest`

## Common fields

Present on records where applicable: `id`, `createdAt`, `updatedAt`,
`deletedAt` (soft delete), plus per-entity `version` and, on transactions,
`importKey` (the duplicate fingerprint).

Absent, and required by the master prompt: `family_id`, `owner_id`,
`created_by`, `updated_by`, `source_type`, `source_id`, `verification_status`,
`confidence_score`, `classification`, `retention_policy_id`.

## Classification gap

The prompt specifies six levels — `PUBLIC`, `INTERNAL`, `PRIVATE`,
`SENSITIVE`, `HIGHLY_SENSITIVE`, `CRITICAL_SECRET`. The schema has one
boolean, `encrypted`. A PAN, a medical note and a password are today
indistinguishable to the storage layer.

Adding `classification` to the field descriptor is a small schema change with
large downstream reach — masking, search, export, AI gating and retention can
all key off it. It is the highest-leverage single change in Layer 1.

## Referential integrity

`ref()` fields hold ids that nothing enforces. `js/domain/imports.js` already
reports transactions naming a statement that no longer exists — the risk is
real, recognised, and currently surfaced rather than prevented.

## What must be added for the prompt's model

`EconomicEvent`, `LedgerEntry`, `Transfer`, `ReconciliationRecord`,
`Counterparty`, `IndividualCKYC`, `KYCVersion`, `KYCConflict`, `Consent`,
`DataProvenance`, `DataLineage`, `RetentionPolicy`, `DataDeletionRequest`,
`ProcessorRegistry`, plus the chat, location, staff and tenant entities.

None of these exist. Nothing has been added during Phase 0.
