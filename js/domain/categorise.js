/**
 * Categorising bank transactions.
 *
 * A bank narration is a compressed record of three separate things, and they
 * are worth keeping separate:
 *
 * - **the rail** the money moved on — UPI, IMPS, NEFT, NACH, card, ATM;
 * - **who** was at the other end — a person, a merchant, an institution, or
 *   yourself;
 * - **what it was for** — a meal, an EMI, a subscription, a loan.
 *
 * Most categorisers collapse all three into one list of keywords and then
 * cannot answer "how much did I move to people this year", because a transfer
 * to a friend and a payment to a restaurant look the same to them. So the three
 * are decided separately here, and the answers compose.
 *
 * ## The rules are ordered, and that is deliberate
 *
 * Specific rules come before general ones. `Zomato` is a restaurant before it
 * is e-commerce; `Blinkit` is quick commerce before it is groceries. Order is
 * the whole mechanism — there is no scoring, no weighting, and no model, so
 * every answer can be traced to exactly one rule that you can read.
 *
 * ## What it will get wrong
 *
 * A person is recognised by looking like a person: a name the merchant rules
 * did not claim. A shop trading under an individual's name is therefore a
 * person here, and a friend whose UPI handle is their business name is a
 * merchant. That is a real limit, not a bug to be tuned away — which is why
 * every classification carries the `rule` that produced it, and why
 * `overrides` lets a household correct one permanently.
 */

/* ------------------------------------------------------------- categories */

/**
 * `kind` decides how a category is totalled:
 *
 * - `spending`  — money genuinely leaving the household
 * - `income`    — money genuinely arriving
 * - `transfer`  — money moving between people; real, but not consumption
 * - `internal`  — the same money moving between your own pockets. Counting
 *                 these as spending is the single commonest way a statement
 *                 analysis reports twice the truth.
 */
export const CATEGORIES = [
  { key: 'restaurant', label: 'Restaurants and cafés', kind: 'spending' },
  { key: 'food-delivery', label: 'Food delivery', kind: 'spending' },
  { key: 'quick-commerce', label: 'Quick commerce', kind: 'spending' },
  { key: 'groceries', label: 'Groceries and provisions', kind: 'spending' },
  { key: 'e-commerce', label: 'Online shopping', kind: 'spending' },
  { key: 'retail', label: 'Shops and retail', kind: 'spending' },
  { key: 'hotel', label: 'Hotels and stays', kind: 'spending' },
  { key: 'travel', label: 'Travel and transport', kind: 'spending' },
  { key: 'fuel', label: 'Fuel', kind: 'spending' },
  { key: 'entertainment', label: 'Entertainment', kind: 'spending' },
  { key: 'subscription', label: 'Subscriptions', kind: 'spending' },
  { key: 'bills', label: 'Bills and utilities', kind: 'spending' },
  { key: 'healthcare', label: 'Health and pharmacy', kind: 'spending' },
  { key: 'insurance', label: 'Insurance premiums', kind: 'spending' },
  { key: 'emi', label: 'EMIs', kind: 'spending' },
  { key: 'loan-repayment', label: 'Loan repayments', kind: 'spending' },
  { key: 'credit-card', label: 'Credit card payments', kind: 'spending' },
  { key: 'tax', label: 'Tax and government', kind: 'spending' },
  { key: 'charges', label: 'Bank charges', kind: 'spending' },
  { key: 'cash', label: 'Cash withdrawn', kind: 'spending' },
  { key: 'payments', label: 'Payment apps, merchant unnamed', kind: 'spending' },
  { key: 'education', label: 'Education', kind: 'spending' },
  { key: 'other-spend', label: 'Uncategorised spending', kind: 'spending' },

  { key: 'p2p-out', label: 'Sent to people', kind: 'transfer' },
  { key: 'p2p-in', label: 'Received from people', kind: 'transfer' },

  { key: 'salary', label: 'Salary and earnings', kind: 'income' },
  { key: 'business-income', label: 'From your business', kind: 'income' },
  { key: 'refund', label: 'Refunds and reversals', kind: 'income' },
  { key: 'interest', label: 'Interest earned', kind: 'income' },
  { key: 'loan-disbursal', label: 'Loans received', kind: 'income' },
  { key: 'other-income', label: 'Uncategorised income', kind: 'income' },

  { key: 'investment-out', label: 'Invested', kind: 'internal' },
  { key: 'investment-in', label: 'Investment proceeds', kind: 'internal' },
  { key: 'self-transfer', label: 'Own accounts', kind: 'internal' },
  // Money put into a business you own has not been spent, it has been moved,
  // and totalling it as spending makes a partner look like the household's
  // largest consumer. What it actually is — capital in, drawings out — needs
  // both directions netted, which is what `businessLedger` is for.
  { key: 'business-outlay', label: 'Into your business', kind: 'internal' },
  { key: 'sweep', label: 'Sweep to and from deposits', kind: 'internal' },
];

const BY_KEY = new Map(CATEGORIES.map((category) => [category.key, category]));

export const categoryLabel = (key) => BY_KEY.get(key)?.label ?? key;
export const categoryKind = (key) => BY_KEY.get(key)?.kind ?? 'spending';

/* ----------------------------------------------------------------- rails */

/**
 * How the money moved. Kotak's own legend at the foot of a statement names
 * most of these; the rest are the prefixes it uses without explaining them.
 */
