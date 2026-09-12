/**
 * Receipts out of the household's own Gmail.
 *
 * ## Why this lives here and not in the browser
 *
 * The same reason the OCR does. This script runs as the account's owner, in
 * their own Google account, with a token nobody else holds. The browser would
 * need a Gmail scope of its own and would have to carry the search, the paging
 * and the parsing across a network it does not control. Here the mail never
 * leaves Google, and what crosses the wire is a short list of fields.
 *
 * ## What it will and will not read
 *
 * Reading mail requires a scope that can read all of it — Gmail has no
 * "only these senders" permission, and pretending otherwise would be
 * dishonest. So the limit that actually holds is this function: it runs the
 * query it is given, refuses a query that is not a list of senders and terms
 * that narrow it, and returns a bounded number of messages. A household can
 * read the query in `domain/merchants.js`, see the exact list of shops, and
 * check it against what comes back.
 *
 * That sentence used to say "refuses a query that does not name senders", and
 * the check behind it was `query.indexOf('from:') === -1`. A substring is not
 * a constraint. `from:me OR is:unread` contains `from:` and asks Gmail for the
 * whole mailbox; so does `(from:a) subject:password`. The one limit this file
 * claimed to have could be stepped over by typing four characters, and the
 * paragraph above was the only place anybody would have looked for it.
 * `assertSenderQuery` is a grammar now, and what it accepts is what
 * `searchQuery` builds and nothing wider.
 *
 * Bodies are truncated hard. A receipt's total sits near the top; the rest is
 * marketing, and shipping the whole of it would mean holding a copy of the
 * mailbox in transit for no benefit.
 *
 * ## Who may ask
 *
 * Nobody was being asked. `gmailSearch` took a `context` and spent it on a log
 * line — the same fault `driveUpload` had, in the same shape, one file over.
 * So any member this household had ever added, at any role, could search the
 * owner's mailbox: a child, a guest, a member of staff.
 *
 * `transaction` is the entity this mail becomes, so its ACL decides, which is
 * the rule `driveAllows` already applies to `document`. Searching is a read
 * and is checked as one — the same mapping `driveDownload` uses — so the
 * adults who file receipts today go on doing it, and the three roles that
 * cannot read a transaction can no longer read the mail one would have come
 * from.
 */

/* eslint-env googleappsscript */
/* global GmailApp, Utilities, fail, log, policyAllows */

/** Enough of a receipt to find the total, and no more. */
var MAX_BODY_CHARS = 4000;

/** A ceiling on one call, well inside the six-minute execution limit. */
var MAX_MESSAGES = 200;

/** A sender term: `from:` and a domain, optionally with a mailbox before it. */
var SENDER = /^from:(?:[A-Za-z0-9._%+-]+@)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/**
 * Terms that can only make the result smaller.
 *
 * Every one of these removes messages from what the sender group already
 * matched. Nothing here can add a message, which is the property that makes
 * the list safe to extend: a term that is not on it is refused, and a term
 * that is on it cannot widen the search past the shops named in front of it.
 */
var NARROWING = [
  /^after:\d{4}\/\d{1,2}\/\d{1,2}$/,
  /^before:\d{4}\/\d{1,2}\/\d{1,2}$/,
  /^newer_than:\d{1,4}[dmy]$/,
  /^older_than:\d{1,4}[dmy]$/,
  /^-in:trash$/,
  /^-in:spam$/,
];

/**
 * Refuse anything that is not senders, then narrowing.
 *
 * The shape `domain/merchants.js` builds and the only shape accepted:
 *
 *     (from:zomato.com OR from:swiggy.in) after:2026/01/01 -in:trash -in:spam
 *
 * A single unbracketed sender is accepted too, because the connection probe on
 * the receipts screen sends `from:example.com` to ask whether this deployment
 * can read mail at all.
 *
 * `OR` is the whole reason this is a grammar rather than a search for a
 * substring: inside the leading group it joins senders, and anywhere else it
 * joins a sender to something that is not one. So the group is taken first and
 * every remaining word has to match a term that can only narrow. There is no
 * allowance for free text — a bare word in a Gmail query is a body search
 * across everything the scope can reach.
 */
