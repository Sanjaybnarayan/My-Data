/**
 * Forms, built from the schema.
 *
 * There is one form implementation in FamilyOS. Every add and edit screen —
 * a transaction, a vaccination, a property, a vault entry — is this function
 * reading the entity's field list. A module that needed its own form would be
 * a module that had drifted from its schema, and the schema is what the
 * database, the sheet and the sync all agree on.
 *
 * Validation runs through `data/validate.js`, the same code the repository
 * uses, so the form can never accept something the repository will reject —
 * and the message the user reads is the message the rule actually produced.
 */

import { h, replace, focus } from '../dom.js';
import { icon } from '../icons.js';
import { button } from './basics.js';
import { entity } from '../../data/schema.js';
import { validate } from '../../data/validate.js';
import { toMinor, toMajor, format } from '../../core/money.js';
import { today } from '../../core/dates.js';
import { generatePassword, passwordStrength } from '../../security/crypto.js';
import { userMessage, ValidationError } from '../../core/errors.js';

/**
 * @param {string} entityName
 * @param {{record?: object, db: object, currency?: string,
 *          onSubmit: (values: object) => Promise<void>, onCancel?: Function,
 *          submitLabel?: string, hide?: string[], preset?: object}} options
 * @returns {Promise<{node: Node, focusFirst: Function}>}
 */