const CHANNELS = [
  { key: 'sweep', match: /^sweep|sweep transfer|FD PREMAT|^FD [A-Z]/i },
  { key: 'interest', match: /^int\.?\s?pd|interest credit/i },
  { key: 'charge', match: /^(chrg|rem[- ]|rem chrgs|charges)|:.*charges for/i },
  { key: 'upi', match: /^upi[/:]|^erupee\//i },
  { key: 'imps', match: /^(recd:imps|sentimps|imps)/i },
  { key: 'neft', match: /^neft/i },
  { key: 'rtgs', match: /^rtgs/i },
  { key: 'nach', match: /^(nach|ecs|ach)[-\s]/i },
  { key: 'card', match: /^(pcd|pci|visa|ecom|os)[/\s]/i },
  { key: 'atm', match: /^(atl|atw|nfs|cdm)[/\s]/i },
  { key: 'mobile', match: /^(mb:|spay|ib:|wb:|kb:|pb:)/i },
  { key: 'cheque', match: /^(chq|clg|cts)\b/i },
];

/** The rail a narration travelled on, or `other`. */
export function channelOf(description) {
  const text = String(description ?? '').trim();
  return CHANNELS.find((channel) => channel.match.test(text))?.key ?? 'other';
}

/* --------------------------------------------------------- counterparties */

/**
 * The other end of the transaction, pulled out of the narration.
 *
 * Every rail packs its fields differently, so each gets its own pattern rather
 * than one regex trying to cover all of them badly. Anything unmatched falls
 * back to the leading words, which is usually the payee anyway.
 */
const PARTIES = [
  // UPI, whose fields are *not* in a fixed order across banks — see `upiParty`.
  // The fallback groups every unreadable UPI narration together, which is the
  // same merge `DR` used to make by accident. The difference is the whole point:
  // this one is labelled as unnamed, so a household reading "UPI payment ×12"
  // is told the payee is missing rather than shown a stranger's name.
  { match: /^upi[-/:]/i, resolve: upiParty, fallback: 'UPI payment' },
  { match: /^erupee\/([^/]+)/i, take: 1 },
  // Recd:IMPS/<ref>/<name>/<bank>/<masked account>
  { match: /^recd:imps\/\d+\/([^/]+)/i, take: 1 },
  // SentIMPS<12-digit ref><name>/<bank ref>/<note>
  { match: /^sentimps\d{6,}([^/]+)/i, take: 1 },
  { match: /^imps[-/]\d+[-/]([^/]+)/i, take: 1 },
  // NEFT <bank ref> <NAME> NEFTINW-<n> <more name>
  { match: /^neft\s+\w+\s+(.+?)\s+NEFT(?:INW|OUT)/i, take: 1 },
  { match: /^rtgs\s+\w+\s+(.+?)\s+RTGS/i, take: 1 },
  // NACH-10-DR-<biller>-RC4- and NACH-10-DR-<mandate>-
  { match: /^nach-\d+-[dc]r-([^-\s]+)/i, take: 1 },
  // PCD/<card>/<merchant> <ref> <city><date>/<time>
  { match: /^(?:pcd|pci)\/\d+\/(.+?)(?:\s+\d{10,}|\s{2,}|$)/i, take: 1 },
  { match: /^(?:atl|atw)\/\d+\/\d+\/(.+?)(?:\s+\d{10,}|$)/i, take: 1 },
  // Kotak's mobile-banking narrations: "MB:RECEIVED FROM x", "MB:SENT TO x",
  // "MB: Sent NEFT/ x /BANK/…" — one shape with the verb swapped.
  {
    match: /^mb:\s*(?:received from|sent to|sent(?:\s+neft)?)\s*\/?\s*([^/]*)/i,
    take: 1,
    fallback: 'Mobile banking transfer',
  },
  { match: /^spay\s+(\d+)/i, take: 1, prefix: 'SPay beneficiary ', raw: true },
  { match: /^ins debit a/i, take: 0, literal: 'Insurance premium' },
  { match: /^(?:chrg|rem)[-:\s]+(.*?)(?:\s+on\s+\d|\s+for\s|\s+TBMS|$)/i, take: 1 },
  // Sweeps and interest name a deposit account number, which is noise in a
  // report; what matters is that it was the same household's own money.
  { match: /^sweep|^fd (premat|proceeds)/i, take: 0, literal: 'Fixed deposit' },
  { match: /^int\.?\s?pd/i, take: 0, literal: 'Savings interest' },
  { match: /^cc%20payment|^cc payment/i, take: 0, literal: 'Credit card' },
  { match: /^upi_cradj/i, take: 0, literal: 'UPI credit adjustment' },
  { match: /^(?:i\/w|o\/w)?\s*chq rtn|^\d+:transfer (in|out)ward/i, take: 0, literal: 'Cheque return' },
];

const NOISE = /\b(payment from ph|payment to|payment|pay to|upi ?intent|upi mandate|collect|trans(?:fer)?|ltd|limited|pvt|private|india|indian|the)\b/gi;

/** The counterparty as printed, tidied but not renamed. */
export function counterpartyOf(description) {
  // `M/S.` — Messrs, in front of half the trade names in India — carries a
  // slash, and every pattern below treats a slash as a field separator. It has
  // to go before anything else looks at the string.
  const text = String(description ?? '').replace(/\bM\/?S[./]\s*/gi, '').trim();

  for (const party of PARTIES) {
    const match = party.match.exec(text);
    if (!match) continue;
    if (party.literal) return party.literal;
    // A resolver owns the narration it matched: either its answer, or the
    // fallback that says it could not read one. Never a fall-through — the
    // patterns below belong to other rails, and letting one of them answer for
    // this narration is how a reference number became a counterparty.
    if (party.resolve) return party.resolve(text) || party.fallback || 'Unknown';
    const value = party.raw ? String(match[party.take] ?? '').trim() : tidy(match[party.take] ?? '');
    if (value) return (party.prefix ?? '') + value;
    if (party.fallback) return party.fallback;
  }

  return tidy(text.split(/\s{2,}|\s+(?=[A-Z]{2,}-?\d{6,})/)[0] ?? text) || 'Unknown';
}

/**
 * The payee in a UPI narration, wherever the bank happened to put it.
 *
 * ## Why this is not a field index
 *
 * This used to take the second field — `UPI/<name>/<ref>/<note>` — and **every
 * UPI fixture in this repository is that shape**, so the suite agreed. Two
 * layouts that are at least as common are not:
 *
 *   - `UPI/DR/<reference>/<name>/<bank>/<vpa>/<note>` — the second field is a
 *     direction indicator. Every debit read as a counterparty called `DR` and
 *     every credit as `CR`, and since `counterpartyKey` drops fragments that
 *     short, both collapsed to the single bucket `unknown`. A household on such
 *     a statement had *one* counterparty for all of its UPI activity.
 *   - `UPI/<reference>/Payment from Ph/<name>/<bank>` — the second field is the
 *     reference number, so each payment became its own counterparty, keyed by a
 *     twelve-digit number that never repeats. The opposite failure, from the
 *     same assumption.
 *
 * Neither failed loudly. They fed `peopleLedger`, `lendingLedger`, `recurring`
 * and the Insights screen, all of which group by counterparty — so one produced
 * a single bucket holding everybody and the other a bucket per payment, and
 * both rendered as confident sentences about the household's own money.
 *
 * ## What it does instead
 *
 * Walks the fields and takes the first that could be somebody's name. What
 * cannot be one is specific and checkable rather than clever: a direction
 * indicator, a bare reference, and a field that is nothing but the words a
 * narration uses to describe itself once `NOISE` is removed.
 *
 * When no field reads as a name it returns nothing rather than the least-bad
 * field. **A wrong name is a claim; a missing one is a gap** — the rule the
 * receipt reader was built on, and the same one applies here, because a wrong
 * counterparty does not merely fail to group, it groups two strangers together.
 */
function upiParty(text) {
  const [, separator, body] = /^upi([-/:])\s*(.*)$/is.exec(text) ?? [];
  if (!body) return null;

  // The separator the narration actually used. `UPI-NETFLIX ENTERTAINMENT-...`
  // packs its fields with dashes and `UPI/DR/...` with slashes; splitting on
  // both would cut a hyphenated handle in half.
  const fields = body.split(separator === '-' ? '-' : '/');

  for (const field of fields) {
    const name = upiName(field);
    if (name) return name;
  }

  // Nothing that reads as a name. A VPA is the last thing in the narration that
  // identifies anybody — `netflix.payu@hdfcbank` is not a name, but its local
  // part is what the payee calls itself, and it groups correctly across months.
  for (const field of fields) {
    const [, handle] = /^([a-z0-9][a-z0-9._-]*)@[a-z]/i.exec(String(field).trim()) ?? [];
    // A phone number with a suffix — `8861975785-3@axl` — is a VPA whose local
    // part is an account, not a name. It would group correctly and read as
    // nonsense, so it is left for the fallback that says so.
    if (handle && !/^\d+$/.test(handle.replace(/[._-]/g, ''))) {
      return tidy(handle.replace(/[._]/g, ' '));
    }
  }

  return null;
}

/** One UPI field, if it could be somebody's name. */
function upiName(field) {
  const raw = String(field ?? '').trim();
  if (!raw) return null;
  // A direction, not a payee.
  if (/^[dc]r$/i.test(raw)) return null;
  // A reference number. Not `tidy`'s job: it keeps a bare id deliberately,
  // because a NACH mandate is only an id and that id is the biller.
  if (/^[\d\s-]+$/.test(raw)) return null;
  // A VPA is considered only after every field has failed to be a name.
  if (raw.includes('@')) return null;

  const value = tidy(raw);
  if (!value) return null;
  // A field that is only the narration describing itself — "Payment from Ph",
  // "Collect", "Transfer" — is not a name. `NOISE` already lists those words
  // because `counterpartyKey` has to ignore them when grouping; a field made of
  // nothing else is the same judgement, one step earlier.
  return value.replace(NOISE, ' ').replace(/[^a-z0-9]+/gi, ' ').trim() ? value : null;
}

function tidy(value) {
  const words = String(value)
    .replace(/[\\/]+$/, '')
    .replace(/^dis[-\s]+/i, '')
    .split(/\s+/)
    .filter(Boolean);

  // Reference numbers are the bulk of a narration and none of its meaning:
  // anything carrying a run of six digits, and any bare number sitting beside
  // a name. Dropping every word is going too far, though — a NACH mandate is
  // *only* an id, and that id is the one thing identifying the biller.
  const named = words.filter((word) => !/\d{5,}/.test(word) && !/^\d+$/.test(word));
  const kept = named.length ? named : words;

  return kept.join(' ').replace(/\s+/g, ' ').trim().replace(/^[-:,\s]+|[-:,\s]+$/g, '');
}

/**
 * A stable key for grouping, so `ZOMATO`, `Zomato` and `Zomato Ltd` are one
 * counterparty rather than three rows in a report.
 */
export function counterpartyKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/^dis[-\s]+/, '')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    // Initials are written every way a person can write them — "SANJAY B N",
    // "SANJAY BN", "SANJAY B.N." — and keeping them splits one counterparty
    // into three rows. Dropping short vowel-less fragments keeps the given
    // name, which is what a report is grouping by anyway.
    .filter((word) => word.length > 2 || /[aeiou]/.test(word))
    .slice(0, 3)
    .join(' ') || 'unknown';
}

