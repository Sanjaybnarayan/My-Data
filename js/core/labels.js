/**
 * Schema labels, in the reader's language.
 *
 * The English names of the 47 entities, their 566 fields and the 21 modules
 * live in js/data/schema.js and stay there. This module is the one door they
 * pass through on the way to a screen, so a catalogue can replace them without
 * a second copy of all 345 of them existing to drift out of step.
 *
 * The key space is derived from the schema — `labelKeys()` is what a
 * translator is given and what `coverage()` measures against, and neither is
 * written by hand.
 */

import { entities, modules } from '../data/schema.js';
import { label } from './locale.js';

export const entityKey = (name, form) => `entity.${name}.${form}`;
export const fieldKey = (entityName, key) => `field.${entityName}.${key}`;
export const moduleKey = (id) => `module.${id}`;

/** `def.labels.one` / `.many`, translated. */
export function entityLabel(def, form = 'one') {
  return label(entityKey(def.name, form), def.labels?.[form] ?? def.name);
}

/**
 * A field's label. The entity has to be named because `amount` means one thing
 * on a transaction and another on a claim, and a language that distinguishes
 * them needs somewhere to say so.
 */
export function fieldLabel(entityName, field) {
  return label(fieldKey(entityName, field.key), field.label ?? field.key);
}

export function moduleLabel(mod) {
  return label(moduleKey(mod.id), mod.label ?? mod.id);
}

/**
 * Every label key the application can ask for. Derived, so a new entity is
 * something a translator is told about rather than something they discover.
 */
export function labelKeys() {
  const keys = [];
  for (const mod of Object.values(modules)) keys.push(moduleKey(mod.id));
  for (const def of Object.values(entities)) {
    keys.push(entityKey(def.name, 'one'), entityKey(def.name, 'many'));
    for (const field of def.fields ?? []) keys.push(fieldKey(def.name, field.key));
  }
  return keys;
}
