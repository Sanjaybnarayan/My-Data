/**
 * The places a household actually spends money, and how to recognise them.
 *
 * ## Why this is a registry and not a set of integrations
 *
 * Zomato, Swiggy, Amazon, Flipkart, Blinkit and Zepto have no consumer API. No
 * "sign in with Zomato", no OAuth, no endpoint that returns your orders. The
 * only ways to get order history out of them are to drive their websites with
 * your password, or to read the receipts they email you.
 *
 * Driving their websites would mean this application holding the credentials to
 * every account a household owns, in an application whose entire premise is
 * that it holds *less* than you would expect. It would also break every time a
 * login page changed, and violate the terms of each service. It is not a
 * trade-off worth making and it is not made here.
 *
 * The receipts are the real seam. Every one of these services sends an email
 * for every order, from a stable address, with the total in it. Gmail *does*
 * have an API, it is the household's own mailbox, and one integration covers
 * every merchant at once — including the ones nobody thought to add.
 *
 * So a merchant here is a *recognition rule*, not a connection: the addresses
 * it mails from, the words that identify its receipts, and the category its
 * spending belongs to. The same registry names merchants on a bank statement,
 * so the two views agree on what "Zomato" means.
 */

/**
 * `senders` are matched against the From address, `subject` against the
 * subject line. A merchant needs one of them, not both — some services mail
 * from a shifting set of subdomains and are better identified by what they
 * write, and some send everything from one address.
 */
export const MERCHANTS = [
  /* ------------------------------------------------------- food delivery */
  {
    key: 'zomato',
    name: 'Zomato',
    category: 'food-delivery',
    senders: [/@zomato\.com$/i],
    subject: /order|delivered|invoice/i,
  },
  {
    key: 'swiggy',
    name: 'Swiggy',
    category: 'food-delivery',
    senders: [/@swiggy\.(in|com)$/i],
    subject: /order|delivered|invoice/i,
  },

  /* -------------------------------------------------------- quick commerce */
  {
    key: 'blinkit',
    name: 'Blinkit',
    category: 'quick-commerce',
    senders: [/@blinkit\.com$/i, /@grofers\.com$/i],
  },
  {
    key: 'zepto',
    name: 'Zepto',
    category: 'quick-commerce',
    senders: [/@zepto(now)?\.com$/i, /@geddit\.co\.in$/i],
  },
  {
    key: 'bigbasket',
    name: 'BigBasket',
    category: 'quick-commerce',
    senders: [/@bigbasket\.com$/i],
  },
  {
    key: 'countrydelight',
    name: 'Country Delight',
    category: 'quick-commerce',
    senders: [/@countrydelight\.in$/i],
  },

  /* ------------------------------------------------------------ commerce */
  {
    key: 'amazon',
    name: 'Amazon',
    category: 'e-commerce',
    senders: [/@amazon\.(in|com)$/i],
    subject: /ordered|dispatched|delivered|invoice|your order/i,
  },
  {
    key: 'flipkart',
    name: 'Flipkart',
    category: 'e-commerce',
    senders: [/@flipkart\.com$/i, /@rmail\.flipkart\.com$/i],
  },
  {
    key: 'myntra',
    name: 'Myntra',
    category: 'e-commerce',
    senders: [/@myntra\.com$/i],
  },
  {
    key: 'nykaa',
    name: 'Nykaa',
    category: 'e-commerce',
    senders: [/@nykaa\.com$/i],
  },
  {
    key: 'ajio',
    name: 'AJIO',
    category: 'e-commerce',
    senders: [/@ajio\.com$/i],
  },

  /* --------------------------------------------------------- travel, rides */
  {
    key: 'uber',
    name: 'Uber',
    category: 'travel',
    senders: [/@uber\.com$/i],
  },
  {
    key: 'ola',
    name: 'Ola',
    category: 'travel',
    senders: [/@olacabs\.com$/i],
  },
  {
    key: 'makemytrip',
    name: 'MakeMyTrip',
    category: 'travel',
    senders: [/@makemytrip\.com$/i],
  },
  {
    key: 'irctc',
    name: 'IRCTC',
    category: 'travel',
    senders: [/@irctc\.co\.in$/i],
  },

  /* ------------------------------------------------------- subscriptions */
  {
    key: 'google',
    name: 'Google',
    category: 'subscription',
    senders: [/payments-noreply@google\.com$/i, /@google\.com$/i],
    subject: /subscription|your (google|youtube)|receipt|payment/i,
    recurring: true,
  },
  {
    key: 'apple',
    name: 'Apple',
    category: 'subscription',
    senders: [/@(email\.)?apple\.com$/i],
    subject: /receipt|subscription|your invoice/i,
    recurring: true,
  },
  {
    key: 'netflix',
    name: 'Netflix',
    category: 'subscription',
    senders: [/@netflix\.com$/i],
    recurring: true,
  },
  {
    key: 'spotify',
    name: 'Spotify',
    category: 'subscription',
    senders: [/@spotify\.com$/i],
    recurring: true,
  },
  {
    key: 'hotstar',
    name: 'JioHotstar',
    category: 'subscription',
    senders: [/@hotstar\.com$/i, /@jiohotstar\.com$/i],
    recurring: true,
  },

  /* -------------------------------------------------------------- billers */
  {
    key: 'airtel',
    name: 'Airtel',
    category: 'bills',
    senders: [/@airtel\.com$/i, /@airtelbank\.com$/i],
    recurring: true,
  },
  {
    key: 'jio',
    name: 'Jio',
    category: 'bills',
    senders: [/@jio\.com$/i, /@ril\.com$/i],
    recurring: true,
  },
  {
    key: 'bescom',
    name: 'BESCOM',
    category: 'bills',
    senders: [/@bescom\.co\.in$/i, /@bescom\.org$/i],
    recurring: true,
  },
  {
    key: 'act',
    name: 'ACT Fibernet',
    category: 'bills',
    senders: [/@actcorp\.in$/i],
    recurring: true,
  },
];

