/**
 * Shops — what the household buys, and from whom.
 *
 * ## Why this is not "connect your Zomato account"
 *
 * It cannot be. Zomato, Swiggy, Amazon, Flipkart, Blinkit and Zepto have no
 * consumer API: no sign-in, no OAuth, no endpoint that returns your orders.
 * The only two ways to get order history out of them are to drive their
 * websites with your password, or to read the receipts they email you.
 *
 * The first would mean this application holding the login to every account a
 * household owns — in an application whose entire premise is that it holds
 * *less* than you would expect. It would break whenever a login page changed,
 * and it is against the terms of every one of those services. So it is not
 * offered here, and this screen says so rather than leaving somebody to wonder
 * why their shop is not in a list of logos.
 *
 * The second is real, and better than it sounds. Every one of those services
 * emails a receipt for every order, from a stable address, with the total in
 * it. Gmail *does* have an API, it is the household's own mailbox, and one
 * connection covers every shop at once — including the ones nobody thought to
 * add, which is why a household can name its own.
 *
 * ## What actually happens when you press Scan
 *
 *  1. A Gmail query is built from the shop list. It names senders and a date,
 *     and nothing else. It is printed on this screen before it runs.
 *  2. The Apps Script backend — running in the household's own Google account
 *     — executes that query and returns the sender, subject, date and the
 *     first few thousand characters of each message.
 *  3. Each message is read here, on the device. What is kept is the merchant,
 *     the date, the total, the order number and a Gmail message id. The body
 *     is not stored, and never leaves this function.
 *  4. Receipts already on record are skipped by message id, so scanning the
 *     same month twice is harmless.
 *
 * Gmail has no "only these senders" scope — reading mail means a scope that
 * can read all of it, and claiming otherwise would be a lie. The limit that
 * actually holds is the query, which is why it is shown rather than hidden.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, button, badge, chip, empty, listItem, metric, money, divider,
} from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { confirm } from '../ui/components/modal.js';
import { app } from '../context.js';
import { MERCHANTS, searchQuery, customMerchant } from '../domain/merchants.js';
import { planScan, enrich, byMerchant, subscriptions, reconcile } from '../domain/inbox.js';
import {
  BACKEND, readMailbox, googleMailbox, scriptMailbox,
  addMailbox, removeMailbox, receiptKey,
} from '../domain/mailboxes.js';
import { categoryLabel } from '../domain/categorise.js';
import { AppsScriptTransport } from '../sync/transport.js';
import { GmailClient, MAIL_SCOPES } from '../sync/gmail.js';
import { GoogleAuth } from '../auth/google.js';
import { today, addDays, addMonths, formatDay } from '../core/dates.js';
import { format } from '../core/money.js';
import { userMessage } from '../core/errors.js';

/** Where a household's own shops are kept. */
const SHOPS = 'inbox.shops';
/** Where the chosen shop keys are kept, so a scan is not re-configured monthly. */
const CHOSEN = 'inbox.chosen';
/** Where the extra mailboxes are kept. */
const MAILBOXES = 'inbox.mailboxes';

/**
 * All a *deployment* mailbox's token is for is proving which Google account is
 * asking. Not Drive, not Sheets, and not Gmail — the mail is read by that
 * account's own backend, under its own authorisation.
 */
const IDENTITY_ONLY = ['openid', 'email'];

/** How each mailbox is actually read, said in the list rather than in a doc. */
const ROUTE = {
  google: 'read from this device',
  backend: 'read by your Apps Script backend',
  script: 'read by that account’s own backend',
};

/** One call's ceiling. The backend caps it too; this is the polite request. */
const SCAN_LIMIT = 200;

/**
 * How many calls one Scan will make per mailbox before stopping.
 *
 * Enough to walk a few years of receipts in one press, bounded so a mailbox
 * that keeps reporting more can never turn into an unbounded loop against
 * somebody's Gmail quota.
 */
const MAX_PASSES = 12;

