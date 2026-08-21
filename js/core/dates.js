/**
 * Dates.
 *
 * Two representations, kept apart on purpose:
 *
 *   - **Instants** — when something happened. ISO-8601 UTC with a `Z`.
 *     Used for `createdAt`, `updatedAt`, audit entries, sync cursors.
 *   - **Calendar days** — `YYYY-MM-DD`, no zone. Used for a birthday, a policy
 *     expiry, a transaction date. A passport expiring on the 3rd expires on
 *     the 3rd wherever you are standing, so these must never become instants;
 *     doing so is how a renewal reminder lands a day early in one timezone.
 *
 * Everything below that takes or returns a day works on the local calendar.
 */

const DAY_MS = 86_400_000;

export function nowIso(clock = Date.now) {
  return new Date(clock()).toISOString();
}

/** `YYYY-MM-DD` for a Date, in local time. */
export function toDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse `YYYY-MM-DD` into a local Date at midnight. */
export function fromDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Rejects 2025-02-30, which `new Date` would otherwise roll into March.
  return date.getMonth() === Number(m[2]) - 1 ? date : null;
}

export function isDay(value) {
  return fromDay(value) !== null;
}

export function today(clock = Date.now) {
  return toDay(new Date(clock()));
}

export function addDays(day, n) {
  const d = fromDay(day);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/**
 * Month arithmetic that clamps rather than overflows: one month after
 * 31 January is 28 February, not 3 March. Every EMI and premium schedule in
 * the app depends on this, so it is the one place the rule is written.
 */
export function addMonths(day, n) {
  const d = fromDay(day);
  if (!d) return null;
  const targetMonth = d.getMonth() + n;
  const anchor = new Date(d.getFullYear(), targetMonth, 1);
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  anchor.setDate(Math.min(d.getDate(), lastDay));
  return toDay(anchor);
}

/**
 * The month after this one, as `YYYY-MM`.
 *
 * Month strings rather than dates, because the things counted by month here —
 * rent received, wages paid — are counted per calendar month and never per
 * thirty days.
 */
export function nextMonth(month) {
  const [year, m] = String(month).split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

export function addYears(day, n) {
  return addMonths(day, n * 12);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from, to) {
  const a = fromDay(from);
  const b = fromDay(to);
  if (!a || !b) return NaN;
  // Compare UTC midnights so a DST boundary between the two does not
  // produce 0.958 of a day and round to the wrong integer.
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY_MS);
}

export function daysUntil(day, clock = Date.now) {
  return daysBetween(today(clock), day);
}

export function startOfMonth(day) {
  const d = fromDay(day);
  return d ? toDay(new Date(d.getFullYear(), d.getMonth(), 1)) : null;
}

export function endOfMonth(day) {
  const d = fromDay(day);
  return d ? toDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)) : null;
}

/** Indian financial year: 1 April to 31 March. */
export function startOfFinancialYear(day) {
  const d = fromDay(day);
  if (!d) return null;
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${year}-04-01`;
}

export function endOfFinancialYear(day) {
  const start = startOfFinancialYear(day);
  return start ? addDays(addYears(start, 1), -1) : null;
}

/**
 * Age in whole years on `on`, which is not `daysBetween / 365`: leap years
 * make that wrong for roughly one person in four on their birthday.
 */
export function ageOn(birthday, on = today()) {
  const b = fromDay(birthday);
  const o = fromDay(on);
  if (!b || !o) return NaN;
  let age = o.getFullYear() - b.getFullYear();
  const beforeBirthday =
    o.getMonth() < b.getMonth() ||
    (o.getMonth() === b.getMonth() && o.getDate() < b.getDate());
  if (beforeBirthday) age--;
  return age;
}

/** The next occurrence of a recurring day-of-year, from `from` forward. */
export function nextAnniversary(day, from = today()) {
  const d = fromDay(day);
  const f = fromDay(from);
  if (!d || !f) return null;
  // 29 February in a common year falls back to the 28th, matching how banks
  // and insurers treat it.
  const inYear = (year) => {
    const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
    return toDay(new Date(year, d.getMonth(), Math.min(d.getDate(), lastDay)));
  };
  const thisYear = inYear(f.getFullYear());
  return daysBetween(from, thisYear) >= 0 ? thisYear : inYear(f.getFullYear() + 1);
}

/** Inclusive `[from, to]` day range for common period names. */
export function range(period, clock = Date.now) {
  const t = today(clock);
  switch (period) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday': {
      const y = addDays(t, -1);
      return { from: y, to: y };
    }
    case 'week':
      return { from: addDays(t, -6), to: t };
    case 'month':
      return { from: startOfMonth(t), to: endOfMonth(t) };
    case 'last-month': {
      const prev = addMonths(t, -1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case 'quarter':
      return { from: startOfMonth(addMonths(t, -2)), to: endOfMonth(t) };
    case 'year':
      return { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` };
    case 'last-year': {
      const y = Number(t.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case 'financial-year':
      return { from: startOfFinancialYear(t), to: endOfFinancialYear(t) };
    case 'all':
      return { from: '0000-01-01', to: '9999-12-31' };
    default:
      return null;
  }
}

export function withinRange(day, { from, to }) {
  return isDay(day) && day >= from && day <= to;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2025-03-09` → `9 Mar 2025`. Empty string for anything unparseable. */
export function formatDay(day, { withYear = true } = {}) {
  const d = fromDay(day);
  if (!d) return '';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return withYear ? `${base} ${d.getFullYear()}` : base;
}

export function formatInstant(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDay(toDay(d))}, ${hh}:${mm}`;
}

/** "in 12 days", "3 days ago", "today". */
export function relativeDays(day, clock = Date.now) {
  const n = daysUntil(day, clock);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
