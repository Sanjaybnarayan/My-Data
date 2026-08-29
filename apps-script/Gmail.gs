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
 * query it is given, refuses a query that does not name senders, and returns
 * a bounded number of messages. A household can read the query in
 * `domain/merchants.js`, see the exact list of shops, and check it against
 * what comes back.
 *
 * Bodies are truncated hard. A receipt's total sits near the top; the rest is
 * marketing, and shipping the whole of it would mean holding a copy of the
 * mailbox in transit for no benefit.
 */

/** Enough of a receipt to find the total, and no more. */
var MAX_BODY_CHARS = 4000;

/** A ceiling on one call, well inside the six-minute execution limit. */
var MAX_MESSAGES = 200;

/**
 * @param {{query: string, limit: number}} payload
 * @returns {{messages: Array, query: string, truncated: boolean}}
 */
function gmailSearch(payload, context) {
  var query = String(payload.query || '').trim();
  if (!query) throw fail('no search query was supplied', 400);

  // The client builds this from its merchant registry. A query with no sender
  // term would be a request to read the whole mailbox, which this refuses on
  // principle rather than trusting the caller to have meant something else.
  if (query.indexOf('from:') === -1) {
    throw fail('a mail search must name the senders it is for', 400);
  }

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
