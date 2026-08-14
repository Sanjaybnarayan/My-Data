/**
 * Generate the backend's copy of the access rules from the schema.
 *
 * ## Why generate rather than send
 *
 * The rules live in `js/data/schema.js`, which the Apps Script backend cannot
 * import — different runtime, different file, no bundler between them. There
 * were three ways to get them across and two are wrong:
 *
 *   - **Send them with the request.** The browser would be telling the server
 *     what the browser is allowed to do. That is not authorization, it is a
 *     suggestion with extra steps.
 *   - **Write them out by hand.** Two tables describing one set of rules, which
 *     will disagree, and the disagreement will be discovered by somebody
 *     reading a screen that is wrong rather than by a test.
 *   - **Generate one from the other, and fail the build when they differ.**
 *
 * `tests/backend.test.mjs` regenerates this file in memory and compares. A
 * schema change that nobody carried across breaks the suite rather than
 * quietly widening what a child may read.
 *
 *   node tools/policy.mjs           write apps-script/Policy.gs
 *   node tools/policy.mjs --check   exit 1 if the file is out of date
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entities, ROLES } from '../js/data/schema.js';
import { OWN_RECORD_ENTITIES, SUBJECT_FIELD } from '../js/security/rbac.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const POLICY_FILE = join(ROOT, 'apps-script', 'Policy.gs');

/** The file as it should be, given the schema as it is now. */
export function generate() {
  // The own-record tables live in `js/security/rbac.js` for the same reason the
  // ACLs live in the schema: one description, generated across, with a check
  // that fails when the copy drifts. `person` is deliberately excluded on the
  // server — see the note in the generated file.
  const own = [...OWN_RECORD_ENTITIES]
    .filter((name) => name !== 'person' && SUBJECT_FIELD[name])
    .sort()
    .map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(SUBJECT_FIELD[name])}`);

  const rows = Object.keys(entities).sort().map((name) => {
    const { acl } = entities[name];
    return `  ${JSON.stringify(name)}: { read: ${JSON.stringify(acl.read)}, `
      + `write: ${JSON.stringify(acl.write)} }`;
  });

  return `/**
 * Who may read and write each entity.
 *
 * GENERATED FROM js/data/schema.js BY tools/policy.mjs — DO NOT EDIT.
 * Run \`node tools/policy.mjs\` after changing an entity's \`acl\`, and
 * \`tests/backend.test.mjs\` will tell you if you forgot.
 *
 * This is the authoritative copy. The browser has its own in \`security/rbac.js\`
 * and that one is advisory: it hides controls somebody may not use, which is a
 * courtesy, and it can be edited in devtools by anybody who cares to. This file
 * decides what actually reaches the workbook.
 */

var ROLES = ${JSON.stringify(ROLES)};

var POLICY = {
${rows.join(',\n')}
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
 * \`person\` is absent on purpose, and its absence is the security property.
 * The server maps a caller's email to a person id through the members list,
 * which only the owner may change. If somebody could edit their own \`person\`
 * row through this rule, they could edit the thing that identifies them, and
 * the mapping would no longer be owner-controlled. So the browser lets a
 * person open their own record and the backend does not carry that across.
 */
var OWN_RECORD = {
${own.join(',\n')}
};

/**
 * May this role touch *this row*, because the row is about them?
 *
 * The narrower half of the rule, and it is only ever a widening of
 * \`policyAllows\` — never a way to refuse something the blanket policy allowed.
 * An adult who may read every health record still may; this is what lets a
 * child reach their own.
 *
 * \`personId\` comes from the members list via \`admit()\`, never from the
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
`;
}

const current = () => {
  try { return readFileSync(POLICY_FILE, 'utf8'); } catch { return ''; }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = generate();

  if (process.argv.includes('--check')) {
    if (current() === wanted) {
      console.log('apps-script/Policy.gs is up to date');
    } else {
      console.error('apps-script/Policy.gs is out of date — run `node tools/policy.mjs`');
      process.exit(1);
    }
  } else {
    writeFileSync(POLICY_FILE, wanted);
    console.log(`wrote apps-script/Policy.gs — ${Object.keys(entities).length} entities`);
  }
}