/* ------------------------------------------------------------------ rules */

/**
 * Matched in order. The first rule that matches wins, and its `key` is
 * recorded on the transaction so any classification can be traced back to the
 * one line that caused it.
 */
export const RULES = [
  // Internal first: money moving between your own pockets is not spending, and
  // mistaking it for spending is what makes an analysis report double.
  { key: 'sweep', out: 'sweep', in: 'sweep', match: /^sweep|FD PREMAT|term deposit/i },
  { key: 'interest', out: 'charges', in: 'interest', match: /^int\.?\s?pd|interest (credit|paid)/i },
  { key: 'reversal', out: 'other-spend', in: 'refund', match: /^rev\b|reversal|refund|cashback|^dis\b|upi_cradj|chq rtn|cheque return|transfer inward/i },
  { key: 'charges', out: 'charges', in: 'refund', match: /^(chrg|charges|rem[-\s]|rem chrgs)|annual fee|ecs (return|mandate)|sms charges|bal alerts|dcc fee|chq issue/i },

  { key: 'broker', out: 'investment-out', in: 'investment-in', match: /zerodha|groww|upstox|angel ?one|icici ?direct|kite|smallcase|nsdl|cdsl|indian clearing/i },
  { key: 'mutual-fund', out: 'investment-out', in: 'investment-in', match: /mutual fund|\bamc\b|\bsip\b|bandhan|nippon|hdfc mf|axis mf|parag parikh|quant mf|billdesk mf/i },

  { key: 'vehicle-loan', out: 'emi', in: 'loan-disbursal', match: /kotakmahprime|mahindra prime|car ?emi|vehicle loan|auto loan/i },
  { key: 'bnpl', out: 'emi', in: 'loan-disbursal', match: /snapmint|simpl|lazypay|zestmoney|paylater|amazon pay later/i },
  { key: 'lender', out: 'loan-repayment', in: 'loan-disbursal', match: /truecredit|true credits|dreamplug|\bcred\b|muthoot|bajaj fin|kreditbee|moneyview|navi |fibe|earlysalary|slice|paisabazaar|smartcoin|indiagold|kissht|creva capital|loanamt|loan a.?.c|pyt loan|gold loan|personal loan/i },
  { key: 'credit-card', out: 'credit-card', in: 'refund', match: /cc%20payment|cc payment|creditcard|credit card|visaccpay|card payment|bbps.*card/i },

  { key: 'insurance', out: 'insurance', in: 'other-income', match: /^ins\s|insurance|max life|lic |hdfc life|policybazaar|acko|digit|star health|kcfc|spln/i },

  { key: 'quick-commerce', out: 'quick-commerce', in: 'refund', match: /blinkit|zepto|grofers|instamart|dunzo|country ?delight|bigbasket|swiggy ?instamart|licious|milkbasket/i },
  { key: 'food-delivery', out: 'food-delivery', in: 'refund', match: /zomato|swiggy|eternal limited|ubereats|dominos|domino'?s|pizza hut|kfc|mcdonald|faasos|box8|behrouz/i },
  { key: 'restaurant', out: 'restaurant', in: 'refund', match: /restaurant|\brest\b|resto|\bcafe\b|coffee|starbucks|barista|chaayos|bakery|darshini|dhaba|kitchen|biryani|juice|donut|ice ?cream|\bbar and\b|\bbar &|beer works|brewery|brew ?works|\bpub\b|bistro|grill|food court|\bfood\b|eatery|\beats?\b|foods\b|mess\b|tiffin|lunch|dinner|canteen|sweets?\b|namkeen/i },
  { key: 'hotel', out: 'hotel', in: 'refund', match: /hotel|\binn\b|resort|residency|lodge|oyo|treebo|fabhotel|airbnb|guest ?house|stays?\b/i },
  { key: 'travel', out: 'travel', in: 'refund', match: /makemytrip|goibibo|cleartrip|ixigo|irctc|redbus|indigo|air ?india|vistara|spicejet|\buber\b|\bola\b|rapido|confirm ?ticket|yatra|abhibus|toll|fastag|parking|railway|metro rail|bmtc|ksrtc/i },
  { key: 'fuel', out: 'fuel', in: 'refund', match: /fuel|petrol|\bhpcl?\b|indian ?oil|\biocl?\b|bharat petroleum|\bbpcl\b|\bshell\b|nayara|filling station|petro/i },

  { key: 'entertainment', out: 'entertainment', in: 'refund', match: /pvr|inox|bookmyshow|cinema|multiplex|entertainment|netflix|hotstar|sonyliv|zee5|dream ?11|dream ?fuel|gaming|playstation|steam ?games/i },
  { key: 'subscription', out: 'subscription', in: 'refund', match: /upi mandate|apple media|apple\.com|itunes|google (play|india di|workspace)|sqsp\*|squarespace|godaddy|namecheap|hostinger|digitalocean|vercel|netlify|\bgithub\b|spotify|youtube ?premium|prime video|adobe|microsoft 365|openai|chatgpt|anthropic|claude|subscription|autopay|mandate/i },

  { key: 'telecom', out: 'bills', in: 'refund', match: /\bjio\b|airtel|vodafone|\bvi\b recharge|\bbsnl\b|recharge|broadband|act fibernet|hathway|dth|tata ?play/i },
  { key: 'utility', out: 'bills', in: 'refund', match: /bescom|electricity|\bkptcl\b|water board|\bbwssb\b|gas |indane|\bhp gas\b|municipal|property tax|maintenance|society|rent\b/i },
  { key: 'tax', out: 'tax', in: 'refund', match: /goods and servi|\bgst\b|income tax|\bcbdt\b|\btds\b|challan|passport|\brto\b|e-?challan|traffic fine/i },

  { key: 'healthcare', out: 'healthcare', in: 'refund', match: /pharma|apollo|medplus|hospital|clinic|diagnostic|\blab\b|medical|dental|netmeds|pharmeasy|1mg|wellness/i },
  { key: 'education', out: 'education', in: 'refund', match: /school|college|university|educational|tuition|course|udemy|coursera|byju|unacademy|vedantu|academy|institute|exam fee/i },

  { key: 'groceries', out: 'groceries', in: 'refund', match: /reliance retail|\bdmart\b|d.?mart|more retail|spar |metro cash|shoprite|stop and shop|supermarket|super ?market|provision|kirana|fresh ?mart|\bmart\b/i },
  { key: 'e-commerce', out: 'e-commerce', in: 'refund', match: /amazon|flipkart|myntra|ajio|nykaa|meesho|snitch|allen solly|madura garments|arvind fashions|bata|\bpuma\b|adidas|nike|decathlon|lifestyle|shoppers stop|westside|\bmax\b|tata cliq|firstcry|pepperfry|urban ?ladder|ikea|croma|reliance digital|boat |noise |apparel|fashion|clothing|garments|footwear/i },
  { key: 'retail', out: 'retail', in: 'refund', match: /retail|stores?\b|traders?\b|enterprises|agencies|\bshop\b|emporium|\bmall\b|salon|spa\b|barber|laundry|tailor/i },

  { key: 'cash', out: 'cash', in: 'other-income', match: /^(atl|atw|nfs)[/\s]|atm withdrawal|cash (dep|wdl)|\bcdm\b/i },

  // A NACH direct debit that no named rule claimed is still a standing
  // instruction: a loan, a premium or a SIP. Calling it an EMI is right far
  // more often than leaving it uncategorised, and it comes last so every
  // rule that can name the biller has already had its turn.
  { key: 'nach-mandate', out: 'emi', in: 'refund', match: /^nach-\w+-[dc]r-|^ach[-\s]|ecs debit/i },

  // Payment aggregators say how the money moved, not what it bought. They come
  // last so a named merchant behind them wins first, and they get their own
  // category rather than being called uncategorised: "we know it was a payment
  // and not what for" is a different fact from "we have no idea".
  { key: 'aggregator', out: 'payments', in: 'other-income', match: /razorpay|payu|billdesk|cashfree|ccavenue|paytm|phonepe|google ?pay|\bbhim\b|amazon ?pay|mobikwik|freecharge/i },
];

/* ------------------------------------------------------------ classifying */

/**
 * Names that mean "this is me". A transfer to your own second account is not
 * spending, and at UPI volumes it is easily the largest single distortion in
 * an uncorrected total.
 */
function isSelf(name, holder) {
  if (!holder) return false;
  const words = (text) => new Set(counterpartyKey(text).split(' ').filter((word) => word.length > 1));
  const mine = words(holder);
  const theirs = words(name);
  if (!mine.size || !theirs.size) return false;
  const shared = [...theirs].filter((word) => mine.has(word)).length;
  return shared >= Math.min(2, mine.size);
}

/**
 * A business the household owns or runs.
 *
 * This is the one fact no rule can derive. A firm's account looks exactly like
 * a stranger's — a name, money going both ways — and until somebody says "that
 * one is mine", every honest classifier has to call it a third party. Which is
 * why it is stated rather than guessed, and why it wins over the rules: an
 * owner knows, and no keyword does.
 */
function isOwnBusiness(name, businesses) {
  const key = counterpartyKey(name);
  return (businesses ?? []).some((business) => {
    const theirs = counterpartyKey(business);
    return Boolean(theirs) && (key === theirs || key.startsWith(theirs) || theirs.startsWith(key));
  });
}

/**
 * Whether a counterparty reads as a person rather than a business.
 *
 * A person has a name: two or three words of letters, no company suffix, no
 * digits, no trade words. It is a heuristic and it is stated as one — the
 * merchant rules run first precisely so that anything recognisable is never
 * left to this test.
 */
const COMPANY = /\b(ltd|limited|pvt|private|llp|inc|corp|company|co|services?|solutions?|technologies|tech|enterprises?|traders?|stores?|retail|industries|agencies|bank|finance|financial|capital|foundation|trust|society|association|india|online|digital|systems?|labs?|works?|global|international|holdings?|ventures?|group|apparels?|fashions?|foods?|hotels?|motors?)\b/i;

export function looksLikePerson(name) {
  const value = String(name ?? '').trim();
  if (!value || /\d/.test(value)) return false;
  if (COMPANY.test(value)) return false;

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  return words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word))
    && words.some((word) => word.replace(/[^A-Za-z]/g, '').length >= 3);
}