export async function render() {
  const { db } = app();

  const host = h('div', {});
  const body = h('div', {});

  /** Shops the household added themselves, as registry entries. */
  let shops = (await db.meta(SHOPS, [])).map(customMerchant).filter(Boolean);
  /** Which shops to scan for. Empty means all of them. */
  let chosen = new Set(await db.meta(CHOSEN, []));
  /** Mailboxes beyond the signed-in one. */
  let mailboxes = (await db.meta(MAILBOXES, [])).map(readMailbox).filter(Boolean);
  /** One transport per mailbox, kept so a scan does not rebuild them per run. */
  const links = new Map();
  /** One sign-in per mailbox, kept so a scan does not re-authorise per run. */
  const auths = new Map();

  let receipts = await db.repo('receipt').list({ limit: 20_000 });
  let transactions = [];
  let since = defaultSince(receipts);
  let busy = false;
  /** The result of the last scan, so the screen can report what it did. */
  let lastScan = null;

  replace(host, body);
  paint();
  return { node: host };

  /* ---------------------------------------------------------------- scanning */

  /**
   * The transport for one mailbox.
   *
   * The primary is the application's own — it is already signed in and already
   * the backend everything else uses. An added mailbox gets a transport of its
   * own pointed at that account's deployment, and an identity-only sign-in to
   * satisfy the check every backend makes that the caller is the account it
   * runs as.
   */
  function linkTo(mailbox) {
    if (mailbox.kind === 'backend') return app().transport;
    if (links.has(mailbox.id)) return links.get(mailbox.id);

    const link = mailbox.kind === 'google'
      // Its own sign-in, for its own account, carrying the Gmail scope. The
      // application's ordinary sign-in never gains it.
      ? new GmailClient({
        getToken: () => authFor(mailbox, MAIL_SCOPES).getToken(),
      })
      : new AppsScriptTransport({
        url: mailbox.url,
        getToken: () => authFor(mailbox, IDENTITY_ONLY).getToken(),
        deviceId: db.deviceId,
      });

    links.set(mailbox.id, link);
    return link;
  }

  /** One sign-in per mailbox, pinned to its address so renewal cannot drift. */
  function authFor(mailbox, scopes) {
    if (!auths.has(mailbox.id)) {
      auths.set(mailbox.id, new GoogleAuth({ scopes, loginHint: mailbox.email }));
    }
    return auths.get(mailbox.id);
  }

  /**
   * Read every mailbox in turn.
   *
   * One at a time rather than in parallel: each is a separate Apps Script
   * execution with its own six-minute budget and its own rate limit, and a
   * fan-out would trade a slower scan for a partial one. A mailbox that fails
   * is reported and the rest continue — one account being signed out is not a
   * reason to return nothing.
   */
  async function scan() {
    const query = currentQuery();

    if (!query) {
      toast('Choose at least one shop to look for.', { kind: 'error' });
      return;
    }
    if (!mailboxes.length) {
      toast('Add a mailbox first.', { kind: 'error' });
      return;
    }

    busy = true;
    lastScan = null;
    paint();

    const known = new Set(receipts.map((r) => receiptKey(r.mailbox, r.messageId)));
    const runs = [];
    let added = 0;

    for (const mailbox of mailboxes) {
      try {
        const run = {
          mailbox, searched: 0, recognised: 0, added: 0, passes: 0, truncated: false,
        };
        let from = since;

        // A first backfill over years of mail is more than one call's worth,
        // and asking somebody to keep nudging a date field until the numbers
        // stop changing is a chore, not a feature. So it walks forward on its
        // own: each pass starts the day of the newest receipt the last one
        // found, and it stops when a pass stops making progress.
        for (let pass = 0; pass < MAX_PASSES; pass += 1) {
          const result = await linkTo(mailbox).mail(currentQuery(from), SCAN_LIMIT);
          const messages = result.messages ?? [];

          // Read here, on the device. Bodies go no further than this call, and
          // the decisions it makes are unit-tested rather than only clickable.
          const scan = planScan(messages, { mailboxId: mailbox.id, shops, known });

          for (const receipt of scan.fresh) {
            await db.repo('receipt').create({
              date: receipt.date ?? today(),
              merchant: receipt.merchant,
              merchantKey: receipt.merchantKey,
              category: receipt.category,
              amount: receipt.amount ?? 0,
              orderId: receipt.orderId ?? '',
              subscription: Boolean(receipt.subscription),
              refund: Boolean(receipt.refund),
              subject: receipt.subject ?? '',
              mailbox: receipt.mailbox,
              messageId: receipt.messageId,
            });
          }

          run.searched += scan.searched;
          run.recognised += scan.read.length;
          run.added += scan.fresh.length;
          run.passes = pass + 1;
          added += scan.fresh.length;

          if (!result.truncated) break;

          // Gmail's `after:` is day-granular, so a day holding more than one
          // call's worth cannot be paged past by date. Requiring the window to
          // actually move is what stops that becoming a loop.
          const newest = latestDate(scan.read.map((r) => ({ date: r.date })));
          if (!newest || newest <= from) { run.truncated = true; break; }
          from = newest;

          if (pass === MAX_PASSES - 1) run.truncated = true;
        }

        runs.push(run);
      } catch (err) {
        runs.push({ mailbox, error: userMessage(err) });
      }
    }

    receipts = await db.repo('receipt').list({ limit: 20_000 });
    lastScan = { runs, added, query };

    // The next scan starts where this one ended rather than repeating it.
    if (added) since = latestDate(receipts);

    const failed = runs.filter((run) => run.error);
    if (failed.length && failed.length === runs.length) {
      toast(failed[0].error, { kind: 'error' });
    } else {
      toast(added
        ? `${added} new ${added === 1 ? 'receipt' : 'receipts'}`
          + (failed.length ? ` — ${failed.length} mailbox could not be read` : '')
        : 'Nothing new — every receipt found is already here', { kind: 'success' });
    }

    busy = false;
    await loadTransactions();
    paint();
  }

  async function loadTransactions() {
    if (transactions.length || !receipts.length) return;
    transactions = await db.repo('transaction').list({ decrypt: false, limit: 20_000 });
  }

  /**
   * Write what the receipts know back onto the bank rows they settled.
   *
   * Finding the pair and then doing nothing with it was the gap: the
   * Transactions list went on saying `UPI/ZOMATO`, and the categoriser went on
   * guessing at a merchant an email had already named. This turns a match into
   * a fact — payee, order number, category — on rows whose payee came off a
   * narration rather than out of a person.
   *
   * Offered rather than automatic. It edits records somebody may have already
   * corrected by hand, and a screen that rewrote a year of transactions
   * because a scan found some email would be a bad thing to have to undo.
   */
  async function applyMatches(matched) {
    const patches = matched
      .map(({ receipt, transaction }) => ({ transaction, patch: enrich(receipt, transaction) }))
      .filter(({ patch }) => Object.keys(patch).length);

    if (!patches.length) {
      toast('Every matched row already says what the receipt says.');
      return;
    }

    const ok = await confirm({
      title: `Name ${patches.length} bank ${patches.length === 1 ? 'row' : 'rows'}?`,
      message: 'Each takes the merchant, order number and category from the receipt '
        + 'that matched it. Rows whose payee you typed yourself are left alone.',
      confirmLabel: 'Name them',
    });
    if (!ok) return;

    busy = true;
    paint();

    let written = 0;
    try {
      for (const { transaction, patch } of patches) {
        await db.repo('transaction').update(transaction.id, patch);
        written += 1;
      }
      transactions = await db.repo('transaction').list({ decrypt: false, limit: 20_000 });
      toast(`${written} transactions named from their receipts`, { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    } finally {
      busy = false;
      paint();
    }
  }

  function currentQuery(from = since) {
    return searchQuery({
      since: from,
      keys: [...chosen],
      extra: shops,
    });
  }

  /* -------------------------------------------------------------- mailboxes */

  /**
   * Sign in with a Google account and read its mail from here.
   *
   * The account is not asked for — it is whichever one the person picks in
   * Google's own window, which is the only place that answer can be given
   * truthfully. `select_account` so a household with several signed in is
   * asked which, rather than silently getting the default.
   */
  async function connectGoogle() {
    busy = true;
    paint();

    try {
      const auth = new GoogleAuth({ scopes: MAIL_SCOPES });
      await auth.signIn({ prompt: 'select_account consent' });
      const profile = await auth.fetchProfile();

      const mailbox = googleMailbox({ email: profile?.email ?? '' });
      if (!mailbox) throw new Error('Google did not say which account that was.');

      // Prove the permission was actually granted before it is written down.
      // Google's consent screen lets somebody untick a scope, and a mailbox
      // that fails on every scan afterwards is a worse answer than one that
      // fails now.
      await new GmailClient({ getToken: () => auth.getToken() })
        .mail(currentQuery() || 'from:example.com', 1);

      auths.set(mailbox.id, auth);
      links.delete(mailbox.id);
      mailboxes = addMailbox(mailboxes, mailbox);
      await save();
      toast(`${mailbox.label} connected`, { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    } finally {
      busy = false;
      paint();
    }
  }

  /** Read mail through the deployment this application already syncs with. */
  async function connectBackend() {
    busy = true;
    paint();

    try {
      // The same proof the Google route does: this deployment either has
      // Gmail.gs or it does not, and finding out now beats finding out on the
      // first scan.
      await app().transport.mail(currentQuery() || 'from:example.com', 1);
      mailboxes = addMailbox(mailboxes, BACKEND);
      await save();
      toast('Reading mail through this deployment', { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    } finally {
      busy = false;
      paint();
    }
  }

  /**
   * Attach another account's deployment.
   *
   * The sign-in is what proves the URL and the account belong together — the
   * backend at that URL only answers a token issued for the account it runs
   * as, so a wrong pairing fails here rather than silently returning nothing
   * on every scan afterwards.
   */
  async function connectScript(url, label) {
    if (!scriptMailbox({ url })) {
      toast('That is not an Apps Script deployment URL — it should end in /exec.',
        { kind: 'error' });
      return;
    }

    busy = true;
    paint();

    try {
      const auth = new GoogleAuth({ scopes: IDENTITY_ONLY });
      await auth.signIn({ prompt: 'select_account consent' });
      const profile = await auth.fetchProfile();

      const mailbox = scriptMailbox({ url, label, email: profile?.email ?? '' });
      await new AppsScriptTransport({
        url: mailbox.url, getToken: () => auth.getToken(), deviceId: db.deviceId,
      }).call('ping');

      auths.set(mailbox.id, auth);
      links.delete(mailbox.id);
      mailboxes = addMailbox(mailboxes, mailbox);
      await save();
      toast(`${mailbox.label} connected`, { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    } finally {
      busy = false;
      paint();
    }
  }

  const save = () => db.setMeta(MAILBOXES, mailboxes);

  /**
   * Forget a mailbox, and decide what happens to what it found.
   *
   * Deleting the receipts is offered rather than assumed: somebody removing a
   * mailbox they no longer read still spent that money, and silently dropping
   * a year of it out of every total would be a strange thing for a record
   * keeper to do on its own.
   */
  async function forgetMailbox(mailbox) {
    const mine = receipts.filter((receipt) => receipt.mailbox === mailbox.id);

    const ok = await confirm({
      title: `Stop reading ${mailbox.label}?`,
      message: mine.length
        ? `${mine.length} ${mine.length === 1 ? 'receipt' : 'receipts'} already read from it `
          + 'will be kept — the money was still spent. Nothing new will be read.'
        : 'Nothing new will be read from it.',
      confirmLabel: 'Stop reading it',
    });
    if (!ok) return;

    mailboxes = removeMailbox(mailboxes, mailbox.id);
    links.delete(mailbox.id);
    // Signing out revokes the token rather than leaving an hour of read access
    // sitting in memory after somebody has said they are done with it.
    await auths.get(mailbox.id)?.signOut().catch(() => {});
    auths.delete(mailbox.id);
    await save();
    paint();
  }

  /* ------------------------------------------------------------------ shops */

  async function addShop(domain, name) {
    const entry = customMerchant({ domain, name });
    if (!entry) {
      toast('That does not look like a domain — try “thebakery.in”.', { kind: 'error' });
      return;
    }
    if (shops.some((shop) => shop.key === entry.key)) return;

    shops = [...shops, entry];
    await db.setMeta(SHOPS, shops.map((shop) => ({
      domain: shop.key.slice('custom:'.length), name: shop.name, category: shop.category,
    })));
    paint();
  }

  async function removeShop(key) {
    shops = shops.filter((shop) => shop.key !== key);
    chosen.delete(key);
    await db.setMeta(SHOPS, shops.map((shop) => ({
      domain: shop.key.slice('custom:'.length), name: shop.name, category: shop.category,
    })));
    await db.setMeta(CHOSEN, [...chosen]);
    paint();
  }

  async function toggle(key) {
    // An empty set means "all of them", so the first click has to start from
    // everything rather than from nothing — otherwise turning one shop off
    // would silently turn every other shop off with it.
    if (!chosen.size) chosen = new Set([...MERCHANTS, ...shops].map((m) => m.key));
    if (chosen.has(key)) chosen.delete(key);
    else chosen.add(key);
    await db.setMeta(CHOSEN, [...chosen]);
    paint();
  }

  /* ---------------------------------------------------------- subscriptions */

  /**
   * Turn a detected renewal into a tracked subscription.
   *
   * Deliberately a decision rather than an automatic write: the reminders and
   * the Digital module are things somebody chose to keep, and filling them
   * from a guess about an email would make both less trustworthy.
   */
  async function track(entry) {
    const period = entry.period === 'yearly' ? 'yearly'
      : entry.period === 'quarterly' ? 'quarterly' : 'monthly';
    const months = period === 'yearly' ? 12 : period === 'quarterly' ? 3 : 1;
    const renewsOn = addMonths(entry.last, months);

    const ok = await confirm({
      title: `Track ${entry.merchant}?`,
      message: `${format(entry.average)} ${period}, next due around ${formatDay(renewsOn)}. `
        + 'It will appear in Digital → Subscriptions and start producing renewal reminders.',
      confirmLabel: 'Track it',
    });
    if (!ok) return;

    try {
      await db.repo('subscription').create({
        name: entry.merchant,
        provider: entry.merchant,
        amount: entry.average,
        frequency: period,
        renewsOn,
        active: true,
        notes: `Found in ${entry.orders} ${entry.orders === 1 ? 'receipt' : 'receipts'} between `
          + `${entry.first} and ${entry.last}.`,
      });
      toast(`${entry.merchant} is now tracked`, { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  /* -------------------------------------------------------------- painting */

  function paint() {
    const shown = byMerchant(receipts);
    const subs = subscriptions(receipts);
    const matched = transactions.length ? reconcile(receipts, transactions) : null;

    replace(body, [
      explainer(),
      scanCard(),
      mailboxesCard(),
      shopsCard(),
      lastScan ? scanResultCard() : null,
      shown.length ? spendCard(shown) : nothingYet(),
      subs.length ? subscriptionsCard(subs) : null,
      matched ? reconciledCard(matched) : null,
    ].filter(Boolean));
  }

  function scanCard() {
    const dateField = h('input', {
      type: 'date',
      class: 'input',
      value: since,
      max: today(),
      'aria-label': 'Look at mail newer than',
      onChange: (event) => { since = event.target.value || since; paint(); },
    });

    const query = currentQuery();

    return card({}, [
      cardHeader('Read receipts from Gmail', [
        button(busy ? 'Reading…' : 'Scan mail', {
          variant: 'primary', iconName: 'refresh', onClick: scan, disabled: busy,
        }),
      ], {
        subtitle: 'Your own mailbox, one query, nothing else',
        iconName: 'cloud',
      }),

      h('div', { class: 'row', style: { gap: 'var(--space-2)', alignItems: 'center' } }, [
        h('label', { class: 'small muted' }, 'Newer than'),
        dateField,
      ]),

      h('p', { class: 'small muted', style: { marginTop: 'var(--space-3)' } },
        'This is the exact search that runs. It names senders and a date, and asks '
        + 'for nothing else:'),
      h('pre', { class: 'mono small', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
        query || '— no shops chosen, so nothing would be searched —'),
    ]);
  }

  function mailboxesCard() {
    const counts = new Map();
    for (const receipt of receipts) {
      const key = receipt.mailbox || BACKEND.id;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const attached = new Set(mailboxes.map((mailbox) => mailbox.id));

    return card({}, [
      cardHeader('Mailboxes', [
        button('Add a Gmail account', {
          variant: 'primary', iconName: 'plus', onClick: connectGoogle, disabled: busy,
        }),
      ], {
        subtitle: mailboxes.length
          ? `${mailboxes.length} read every scan`
          : 'None yet — one sign-in is the whole setup',
        iconName: 'bank',
      }),

      mailboxes.length
        ? h('div', {}, mailboxes.map((mailbox) => listItem({
          title: mailbox.label,
          subtitle: [
            ROUTE[mailbox.kind],
            `${counts.get(mailbox.id) ?? 0} receipts`,
          ].filter(Boolean).join(' · '),
          leading: badge(mailbox.kind === 'google' ? 'signed in' : 'deployment',
            mailbox.kind === 'google' ? 'success' : 'info'),
          trailing: button('Remove', { onClick: () => forgetMailbox(mailbox) }),
        })))
        : h('p', { class: 'muted' },
          'Press “Add a Gmail account” and choose the account your receipts arrive '
          + 'at. Add as many as you have — food and shopping at one address, bills '
          + 'and business orders at another is the normal case, and a total covering '
          + 'only one of them is misleading rather than merely incomplete.'),

      divider(),
      h('p', { class: 'small muted' }, [
        h('strong', {}, 'What signing in costs. '),
        'Reading mail from this page means the page holds a Gmail token for an hour '
        + 'at a time. Gmail has no narrower permission that would work — the one that '
        + 'returns headers without bodies cannot see a total. So a script injected '
        + 'into this application, which could already reach its Drive and Sheets '
        + 'tokens, could also read a connected mailbox. That is a real difference, '
        + 'and it is why the harder route below still exists.',
      ]),
      h('p', { class: 'small faint' },
        'Each mailbox is its own sign-in, for its own account, revocable on its own '
        + 'at myaccount.google.com/permissions without disturbing sync. The '
        + 'application’s ordinary sign-in never gains the mail permission.'),
      h('p', { class: 'small faint' },
        'Backup stays where it is either way. A mailbox answers mail searches and '
        + 'nothing else — never a workbook, a Drive folder, or anything to sync.'),

      backendOption(attached),
      scriptOption(),
    ].filter(Boolean));
  }

  /** The no-token-in-the-page route, when this deployment can do it. */
  function backendOption(attached) {
    if (attached.has(BACKEND.id)) return null;

    return h('details', { class: 'small', style: { marginTop: 'var(--space-3)' } }, [
      h('summary', {}, 'Read this account’s mail without a token in the page'),
      h('p', { class: 'muted' }, [
        'If ', h('code', {}, 'Gmail.gs'), ' was deployed with your Apps Script '
        + 'backend, it can read the mailbox of the account that deployed it — with '
        + 'the Gmail permission granted to that script rather than to this page. '
        + 'Tighter, and no extra setup if you already deployed it.',
      ]),
      button('Use this deployment', { onClick: connectBackend, disabled: busy }),
    ]);
  }

  /** The same, for a second account: the most setup, the least exposure. */
  function scriptOption() {
    const url = h('input', {
      type: 'url',
      class: 'input',
      placeholder: 'https://script.google.com/macros/s/…/exec',
      'aria-label': 'Apps Script deployment URL',
      onKeyDown: (event) => { if (event.key === 'Enter') submit(); },
    });
    const label = h('input', {
      type: 'text',
      class: 'input',
      placeholder: 'Personal, Work, …',
      'aria-label': 'Mailbox name',
      onKeyDown: (event) => { if (event.key === 'Enter') submit(); },
    });

    const submit = () => {
      if (!url.value.trim()) return;
      void connectScript(url.value, label.value);
      url.value = '';
      label.value = '';
    };

    return h('details', { class: 'small', style: { marginTop: 'var(--space-2)' } }, [
      h('summary', {}, 'Add another account’s deployment instead of signing in'),
      h('p', { class: 'muted' },
        'The most setup by a distance, and the only way to read a second mailbox '
        + 'without this page ever holding a Gmail token: that account deploys its '
        + 'own copy of apps-script/, and its /exec URL goes here. See docs/SETUP.md.'),
      h('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [
        url, label, button('Connect', { onClick: submit, disabled: busy }),
      ]),
    ]);
  }

  function shopsCard() {
    const all = [...MERCHANTS, ...shops];
    const active = (key) => !chosen.size || chosen.has(key);

    const domain = h('input', {
      type: 'text',
      class: 'input',
      placeholder: 'receipts.myshop.in',
      'aria-label': 'Sender domain',
      onKeyDown: (event) => { if (event.key === 'Enter') submit(); },
    });
    const name = h('input', {
      type: 'text',
      class: 'input',
      placeholder: 'What to call it',
      'aria-label': 'Shop name',
      onKeyDown: (event) => { if (event.key === 'Enter') submit(); },
    });

    const submit = () => {
      const value = domain.value.trim();
      if (!value) return;
      void addShop(value, name.value.trim());
      domain.value = '';
      name.value = '';
    };

    return card({}, [
      cardHeader('Shops', [
        chosen.size
          ? button('Everything', { onClick: () => { chosen = new Set(); db.setMeta(CHOSEN, []); paint(); } })
          : null,
      ].filter(Boolean), {
        subtitle: `${chosen.size || all.length} of ${all.length} searched`,
        iconName: 'globe',
      }),

      h('div', { class: 'chip-row' }, all.map((entry) => chip(entry.name, {
        pressed: active(entry.key),
        onClick: () => toggle(entry.key),
      }))),

      shops.length
        ? h('div', { style: { marginTop: 'var(--space-3)' } }, [
          h('p', { class: 'small muted' }, 'Yours:'),
          h('div', { class: 'chip-row' }, shops.map((shop) => chip(`${shop.name}  ✕`, {
            onClick: () => removeShop(shop.key),
          }))),
        ])
        : null,

      divider(),
      h('p', { class: 'small muted' },
        'The list above is a starting set, not a complete one. Every household buys '
        + 'from somewhere nobody thought to include — give the domain its receipts '
        + 'arrive from and it is treated like any other shop.'),
      h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-2)' } }, [
        domain, name, button('Add', { onClick: submit }),
      ]),
    ].filter(Boolean));
  }

  function scanResultCard() {
    const good = lastScan.runs.filter((run) => !run.error);
    const searched = good.reduce((total, run) => total + run.searched, 0);
    const recognised = good.reduce((total, run) => total + run.recognised, 0);

    return card({ class: 'card--quiet' }, [
      cardHeader('Last scan', null, {
        subtitle: `${lastScan.runs.length} ${lastScan.runs.length === 1 ? 'mailbox' : 'mailboxes'}`,
        iconName: 'info',
      }),
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'Messages read', value: String(searched) }),
        metric({ label: 'Receipts recognised', value: String(recognised) }),
        metric({ label: 'New', value: String(lastScan.added) }),
      ]),

      // Per mailbox, because "nothing new" from three accounts and "nothing new
      // because two of them failed" are very different answers.
      ...(lastScan.runs.length > 1 || lastScan.runs.some((run) => run.error)
        ? lastScan.runs.map((run) => listItem({
          title: run.mailbox.label,
          subtitle: run.error
            ? run.error
            : `${run.searched} read · ${run.recognised} receipts · ${run.added} new`
              + (run.passes > 1 ? ` · ${run.passes} passes` : '')
              + (run.truncated ? ' · more to come' : ''),
          leading: badge(run.error ? 'failed' : 'read', run.error ? 'warn' : 'success'),
        }))
        : []),

      good.some((run) => run.truncated)
        ? h('p', { class: 'muted small' },
          'A mailbox still has more than this scan could reach — either a single day '
          + `holds more than ${SCAN_LIMIT} receipts, or there were more than ${MAX_PASSES} `
          + 'calls’ worth. Press Scan again and it carries on from where it stopped.')
        : null,
      searched && !recognised
        ? h('p', { class: 'muted small' },
          'Mail came back but none of it looked like a receipt — usually a shop that '
          + 'sends from a different address than expected. The From line of one of '
          + 'those emails, added as a shop below, will fix it.')
        : null,
      lastScan.runs.some((run) => run.error)
        ? h('p', { class: 'muted small' },
          'A mailbox that could not be read is usually one whose Google account is '
          + 'signed out, or whose backend has not been redeployed since Gmail.gs was '
          + 'added. The others were still read.')
        : null,
    ].filter(Boolean));
  }

  function nothingYet() {
    return empty({
      title: 'No receipts yet',
      message: 'Scan the mailbox and every order, bill and renewal these shops emailed '
        + 'about becomes a line you can total.',
      iconName: 'receipt',
    });
  }

  function spendCard(shown) {
    const spent = shown.reduce((total, entry) => total + entry.net, 0);
    const orders = shown.reduce((total, entry) => total + entry.orders, 0);

    return card({}, [
      cardHeader('Where it went', null, {
        subtitle: `${receipts.length} receipts across ${shown.length} shops`,
        iconName: 'chart',
      }),
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'Spent', value: money(spent) }),
        metric({ label: 'Orders', value: String(orders) }),
        metric({
          label: 'Average order',
          value: money(orders ? Math.round(spent / orders) : 0),
        }),
      ]),
      ...shown.map((entry) => listItem({
        title: entry.merchant,
        subtitle: [
          `${entry.orders} ${entry.orders === 1 ? 'order' : 'orders'}`,
          `avg ${format(entry.average)}`,
          categoryLabel(entry.category),
          entry.refunded ? `${format(entry.refunded)} refunded` : null,
        ].filter(Boolean).join(' · '),
        value: money(entry.net),
      })),
    ]);
  }

  function subscriptionsCard(subs) {
    const yearly = subs.reduce((total, entry) => total + entry.yearly, 0);

    return card({}, [
      cardHeader('Renewing on their own', null, {
        subtitle: 'What they cost a year, which is the number nobody adds up',
        iconName: 'repeat',
      }),
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'A year, all of them', value: money(yearly) }),
        metric({ label: 'A month', value: money(Math.round(yearly / 12)) }),
      ]),
      ...subs.map((entry) => listItem({
        title: entry.merchant,
        subtitle: `${format(entry.average)} ${entry.period} · last seen ${formatDay(entry.last)}`,
        value: `${format(entry.yearly)}/yr`,
        trailing: button('Track', { onClick: () => track(entry) }),
      })),
      h('p', { class: 'small muted' },
        'A period is inferred from the gaps between receipts, so one renewal on record '
        + 'is assumed monthly until a second one says otherwise.'),
    ]);
  }

  function reconciledCard(matched) {
    const percent = Math.round(matched.coverage * 100);

    return card({}, [
      cardHeader('Matched to the bank', [
        matched.matched.length
          ? button('Name the bank rows', {
            variant: 'primary', onClick: () => applyMatches(matched.matched), disabled: busy,
          })
          : null,
      ].filter(Boolean), {
        subtitle: `${matched.matched.length} of ${receipts.length} receipts found the payment that settled them`,
        iconName: 'link',
      }),
      h('div', { class: 'chip-row' }, [
        badge(`${percent}% matched`, percent > 70 ? 'success' : 'info'),
        badge(`${matched.unmatched.length} unmatched`, ''),
      ]),
      ...matched.matched.slice(0, 12).map(({ receipt, transaction }) => listItem({
        title: receipt.merchant,
        subtitle: `${formatDay(receipt.date)} · ${transaction.narration || transaction.payee || 'bank row'}`
          + (receipt.orderId ? ` · ${receipt.orderId}` : ''),
        value: money(receipt.amount),
      })),
      h('p', { class: 'small muted' },
        'An unmatched receipt is not an error. It may have been paid by a card whose '
        + 'statement is not imported, from an account belonging to somebody else, or '
        + 'with a wallet balance that never touched a bank.'),
    ]);
  }
}

