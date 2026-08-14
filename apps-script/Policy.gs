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

/** Every entity this role may read, for the pull filter. */
function readableEntities(role) {
  var out = [];
  for (var name in POLICY) {
    if (!Object.prototype.hasOwnProperty.call(POLICY, name)) continue;
    if (policyAllows(role, 'read', name)) out.push(name);
  }
  return out;
}
