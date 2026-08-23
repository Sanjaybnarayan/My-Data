/**
 * Modules, in navigation order.
 *
 * Separate from `schema.js` because that file is on the crowded list and may
 * not grow, and because this is a different kind of statement: `schema.js`
 * says what a household's records *are*, and this says how they are reached.
 *
 * The entity list per module is **not** written here. It is derived from the
 * entities themselves by `withEntities` below. It used to be written twice and
 * the two copies drifted: `economicEvent`, `staff` and `staffLeave` were
 * declared with a module and appeared in `entitiesOfModule`, but no module
 * listed them. `visibleModules` in `js/security/rbac.js` reads the composed
 * list to decide which navigation items a role sees, so an entity missing from
 * it is an entity that cannot keep its own module on screen.
 */

/** @typedef {{id: string, label: string, icon: string}} ModuleDeclaration */

/** @type {readonly ModuleDeclaration[]} */
export const MODULE_ORDER = Object.freeze([
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  /*
   * Two modules with no entities of their own, like `dashboard` and `reports`.
   *
   * Both are views over records that already exist. Notifications draws the
   * dates `domain/reminders.js` derives from the schema; Profile draws the
   * completion `domain/profile.js` scores. Neither owns a table, and neither
   * may ever be given one — the moment either stores something, the thing it
   * is showing stops being the household's own records.
   */
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'identity', label: 'Identity', icon: 'user' },
  { id: 'family', label: 'Family', icon: 'family' },
  { id: 'finance', label: 'Finance', icon: 'wallet' },
  { id: 'investments', label: 'Investments', icon: 'chart' },
  { id: 'documents', label: 'Documents', icon: 'file' },
  { id: 'vehicles', label: 'Vehicles', icon: 'car' },
  { id: 'health', label: 'Health', icon: 'health' },
  { id: 'insurance', label: 'Insurance', icon: 'shield' },
  { id: 'property', label: 'Property', icon: 'home' },
  { id: 'belongings', label: 'Belongings', icon: 'box' },
  { id: 'travel', label: 'Travel', icon: 'globe' },
  { id: 'education', label: 'Education', icon: 'school' },
  { id: 'tasks', label: 'Tasks', icon: 'check' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'notes', label: 'Notes', icon: 'note' },
  { id: 'vault', label: 'Vault', icon: 'lock' },
  { id: 'digital', label: 'Digital', icon: 'globe' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'safety', label: 'Safety', icon: 'shield' },
  { id: 'emergency', label: 'Emergency', icon: 'alert' },
  { id: 'reports', label: 'Reports', icon: 'report' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]);

/**
 * The declarations above, each carrying the entities that name it.
 *
 * Takes `entities` as an argument rather than importing it, because
 * `schema.js` imports this file — reaching back for it would be a cycle, and a
 * cycle around a `const` is a temporal-dead-zone bug waiting for whichever
 * module happens to load first.
 *
 * @param {Record<string, {module: string, name: string}>} entities
 */
export function withEntities(entities) {
  return Object.freeze(MODULE_ORDER.map((m) => Object.freeze({
    ...m,
    entities: Object.values(entities).filter((e) => e.module === m.id).map((e) => e.name),
  })));
}
