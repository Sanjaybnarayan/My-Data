/**
 * English, for a period that is not over yet.
 *
 * A separate file for the same reason as `en-signin.js` and `en-tradebook.js`:
 * `en.js` is the catalogue, this is a block that changes with one idea, and
 * the module-size ratchet holds `en.js` under 800 lines.
 *
 * Every sentence here exists because a month in progress was being compared
 * with a month that finished. The words matter more than usual: "vs last
 * month" over a comparison with eleven days of last month is a caption that
 * makes a correct number mean the wrong thing, which is worse than no caption.
 * So each one names the span it actually covers.
 */

export const periodStrings = {
  // `{month}` arrives already abbreviated — "Aug", not "August" — because a
  // chart axis has one bar's width to fit it in.
  'chart.monthSoFar': '{month} so far',
  'chart.partialMonth': '{month} is not over — its bar is the month so far.',

  'compare.vsLastMonth': 'vs last month',
  'compare.vsSameDays': 'vs the same days last month',

  // The whole sentence per key, as `en.js` sets out: a language that puts the
  // verb last cannot be served by gluing a percentage to a fragment.
  'summary.spend.above': 'Spending is {pct}% above last month, at {amount}.',
  'summary.spend.below': 'Spending is {pct}% below last month, at {amount}.',
  'summary.spend.above.soFar':
    'Spending is {pct}% above the same days of last month, at {amount}.',
  'summary.spend.below.soFar':
    'Spending is {pct}% below the same days of last month, at {amount}.',
  'summary.spend.soFar': '{amount} spent so far this month.',
};
