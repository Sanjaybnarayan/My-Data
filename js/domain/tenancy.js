/**
 * A tenancy, recorded twice, in two places that do not agree.
 *
 * ## The two records
 *
 * `property` carries `rented`, `tenantName`, `tenantPhone`, `monthlyRent`,
 * `deposit` and `leaseEndsOn`. There is also a whole `tenant` entity, with
 * `name`, `phone`, `monthlyRent`, `deposit` and `agreementEndsOn`, pointing at
 * a property. The same tenancy, in two shapes.
 *
 * That alone would be untidy. What makes it worth a screen is that **the
 * application reads a different one for each question**:
 *
 *   - `domain/rentreceipt.js` builds a receipt from `property.tenantName` and
 *     `property.monthlyRent`. It has never read a `tenant` record.
 *   - `reports/build.js` totals rent from `property.monthlyRent`.
 *   - The reminders derive from every `expiry` field, so **both**
 *     `property.leaseEndsOn` and `tenant.agreementEndsOn` produce one.
 *
 * So a household that fills in the tenant record and leaves the property
 * fields blank gets a lease reminder and no rent receipts. One that fills in
 * the property fields and never creates a tenant record gets receipts and no
 * agreement reminder. Neither screen has ever said so, and both households
 * believe they have recorded their tenancy.
 *
 * ## What this does not do
 *
 * It does not merge them, and it does not decide which is right. A name on the
 * property and a different name on the tenant record is two statements by the
 * same household, and only they know which one is current — one may be last
 * year's tenant nobody deleted. Guessing would be worse than asking.
 *
 * It also does not treat "no tenancy recorded" as a problem. A property that
 * is not let has nothing to reconcile, and `rented` is how a household says so.
 */

/** What a tenancy is missing, or saying twice. */
export const TENANCY = Object.freeze({
  ONLY_PROPERTY: 'onlyProperty',
  ONLY_TENANT: 'onlyTenant',
  DISAGREE: 'disagree',
  AGREE: 'agree',
  NONE: 'none',
});

const text = (value) => String(value ?? '').trim();
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();
const live = (row) => Boolean(row) && !row.deletedAt;

/**
 * Whether a property's tenancy is recorded on the property, in a tenant
 * record, in both, or in both with different facts.
 *
 * @param {object} property
 * @param {readonly object[]} tenants every tenant record
 */
export function tenancyFor(property, tenants = []) {
  const onProperty = Boolean(property?.rented)
    || Boolean(text(property?.tenantName))
    || Boolean(property?.monthlyRent);

  const records = tenants.filter((one) => live(one) && one.property === property?.id);

  if (!onProperty && !records.length) {
    return { state: TENANCY.NONE, tenants: records, differences: [] };
  }
  if (onProperty && !records.length) {
    return { state: TENANCY.ONLY_PROPERTY, tenants: records, differences: [] };
  }
  if (!onProperty && records.length) {
    return { state: TENANCY.ONLY_TENANT, tenants: records, differences: [] };
  }

  /*
   * Both. Compared field by field, and only where the property actually says
   * something — a blank on one side is not a disagreement, it is a gap, and a
   * screen that called it a conflict would cry wolf on every half-filled
   * record.
   *
   * Against *any* tenant record, not the first: a property with last year's
   * tenant still on file and this year's in a second record agrees with one of
   * them, and that is not a contradiction to put in front of somebody.
   */
  const differences = [];
  for (const [field, on, of_] of [
    ['name', property.tenantName, (t) => t.name],
    ['phone', property.tenantPhone, (t) => t.phone],
    ['monthlyRent', property.monthlyRent, (t) => t.monthlyRent],
    ['deposit', property.deposit, (t) => t.deposit],
    ['endsOn', property.leaseEndsOn, (t) => t.agreementEndsOn],
  ]) {
    if (on === null || on === undefined || text(on) === '') continue;
    const values = records.map(of_).filter((v) => v !== null && v !== undefined && text(v) !== '');
    if (!values.length) continue;
    const matches = typeof on === 'number'
      ? values.some((v) => Number(v) === Number(on))
      : values.some((v) => same(v, on));
    if (!matches) differences.push({ field, onProperty: on, onTenant: values[0] });
  }

  return {
    state: differences.length ? TENANCY.DISAGREE : TENANCY.AGREE,
    tenants: records,
    differences,
  };
}

/**
 * Every property whose tenancy is worth asking about, worst first.
 *
 * `AGREE` and `NONE` are not returned: a tenancy recorded consistently, and a
 * property that is not let, are both nothing to do.
 */
export function tenancyQuestions(properties = [], tenants = []) {
  const order = { [TENANCY.DISAGREE]: 0, [TENANCY.ONLY_PROPERTY]: 1, [TENANCY.ONLY_TENANT]: 2 };

  return properties
    .filter(live)
    .map((property) => ({ property, ...tenancyFor(property, tenants) }))
    .filter((row) => row.state in order)
    .sort((a, b) => (order[a.state] - order[b.state])
      || String(a.property.name ?? '').localeCompare(String(b.property.name ?? '')));
}

/**
 * What each case costs, so the screen can say it rather than just naming it.
 *
 * These are statements about *this application's behaviour*, which is the only
 * thing it is in a position to promise. A rent receipt is built from the
 * property's fields and a reminder from whichever record carries the date.
 */
export const CONSEQUENCE = Object.freeze({
  [TENANCY.ONLY_PROPERTY]: 'tenancy.cost.onlyProperty',
  [TENANCY.ONLY_TENANT]: 'tenancy.cost.onlyTenant',
  [TENANCY.DISAGREE]: 'tenancy.cost.disagree',
});