function assertSenderQuery(query) {
  var refuse = function () {
    throw fail('a mail search must be a list of senders, and terms that narrow it', 400);
  };

  var group;
  var rest;

  if (query.charAt(0) === '(') {
    var close = query.indexOf(')');
    if (close === -1) refuse();
    var nested = query.indexOf('(', 1);
    if (nested !== -1 && nested < close) refuse();
    group = query.slice(1, close);
    rest = query.slice(close + 1);
  } else {
    var space = query.indexOf(' ');
    group = space === -1 ? query : query.slice(0, space);
    rest = space === -1 ? '' : query.slice(space);
  }

  var senders = group.split(/\s+OR\s+/);
  if (!senders.length) refuse();
  for (var i = 0; i < senders.length; i++) {
    if (!SENDER.test(senders[i].trim())) refuse();
  }

  var words = rest.split(/\s+/);
  for (var w = 0; w < words.length; w++) {
    if (!words[w]) continue;
    var ok = false;
    for (var n = 0; n < NARROWING.length; n++) {
      if (NARROWING[n].test(words[w])) { ok = true; break; }
    }
    if (!ok) refuse();
  }
}

/**
 * @param {{query: string, limit: number}} payload
 * @returns {{messages: Array, query: string, truncated: boolean}}
 */
function gmailSearch(payload, context) {
  var role = (context && context.role) || 'guest';
  if (!policyAllows(role, 'read', 'transaction')) {
    throw fail('your role may not read the household mail', 403);
  }

  var query = String(payload.query || '').trim();
  if (!query) throw fail('no search query was supplied', 400);
  assertSenderQuery(query);

  var limit = Math.min(Number(payload.limit) || 100, MAX_MESSAGES);
  var threads = GmailApp.search(query, 0, limit);
  var messages = [];

  for (var i = 0; i < threads.length && messages.length < limit; i++) {
    var thread = threads[i].getMessages();

    for (var j = 0; j < thread.length && messages.length < limit; j++) {
      var message = thread[j];

      messages.push({
        id: message.getId(),
        from: message.getFrom(),
        subject: message.getSubject(),
        // ISO, so the client parses one shape rather than Gmail's display form.
        date: Utilities.formatDate(message.getDate(), 'UTC', 'yyyy-MM-dd'),
        body: plainBody(message).slice(0, MAX_BODY_CHARS),
      });
    }
  }

  if (context && context.email) {
    log('gmail', context.email, messages.length + ' messages for ' + query.slice(0, 80), 0);
  }

  return {
    messages: messages,
    query: query,
    truncated: messages.length >= limit,
    // Stated rather than left absent. This loop has no per-message catch: a
    // Gmail failure throws out of the whole call and the client sees an error,
    // so nothing can be lost quietly here and zero is the truth about it. The
    // native route (`js/sync/gmail.js`) does continue past a failed message
    // and counts them, and a client reading one field for both routes should
    // not have to guess which it is talking to.
    unreachable: 0,
  };
}

/**
 * A message as text.
 *
 * `getPlainBody` is preferred because a receipt's totals survive it and the
 * markup does not. Where a sender ships HTML only, the tags are stripped
 * rather than the message skipped — the total is in there, wrapped in a table
 * nobody needs.
 */
function plainBody(message) {
  var text = '';
  try {
    text = message.getPlainBody() || '';
  } catch (err) {
    text = '';
  }

  if (text.replace(/\s/g, '').length > 40) return text;

  try {
    return message.getBody()
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#8377;|&rupee;/g, '₹')
      .replace(/[ \t]+/g, ' ');
  } catch (err) {
    return text;
  }
}