/**
 * Classify one transaction.
 *
 * @param {{description: string, direction: 'in'|'out', amount: number, date: string}} transaction
 * @param {{holder?: string, businesses?: string[], overrides?: Record<string, string>}} [options]
 *   `businesses` names the firms the household owns, so money from them is
 *   read as earnings and money into them as capital rather than spending.
 *   `overrides` maps a counterparty key to a category key, and wins over every
 *   rule — a household correcting one name should not have to edit this file.
 * @returns {object} the transaction with `channel`, `category`, `counterparty`,
 *   `counterpartyKey`, `counterpartyKind`, `isP2P` and `rule` added
 */
export function classify(transaction, options = {}) {
  const { holder = '', businesses = [], overrides = {} } = options;
  const text = String(transaction.description ?? transaction.raw ?? '');
  const direction = transaction.direction === 'in' ? 'in' : 'out';

  const channel = channelOf(text);
  const counterparty = counterpartyOf(text);
  const key = counterpartyKey(counterparty);

  const matched = RULES.find((rule) => rule.match.test(text) || rule.match.test(counterparty));
  const self = isSelf(counterparty, holder);
  const own = !self && isOwnBusiness(counterparty, businesses);
  const person = !matched && !self && !own && looksLikePerson(counterparty);

  let category;
  let rule;

  if (overrides[key]) {
    category = overrides[key];
    rule = 'override';
  } else if (self) {
    category = 'self-transfer';
    rule = 'self';
  } else if (own) {
    // Both directions are real and neither is consumption: what comes out of
    // a firm you own is what you earned from it, and what goes in is capital.
    category = direction === 'in' ? 'business-income' : 'business-outlay';
    rule = 'own-business';
  } else if (matched) {
    category = matched[direction];
    rule = matched.key;
  } else if (person) {
    category = direction === 'in' ? 'p2p-in' : 'p2p-out';
    rule = 'person';
  } else {
    category = direction === 'in' ? 'other-income' : 'other-spend';
    rule = 'unmatched';
  }

  return {
    ...transaction,
    direction,
    channel,
    counterparty,
    counterpartyKey: key,
    counterpartyKind: self ? 'self' : own ? 'business' : person ? 'person'
      : matched ? 'merchant' : 'unknown',
    isP2P: category === 'p2p-in' || category === 'p2p-out',
    category,
    categoryKind: categoryKind(category),
    rule,
  };
}

