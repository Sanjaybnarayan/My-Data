/**
 * Schema labels, in the reader's language.
 *
 * The English names of every entity, every field and every module live in
 * js/data/schema.js and stay there. This module is the one door they pass
 * through on the way to a screen, so a catalogue can replace them without a
 * second copy existing to drift out of step.
 *
 * How many there are is deliberately not written here. It was — "the 47
 * entities, their 566 fields and the 21 modules", and "all 345 of them" — and
 * by the time anybody read it the schema held 53, 617, 25 and 748. Four
 * numbers, all stale, in the header of the module whose entire subject is a
 * second copy drifting from the first. `labelKeys().length` is the count, the
 * documents carry it under a `live:` marker that tools/self-description.mjs
 * checks, and a source comment is not a place to keep a number.
 *
 * The key space is derived from the schema — `labelKeys()` is what a
 * translator is given and what `coverage()` measures against, and neither is
 * written by hand.
 *
 * **This being the one door is a claim, and it is now checked.** Thirty-two
 * call sites read `def.labels.one` straight out of the schema and put it on a
 * screen, which no catalogue could reach however completely it was
 * translated. `labels-through-the-door` in tools/lint.mjs is what stops the
 * thirty-third.
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
 * The label for a tab, given the module's entity definitions and the name the
 * router holds.
 *
 * Three module screens wrote `entities.find((e) => e.name === name)?.labels.many
 * ?? name` inline — the same lookup, the same fallback, and the same way past
 * the door three times over. The fallback matters: the router can hold a name
 * this module does not define, and a screen that threw on it would be worse
 * than one showing the raw name.
 */
export function tabLabel(defs, name, form = 'many') {
  const def = defs.find((one) => one.name === name);
  return def ? entityLabel(def, form) : name;
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