/* ------------------------------------------------------------------ static */

function explainer() {
  return card({ class: 'card--quiet' }, [
    cardHeader('Why there is no “Connect Zomato” button', null, { iconName: 'info' }),
    h('p', { class: 'muted' },
      'Zomato, Swiggy, Amazon, Flipkart, Blinkit and Zepto do not offer one. None of '
      + 'them publishes an API a household can sign into, so the only way an app can '
      + '“link” to them is to keep your password and drive their website as if it were '
      + 'you. This application will not hold those passwords.'),
    h('p', { class: 'muted' },
      'What every one of them does do is email a receipt for every order. That mail is '
      + 'already yours, it covers shops nobody built an integration for, and reading it '
      + 'needs one connection instead of twenty.'),
    h('p', { class: 'small faint' },
      'Gmail has no per-sender permission — reading mail means a scope that can read all '
      + 'of it. So the limit is the query, printed below before it runs, and the fact '
      + 'that nothing but the merchant, date, total and order number is kept. The message '
      + 'itself stays in Gmail.'),
  ]);
}

/* ----------------------------------------------------------------- helpers */

/** Where to start looking: after the newest receipt, or three months back. */
function defaultSince(receipts) {
  const latest = latestDate(receipts);
  return latest ? addDays(latest, -1) : addMonths(today(), -3);
}

function latestDate(receipts) {
  return receipts.reduce((newest, receipt) => (
    receipt.date && (!newest || receipt.date > newest) ? receipt.date : newest
  ), '');
}