/** Classify a whole statement. */
export function categorise(transactions, options = {}) {
  const classified = (transactions ?? []).map((transaction) => classify(transaction, options));
  return options.aliases === false ? classified : resolveAliases(classified);
}

/**
 * Fold truncated counterparty names into their full form.
 *
 * IMPS and NEFT narrations clip the beneficiary name to whatever fits — the
 * same lender arrives as `MUTHOOT`, `MUTHOOT FI` and `MUTHOOTFIN` in one
 * statement, and a report that lists them separately hides the size of the
 * relationship. So a key that is a prefix of a longer key is merged into it.
 *
 * Two conditions keep that safe, and both matter:
 *
 * - The prefix must be at least six characters, so `cred` never disappears
 *   into `credit card`.
 * - The prefix must end *inside* a word of the longer name. Truncation cuts
 *   mid-word — `MUTHOOT FI` out of `MUTHOOT FINANCE` — whereas a longer name
 *   that merely starts with a shorter one is a different party: `SANJAY` and
 *   `SANJAY KUMAR CH` are two people, and merging them would put one person's
 *   money in another's ledger.
 */
export function resolveAliases(transactions, { minimumPrefix = 6 } = {}) {
  // Names, not keys. The grouping key deliberately drops initials so that
  // "SANJAY B N" and "SANJAY BN" meet, and that same step would erase the
  // evidence of truncation — `ZERODHA BR` loses the `BR` that shows it was cut
  // out of `ZERODHA BROKING`.
  const names = new Map();
  for (const t of transactions) {
    const held = names.get(t.counterpartyKey);
    if (!held || t.counterparty.length > held.length) names.set(t.counterpartyKey, t.counterparty);
  }

  const flat = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const words = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const keys = [...names.keys()];
  const canonical = new Map();

  for (const key of keys) {
    const short = flat(names.get(key));
    if (short.length < minimumPrefix) continue;

    const longest = keys
      .filter((other) => other !== key
        && flat(names.get(other)).startsWith(short)
        && flat(names.get(other)).length > short.length
        && truncates(short, words(names.get(other))))
      .sort((a, b) => flat(names.get(b)).length - flat(names.get(a)).length)[0];

    if (longest) canonical.set(key, longest);
  }

  // A chain — `muthoot` → `muthootfi` → `muthootfinance` — must land on the
  // end of it, not one step along.
  const resolve = (key, depth = 0) => {
    const next = canonical.get(key);
    return next && depth < 8 ? resolve(next, depth + 1) : key;
  };

  return transactions.map((t) => {
    const key = resolve(t.counterpartyKey);
    return key === t.counterpartyKey ? t : { ...t, counterpartyKey: key };
  });
}