const BY_KEY = new Map(MERCHANTS.map((m) => [m.key, m]));

export const merchant = (key) => BY_KEY.get(key) ?? null;

/**
 * A shop this list does not know about, described by the household.
 *
 * The registry above is a starting set, not a claim to be complete — every
 * household buys from somewhere nobody thought to include, and a list that can
 * only be extended by editing source code is a list that stays as it shipped.
 * A domain and a name are enough: the sender is what identifies a receipt, and
 * a household knows which address its receipts arrive from.
 *
 * @param {{domain: string, name?: string, category?: string}} shop
 */
export function customMerchant({ domain = '', name = '', category = 'other-spend' } = {}) {
  const clean = String(domain).trim().toLowerCase().replace(/^.*@/, '').replace(/^www\./, '');
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(clean)) return null;

  return {
    key: `custom:${clean}`,
    name: name.trim() || clean,
    category,
    // Anchored the same way the built-in patterns are, so `notzomato.com`
    // cannot pass itself off as a subdomain of one.
    senders: [new RegExp(`@(.+\\.)?${clean.replace(/\./g, '\\.')}$`, 'i')],
    custom: true,
  };
}

/**
 * The merchant an email came from, or null.
 *
 * The sender is what decides. A subject pattern only ever *narrows* — Amazon
 * mails about deliveries, recommendations, password resets and Prime, and only
 * some of that is a purchase. Matching on subject alone would claim every
 * newsletter that mentions an order.
 *
 * `extra` is the household's own additions, checked first: a shop somebody
 * took the trouble to name should win over a built-in guess about the same
 * domain.
 */
export function recognise({ from = '', subject = '' } = {}, extra = []) {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;

  for (const entry of [...extra, ...MERCHANTS]) {
    if (!entry.senders.some((pattern) => pattern.test(address.trim()))) continue;
    if (entry.subject && !entry.subject.test(subject)) continue;
    return entry;
  }
  return null;
}

/**
 * A Gmail search that matches only these merchants.
 *
 * This is the whole privacy argument in one function. Reading a mailbox means
 * holding a scope that can read *everything* in it, so the only meaningful
 * limit is what is actually asked for — and this asks for mail from a fixed
 * list of shops, newer than a given date, and nothing else. A household can
 * read this query and see exactly what will be looked at.
 *
 * @param {{since?: string, keys?: string[], extra?: object[]}} [options]
 */
export function searchQuery({ since = '', keys = [], extra = [] } = {}) {
  const all = [...MERCHANTS, ...extra];
  const chosen = keys.length ? all.filter((m) => keys.includes(m.key)) : all;

  const domains = [...new Set(chosen.flatMap((entry) => entry.senders.map(domainOf)))]
    .filter(Boolean)
    .map((domain) => `from:${domain}`);

  if (!domains.length) return '';

  const parts = [`(${domains.join(' OR ')})`];
  if (since) parts.push(`after:${since.replace(/-/g, '/')}`);
  // Nothing in Bin or Spam: a deleted receipt was deleted on purpose.
  parts.push('-in:trash', '-in:spam');

  return parts.join(' ');
}

/** `/@zomato\.com$/` → `zomato.com`, for a Gmail `from:` term. */
function domainOf(pattern) {
  const source = pattern.source
    .replace(/^.*@/, '')
    .replace(/\\\./g, '.')
    .replace(/\$$/, '')
    .replace(/\(([^)]*)\)\?/g, '')
    .replace(/\(([^)|]*)\|[^)]*\)/g, '$1');
  return /^[a-z0-9.-]+$/i.test(source) ? source : '';
}
