/**
 * Who may read and write each entity.
 *
 * GENERATED FROM js/data/schema.js BY tools/policy.mjs — DO NOT EDIT.
 * Run `node tools/policy.mjs` after changing an entity's `acl`, and
 * `tests/backend.test.mjs` will tell you if you forgot.
 *
 * This is the authoritative copy. The browser has its own in `security/rbac.js`
 * and that one is advisory: it hides controls somebody may not use, which is a
 * courtesy, and it can be edited in devtools by anybody who cares to. This file
 * decides what actually reaches the workbook.
 */

var ROLES = ["owner","spouse","adult","child","guest"];

var POLICY = {
  "account": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "appointment": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "bankStatement": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "budget": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "certificate": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "digitalAsset": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "document": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "economicEvent": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "education": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "emergencyContact": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "employment": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "event": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "fuelLog": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "healthRecord": { read: ["owner","spouse","adult"], write: ["owner","spouse","adult"] },
  "holding": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "identityDocument": { read: ["owner","spouse"], write: ["owner","spouse"] },
  "importantDate": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "investmentTransaction": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "kycRecord": { read: ["owner","spouse"], write: ["owner","spouse"] },
  "loan": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "medication": { read: ["owner","spouse","adult"], write: ["owner","spouse","adult"] },
  "note": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "person": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "policy": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "project": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "property": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "receipt": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "recurringPayment": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "relationship": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "smsMessage": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "staff": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "staffLeave": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "subscription": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "task": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "transaction": { read: ["owner","spouse","adult"], write: ["owner","spouse"] },
  "vaccination": { read: ["owner","spouse","adult"], write: ["owner","spouse","adult"] },
  "vaultItem": { read: ["owner","spouse"], write: ["owner","spouse"] },
  "vehicle": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] },
  "vehicleService": { read: ["owner","spouse","adult","child"], write: ["owner","spouse","adult"] }
};

/** Roles, most privileged first. A rank of -1 is not a role at all. */
function roleRank(role) {
  for (var i = 0; i < ROLES.length; i++) if (ROLES[i] === role) return i;
  return -1;
}

/**
 * May this role touch this entity?
 *
 * An entity with no entry is refused rather than allowed. A store the schema
 * has never heard of is either a typo or somebody probing, and both are better
 * answered with no.
 */
function policyAllows(role, action, entityName) {
  if (roleRank(role) < 0) return false;
  var entry = POLICY[entityName];
  if (!entry) return false;
  var allowed = action === 'read' ? entry.read : entry.write;
  for (var i = 0; i < allowed.length; i++) if (allowed[i] === role) return true;
  return false;
}

/**
 * Which field on a row names the person it is about.
 *
 * `person` is absent on purpose, and its absence is the security property.
 * The server maps a caller's email to a person id through the members list,
 * which only the owner may change. If somebody could edit their own `person`
 * row through this rule, they could edit the thing that identifies them, and
 * the mapping would no longer be owner-controlled. So the browser lets a
 * person open their own record and the backend does not carry that across.
 */
var OWN_RECORD = {
  "appointment": "person",
  "certificate": "person",
  "education": "person",
  "event": "createdBy",
  "healthRecord": "person",
  "medication": "person",
  "note": "createdBy",
  "task": "assignee",
  "vaccination": "person"
};

/**
 * May this role touch *this row*, because the row is about them?
 *
 * The narrower half of the rule, and it is only ever a widening of
 * `policyAllows` — never a way to refuse something the blanket policy allowed.
 * An adult who may read every health record still may; this is what lets a
 * child reach their own.
 *
 * `personId` comes from the members list via `admit()`, never from the
 * request. A caller naming the person they are would be a caller granting
 * themselves somebody else's records.
 */
function ownRecordAllows(personId, entityName, record) {
  if (!personId) return false;
  var field = OWN_RECORD[entityName];
  if (!field) return false;
  return Boolean(record) && record[field] === personId;
}

/** Every entity this role may read, for the pull filter. */
function readableEntities(role) {
  var out = [];
  for (var name in POLICY) {
    if (!Object.prototype.hasOwnProperty.call(POLICY, name)) continue;
    if (policyAllows(role, 'read', name)) out.push(name);
  }
  return out;
}

/** Entities where a row may be reachable even though the blanket policy is no. */
function ownRecordEntities() {
  var out = [];
  for (var name in OWN_RECORD) {
    if (Object.prototype.hasOwnProperty.call(OWN_RECORD, name)) out.push(name);
  }
  return out;
}