/**
 * Whether `short` looks like `long` with the end cut off mid-word, rather than
 * like a shorter name that `long` happens to begin with.
 */
function truncates(flatShort, longWords) {
  let consumed = 0;
  for (const word of longWords) {
    if (consumed >= flatShort.length) return false;
    // The cut landed inside this word: a truncation.
    if (consumed + word.length > flatShort.length) return true;
    consumed += word.length;
  }
  return false;
}

/* -------------------------------------------------------------- summaries */

const total = (list) => list.reduce((sum, t) => sum + t.amount, 0);

/**
 * Everything a report needs, computed once.
 *
 * The headline deliberately separates the four kinds. "Money out" that lumps
 * a sweep to a deposit in with a restaurant bill is a number nobody can act
 * on; splitting them is the difference between a statement and an insight.
 */
export function summarise(transactions) {
  const list = transactions ?? [];
  const income = list.filter((t) => t.direction === 'in');
  const outgo = list.filter((t) => t.direction === 'out');

  const kind = (k, direction) => list.filter((t) => t.categoryKind === k && t.direction === direction);

  return {
    count: list.length,
    period: { from: list.at(0)?.date ?? null, to: list.at(-1)?.date ?? null },

    moneyIn: total(income),
    moneyOut: total(outgo),
    net: total(income) - total(outgo),

    spending: total(kind('spending', 'out')),
    transfersOut: total(kind('transfer', 'out')),
    transfersIn: total(kind('transfer', 'in')),
    realIncome: total(kind('income', 'in')),
    internalOut: total(kind('internal', 'out')),
    internalIn: total(kind('internal', 'in')),

    byCategory: group(list, (t) => t.category, (key) => ({
      label: categoryLabel(key), kind: categoryKind(key),
    })),
    byChannel: group(list, (t) => t.channel),
    byCounterparty: group(list, (t) => t.counterpartyKey, (key, rows) => ({
      name: fullest(rows.map((t) => t.counterparty)),
      kind: rows[0].counterpartyKind,
    })),
    byMonth: group(list, (t) => String(t.date).slice(0, 7)),
    byDayOfWeek: group(list, (t) => new Date(`${t.date}T00:00:00Z`).getUTCDay()),
  };
}