export async function entityForm(entityName, options) {
  const def = entity(entityName);
  const {
    record = null, db, currency = 'INR', onSubmit, onCancel,
    submitLabel = record ? 'Save changes' : `Add ${def.labels.one.toLowerCase()}`,
    hide = [], preset = {},
  } = options;

  const values = { ...defaultsFor(def), ...preset, ...(record ?? {}) };
  const controls = new Map();
  const errorNodes = new Map();

  // Reference options are fetched once, before the first paint. Loading them
  // per-field would produce a form that fills in one dropdown at a time.
  const refOptions = await loadReferences(def, db);

  const visible = def.fields.filter((f) => !f.hidden && !hide.includes(f.key));
  const groups = new Map();
  for (const f of visible) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }

  const summary = h('div', { class: 'field-error', role: 'alert', hidden: true });

  const form = h('form', {
    class: 'stack',
    novalidate: true,
    onSubmit: async (event) => {
      event.preventDefault();
      await submit();
    },
  }, [
    ...[...groups].map(([groupName, fields]) => h('fieldset', { class: 'field-group' }, [
      groups.size > 1 ? h('legend', {}, groupName) : null,
      h('div', { class: 'field-grid' }, fields.map((f) => renderField(f))),
    ])),
    summary,
    h('div', { class: 'row row--end' }, [
      onCancel ? button('Cancel', { variant: 'subtle', onClick: onCancel }) : null,
      button(submitLabel, { variant: 'primary', type: 'submit' }),
    ]),
  ]);

  /* --------------------------------------------------------------- fields */

  function renderField(field) {
    const id = `f-${entityName}-${field.key}`;
    const control = buildControl(field, id);
    controls.set(field.key, control);

    const error = h('div', { class: 'field-error', id: `${id}-error`, hidden: true });
    errorNodes.set(field.key, error);

    const wide = ['textarea', 'richtext', 'tags', 'multiref', 'multienum', 'files'];
    return h('div', {
      class: ['field', wide.includes(field.type) && 'field--full'],
      dataset: { field: field.key },
      // A field only relevant to one choice of another field (a transfer's
      // destination account) stays out of the way until that choice is made.
      hidden: !isShown(field),
    }, [
      field.type === 'boolean' ? null : h('label', { class: 'field-label', for: id }, [
        field.label,
        field.required ? h('span', { class: 'required', 'aria-hidden': 'true' }, '*') : null,
      ]),
      control,
      field.help ? h('div', { class: 'field-help' }, field.help) : null,
      error,
    ]);
  }

  function isShown(field) {
    if (!field.showWhen) return true;
    return Object.entries(field.showWhen).every(([key, expected]) => values[key] === expected);
  }

  function refreshVisibility() {
    for (const field of visible) {
      const wrapper = form.querySelector(`[data-field="${field.key}"]`);
      if (wrapper) wrapper.hidden = !isShown(field);
    }
  }

  function set(key, value) {
    values[key] = value;
    clearError(key);
    refreshVisibility();
  }

  function buildControl(field, id) {
    const common = {
      id,
      name: field.key,
      'aria-describedby': `${id}-error`,
      required: field.required,
    };

    switch (field.type) {
      case 'textarea':
      case 'richtext':
        return h('textarea', {
          ...common,
          class: 'textarea',
          value: values[field.key] ?? '',
          rows: field.type === 'richtext' ? 8 : 3,
          onInput: (e) => set(field.key, e.target.value),
        });

      case 'boolean':
        return h('label', { class: 'switch-row' }, [
          h('input', {
            ...common,
            type: 'checkbox',
            class: 'switch',
            checked: Boolean(values[field.key]),
            onChange: (e) => set(field.key, e.target.checked),
          }),
          h('span', {}, field.label),
        ]);

      case 'enum':
        return h('select', {
          ...common,
          class: 'select',
          value: values[field.key] ?? '',
          onChange: (e) => set(field.key, e.target.value),
        }, [
          h('option', { value: '' }, field.required ? 'Choose…' : '—'),
          ...field.options.map((option) => h('option', {
            value: option,
            selected: values[field.key] === option,
          }, sentence(option))),
        ]);

      case 'multienum':
        return checkboxSet(field, field.options.map((o) => ({ value: o, label: sentence(o) })));

      case 'ref': {
        const list = refOptions.get(field.ref) ?? [];
        return h('select', {
          ...common,
          class: 'select',
          value: values[field.key] ?? '',
          onChange: (e) => set(field.key, e.target.value),
        }, [
          h('option', { value: '' }, list.length ? 'Choose…' : `No ${field.ref}s yet`),
          ...list.map((o) => h('option', {
            value: o.id,
            selected: values[field.key] === o.id,
          }, o.label)),
        ]);
      }

      case 'multiref':
        return checkboxSet(field, (refOptions.get(field.ref) ?? [])
          .map((o) => ({ value: o.id, label: o.label })));

      case 'currency':
        return currencyInput(field, common);

      case 'number':
        return h('input', {
          ...common,
          type: 'number',
          class: 'input input--numeric',
          inputmode: 'decimal',
          step: field.step ?? 1,
          min: field.min,
          max: field.max,
          value: values[field.key] ?? '',
          onInput: (e) => set(field.key, e.target.value === '' ? null : Number(e.target.value)),
        });

      case 'date':
        return h('input', {
          ...common,
          type: 'date',
          class: 'input',
          value: values[field.key] ?? '',
          onInput: (e) => set(field.key, e.target.value),
        });

      case 'time':
        return h('input', {
          ...common, type: 'time', class: 'input',
          value: values[field.key] ?? '',
          onInput: (e) => set(field.key, e.target.value),
        });

      case 'password':
        return passwordInput(field, common);

      case 'tags':
        return tagsInput(field, common);

      case 'color':
        return h('input', {
          ...common, type: 'color', class: 'input',
          value: values[field.key] || '#1a73e8',
          onInput: (e) => set(field.key, e.target.value),
        });

      case 'email':
      case 'phone':
      case 'url':
        return h('input', {
          ...common,
          type: field.type === 'phone' ? 'tel' : field.type,
          class: 'input',
          inputmode: field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : 'url',
          autocomplete: field.type === 'phone' ? 'tel' : field.type,
          value: values[field.key] ?? '',
          onInput: (e) => set(field.key, e.target.value),
        });

      case 'files':
      case 'image':
        return h('div', { class: 'field-help' },
          'Attachments are added from the record once it is saved.');

      default:
        return h('input', {
          ...common,
          type: 'text',
          class: 'input',
          value: values[field.key] ?? '',
          // Browsers offer to save what looks like a login; these are not.
          autocomplete: field.encrypted ? 'off' : 'on',
          spellcheck: field.encrypted ? 'false' : undefined,
          onInput: (e) => set(field.key, e.target.value),
        });
    }
  }

  function checkboxSet(field, items) {
    const selected = new Set(values[field.key] ?? []);
    return h('div', { class: 'chip-row', role: 'group', 'aria-label': field.label },
      items.map((item) => {
        const input = h('input', {
          type: 'checkbox',
          class: 'sr-only',
          checked: selected.has(item.value),
          onChange: (e) => {
            if (e.target.checked) selected.add(item.value); else selected.delete(item.value);
            set(field.key, [...selected]);
            label.setAttribute('aria-pressed', String(e.target.checked));
          },
        });
        const label = h('label', {
          class: 'chip',
          'aria-pressed': String(selected.has(item.value)),
        }, [input, item.label]);
        return label;
      }));
  }

  /**
   * Money is typed in rupees and stored in paise. The conversion happens here
   * and nowhere else in the view layer, so no screen can accidentally store a
   * float.
   */
  function currencyInput(field, common) {
    const initial = values[field.key];
    const input = h('input', {
      ...common,
      type: 'text',
      class: 'input input--numeric',
      inputmode: 'decimal',
      placeholder: '0.00',
      value: initial === null || initial === undefined || initial === ''
        ? '' : String(toMajor(initial, currency)),
      onInput: (e) => set(field.key, e.target.value),
      onBlur: (e) => {
        const minor = toMinor(e.target.value, currency);
        if (minor !== null) {
          e.target.value = String(toMajor(minor, currency));
          hint.textContent = format(minor, currency);
        } else {
          hint.textContent = '';
        }
      },
    });
    const hint = h('div', { class: 'field-help numeric' },
      initial ? format(initial, currency) : '');
    return h('div', { class: 'stack stack--tight' }, [input, hint]);
  }

  function passwordInput(field, common) {
    const input = h('input', {
      ...common,
      type: 'password',
      class: 'input mono',
      autocomplete: 'new-password',
      value: values[field.key] ?? '',
      onInput: (e) => {
        set(field.key, e.target.value);
        const s = passwordStrength(e.target.value);
        strength.textContent = e.target.value ? `${s.label} · ${s.bits} bits` : '';
        strength.className = `field-help ${s.score >= 3 ? 'money--positive' : s.score <= 1 ? 'money--negative' : ''}`;
      },
    });
    const strength = h('div', { class: 'field-help' });

    return h('div', { class: 'stack stack--tight' }, [
      h('div', { class: 'row' }, [
        h('div', { class: 'spacer' }, input),
        h('button', {
          type: 'button', class: 'btn btn--icon', 'aria-label': 'Show or hide',
          onClick: () => { input.type = input.type === 'password' ? 'text' : 'password'; },
        }, icon('eye')),
        h('button', {
          type: 'button', class: 'btn btn--icon', 'aria-label': 'Generate a password',
          onClick: () => {
            const generated = generatePassword({ length: 20 });
            input.value = generated;
            input.type = 'text';
            input.dispatchEvent(new Event('input'));
          },
        }, icon('refresh')),
      ]),
      strength,
    ]);
  }

  function tagsInput(field, common) {
    const chips = h('div', { class: 'chip-row' });
    const render = () => replace(chips, (values[field.key] ?? []).map((tag) => h('span', {
      class: 'chip',
    }, [
      tag,
      h('button', {
        type: 'button', 'aria-label': `Remove ${tag}`,
        onClick: () => {
          set(field.key, values[field.key].filter((t) => t !== tag));
          render();
        },
      }, '✕'),
    ])));

    const input = h('input', {
      ...common,
      type: 'text',
      class: 'input',
      placeholder: 'Type and press Enter',
      onKeydown: (e) => {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault();
        const tag = e.target.value.trim().toLowerCase();
        if (tag && !(values[field.key] ?? []).includes(tag)) {
          set(field.key, [...(values[field.key] ?? []), tag]);
          render();
        }
        e.target.value = '';
      },
    });

    render();
    return h('div', { class: 'stack stack--tight' }, [input, chips]);
  }

  /* ------------------------------------------------------------ submission */

  function clearError(key) {
    const node = errorNodes.get(key);
    if (!node) return;
    node.hidden = true;
    node.textContent = '';
    controls.get(key)?.querySelector?.('input, select, textarea')?.removeAttribute('aria-invalid');
    controls.get(key)?.removeAttribute?.('aria-invalid');
  }

  function showIssues(issues) {
    for (const key of errorNodes.keys()) clearError(key);

    for (const issue of issues) {
      const node = errorNodes.get(issue.field);
      if (!node) continue;
      node.hidden = false;
      replace(node, [icon('alert', { size: 14 }), issue.message]);
      const control = controls.get(issue.field);
      const input = control?.querySelector?.('input, select, textarea') ?? control;
      input?.setAttribute?.('aria-invalid', 'true');
    }

    summary.hidden = issues.length === 0;
    if (issues.length) {
      replace(summary, [
        icon('alert', { size: 15 }),
        issues.length === 1 ? issues[0].message : `${issues.length} fields need attention.`,
      ]);
      // Take the user to the first problem rather than making them hunt.
      const first = form.querySelector(`[data-field="${issues[0].field}"] input,
        [data-field="${issues[0].field}"] select, [data-field="${issues[0].field}"] textarea`);
      focus(first);
      // Not smooth: an animated scroll means the control is still moving
      // when the next interaction arrives, and the click lands on whatever
      // has slid under the cursor.
      first?.scrollIntoView?.({ block: 'center' });
    }
  }

  async function submit() {
    const { issues } = validate(entityName, values, { currency });
    if (issues.length) {
      showIssues(issues);
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ValidationError) {
        showIssues(err.issues);
      } else {
        summary.hidden = false;
        replace(summary, [icon('alert', { size: 15 }), userMessage(err)]);
      }
    } finally {
      submitButton.disabled = false;
    }
  }

  refreshVisibility();

  return {
    node: form,
    values,
    focusFirst: () => focus(form.querySelector('input, select, textarea')),
  };
}

/* ----------------------------------------------------------------- helpers */

function defaultsFor(def) {
  const out = {};
  for (const f of def.fields) {
    if (f.default === undefined) continue;
    out[f.key] = f.default === 'today' ? today() : f.default;
  }
  return out;
}

/** One list per referenced entity, labelled by that entity's own title rule. */
async function loadReferences(def, db) {
  const wanted = new Set(def.fields
    .filter((f) => f.type === 'ref' || f.type === 'multiref')
    .map((f) => f.ref));

  const out = new Map();
  for (const name of wanted) {
    try {
      const rows = await db.repo(name).list({ decrypt: false, limit: 500 });
      out.set(name, rows.map((row) => ({
        id: row.id,
        label: String(entity(name).title(row) ?? row.id),
      })));
    } catch {
      // A role that cannot read the referenced entity gets an empty list
      // rather than a broken form.
      out.set(name, []);
    }
  }
  return out;
}

function sentence(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