/** Sum in, out and count for each key, largest total flow first. */
function group(list, keyOf, extra = () => ({})) {
  const buckets = new Map();

  for (const t of list) {
    const key = String(keyOf(t));
    const bucket = buckets.get(key)
      ?? { key, count: 0, in: 0, out: 0, first: t.date, last: t.date, rows: [] };
    bucket.count += 1;
    bucket[t.direction] += t.amount;
    if (t.date < bucket.first) bucket.first = t.date;
    if (t.date > bucket.last) bucket.last = t.date;
    bucket.rows.push(t);
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, net: bucket.in - bucket.out, ...extra(bucket.key, bucket.rows) }))
    .sort((a, b) => (b.in + b.out) - (a.in + a.out));
}

function commonest(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * The most complete spelling of a name in a group. Once truncated aliases are
 * merged the group holds `MUTHOOT`, `MUTHOOT FI` and `Muthoot Finance`, and
 * the longest of those is the one a person recognises.
 */
function fullest(values) {
  return [...new Set(values)].sort((a, b) => b.length - a.length)[0] ?? '';
}

/**
 * The person-to-person ledger: for every individual, what went out, what came
 * back, and where the balance sits.
 *
 * This is the view a statement will not give you. A UPI-heavy account has
 * hundreds of transfers to a few dozen people, and the only question that
 * matters — who is up and who is down — needs both directions netted per
 * person, not a list sorted by date.
 */
export function peopleLedger(transactions) {
  const people = group(
    (transactions ?? []).filter((t) => t.isP2P),
    (t) => t.counterpartyKey,
    (key, rows) => ({ name: commonest(rows.map((t) => t.counterparty)) }),
  );

  return people
    .map((person) => ({
      ...person,
      sent: person.out,
      received: person.in,
      balance: person.in - person.out,
      // Both directions and more than a handful of exchanges: money going
      // back and forth is a lending relationship, not a series of gifts.
      reciprocal: person.in > 0 && person.out > 0,
    }))
    .sort((a, b) => (b.sent + b.received) - (a.sent + a.received));
}

/**
 * The partner's current account, read off a personal statement.
 *
 * For somebody who runs a business, the personal account is one half of a
 * two-way ledger with the firm: capital and expenses go in, drawings come out.
 * Neither side is spending and neither side alone means anything — the number
 * that matters is the net, which is what the business owes the household or
 * the household owes the business.
 *
 * No bank statement will tell you this, and adding up the credits alone gets
 * it badly wrong in the direction that flatters.
 */
export function businessLedger(transactions) {
  const rows = (transactions ?? []).filter((t) => t.counterpartyKind === 'business');

  return group(rows, (t) => t.counterpartyKey, (key, all) => ({
    name: fullest(all.map((t) => t.counterparty)),
  }))
    .map((bucket) => ({
      ...bucket,
      drawn: bucket.in,
      contributed: bucket.out,
      // Positive: the household has taken more out than it put in.
      net: bucket.in - bucket.out,
      months: new Set(bucket.rows.map((t) => t.date.slice(0, 7))).size,
    }))
    .sort((a, b) => (b.drawn + b.contributed) - (a.drawn + a.contributed));
}

/**
 * Amounts that repeat on a schedule — subscriptions, EMIs, standing payments.
 *
 * A repeating charge is found by shape rather than by name: three or more
 * payments to the same counterparty, at a steady interval, for much the same
 * amount. That catches the subscription you forgot the name of, which is the
 * only kind worth surfacing.
 *
 * @param {object[]} transactions
 * @param {{minimumOccurrences?: number, tolerance?: number, asOf?: string|null}} [options]
 *   `asOf` is the day to judge `active` against. Omitted, the run reports
 *   `active: null` rather than guessing from the clock — a report built for a
 *   past period should not call a charge live because today is a Tuesday.
 */
export function recurring(transactions, options = {}) {
  const { minimumOccurrences = 3, tolerance = 0.2, asOf = null } = options;
  const found = [];

  for (const bucket of group((transactions ?? []).filter((t) => t.direction === 'out'), (t) => t.counterpartyKey)) {
    const rows = [...bucket.rows].sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < minimumOccurrences) continue;

    const amounts = rows.map((row) => row.amount);
    const median = amounts.slice().sort((a, b) => a - b)[Math.floor(amounts.length / 2)];
    const steady = amounts.filter((amount) => Math.abs(amount - median) <= median * tolerance);
    if (steady.length < minimumOccurrences) continue;

    const gaps = rows.slice(1).map((row, index) => days(rows[index].date, row.date));
    const cadence = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    if (!cadence || cadence < 5 || cadence > 400) continue;

    found.push({
      key: bucket.key,
      name: fullest(rows.map((row) => row.counterparty)),
      category: commonest(rows.map((row) => row.category)),
      occurrences: rows.length,
      amount: median,
      spent: bucket.out,
      cadenceDays: cadence,
      period: cadence <= 9 ? 'weekly' : cadence <= 45 ? 'monthly' : cadence <= 100 ? 'quarterly' : 'yearly',
      first: rows[0].date,
      last: rows.at(-1).date,
      // A run that stopped more than two cadences ago has probably ended.
      // Calling it "still active" is the alert nobody can act on.
      active: asOf ? days(rows.at(-1).date, asOf) <= cadence * 2 : null,
    });
  }

  return found.sort((a, b) => b.spent - a.spent);
}

function days(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Borrowing and lending, both directions, per counterparty.
 *
 * Loans through apps and loans between friends are the same shape — money out
 * and money back — so both are tracked the same way. The `outstanding` figure
 * is what has not come back yet, which is the number a household actually
 * wants and no bank statement will tell it.
 */
export function lendingLedger(transactions) {
  const relevant = (transactions ?? []).filter((t) => t.category === 'loan-disbursal'
    || t.category === 'loan-repayment'
    || t.category === 'emi'
    || (t.isP2P));

  return group(relevant, (t) => t.counterpartyKey, (key, rows) => ({
    name: fullest(rows.map((t) => t.counterparty)),
    kind: rows.some((t) => t.category === 'emi' || t.category === 'loan-repayment' || t.category === 'loan-disbursal')
      ? 'institution' : 'person',
  }))
    .map((bucket) => ({
      ...bucket,
      borrowed: bucket.in,
      repaid: bucket.out,
      outstanding: bucket.in - bucket.out,
    }))
    .filter((bucket) => bucket.borrowed > 0 || bucket.kind === 'institution')
    .sort((a, b) => Math.abs(b.outstanding) - Math.abs(a.outstanding));
}

/**
 * Anything about the period worth saying out loud.
 *
 * Every insight is a fact with its arithmetic attached, not an opinion. The
 * threshold for saying something is that it would change a decision.
 */
export function insights(transactions, summary = summarise(transactions)) {
  const notes = [];
  const list = transactions ?? [];
  const months = Math.max(1, summary.byMonth.length);

  if (summary.net < 0) {
    notes.push({
      kind: 'balance',
      text: `Over ${months} month${months === 1 ? '' : 's'} more left the account than came in.`,
      amount: summary.net,
    });
  }

  const uncategorised = list.filter((t) => t.rule === 'unmatched' && t.direction === 'out');
  if (uncategorised.length) {
    notes.push({
      kind: 'coverage',
      text: `${uncategorised.length} payments could not be categorised from the narration alone.`,
      amount: total(uncategorised),
    });
  }

  const top = summary.byCategory.filter((c) => c.kind === 'spending' && c.out > 0)[0];
  if (top) {
    notes.push({
      kind: 'largest-category',
      text: `${top.label} is the largest spending category, ${share(top.out, summary.spending)} of all spending.`,
      amount: top.out,
    });
  }

  const subs = recurring(list).filter((r) => r.category === 'subscription' || r.period === 'monthly');
  if (subs.length) {
    notes.push({
      kind: 'recurring',
      text: `${subs.length} payments repeat on a schedule, ${format(subs.reduce((sum, s) => sum + s.amount, 0))} a cycle.`,
      amount: subs.reduce((sum, s) => sum + s.spent, 0),
    });
  }

  const cash = summary.byCategory.find((c) => c.key === 'cash');
  if (cash && cash.out > summary.spending * 0.05) {
    notes.push({
      kind: 'cash',
      text: `${share(cash.out, summary.spending)} of spending left as cash, where it stops being traceable.`,
      amount: cash.out,
    });
  }

  const charges = summary.byCategory.find((c) => c.key === 'charges');
  if (charges?.out) {
    notes.push({
      kind: 'charges',
      text: `${charges.count} bank charges over the period — most are avoidable.`,
      amount: charges.out,
    });
  }

  // Five thousand rupees, in paise. Below that a one-sided balance is a meal
  // somebody paid for, not something anybody is keeping track of.
  const worthChasing = 500_000;
  const owed = peopleLedger(list).filter((person) => person.balance < -worthChasing);
  if (owed.length) {
    notes.push({
      kind: 'p2p',
      text: `${owed.length} people have taken more from this account than has come back.`,
      amount: -owed.reduce((sum, person) => sum + person.balance, 0),
    });
  }

  const payments = summary.byCategory.find((c) => c.key === 'payments');
  if (payments?.out) {
    notes.push({
      kind: 'payments',
      text: `${payments.count} payments went through an app that did not name the merchant.`,
      amount: payments.out,
    });
  }

  return notes;
}

const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '0%');
const format = (minor) => `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
