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
import { readReceipt, byMerchant, subscriptions, reconcile } from '../domain/inbox.js';
import {
  PRIMARY, readMailbox, addMailbox, removeMailbox, allMailboxes, receiptKey,
} from '../domain/mailboxes.js';
import { categoryLabel } from '../domain/categorise.js';
import { AppsScriptTransport } from '../sync/transport.js';
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
 * All a second mailbox's token is for is proving which Google account is
 * asking. Not Drive, not Sheets, and emphatically not Gmail — the mail is read
 * by that account's own backend, under its own authorisation.
 */
const IDENTITY_ONLY = ['openid', 'email'];

/** One call's ceiling. The backend caps it too; this is the polite request. */
const SCAN_LIMIT = 200;

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
    if (mailbox.primary) return app().transport;
    if (links.has(mailbox.id)) return links.get(mailbox.id);

    const auth = new GoogleAuth({ scopes: IDENTITY_ONLY, loginHint: mailbox.email });
    const link = new AppsScriptTransport({
      url: mailbox.url,
      getToken: () => auth.getToken(),
      deviceId: db.deviceId,
    });
    links.set(mailbox.id, link);
    return link;
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
    if (!app().transport.configured) {
      toast('Connect a Google account in Settings first.', { kind: 'error' });
      return;
    }

    busy = true;
    lastScan = null;
    paint();

    const known = new Set(receipts.map((r) => receiptKey(r.mailbox, r.messageId)));
    const runs = [];
    let added = 0;

    for (const mailbox of allMailboxes(mailboxes)) {
      try {
        const result = await linkTo(mailbox).mail(query, SCAN_LIMIT);
        const messages = result.messages ?? [];

        // Read here, on the device. Bodies go no further than this loop.
        const read = messages.map((message) => readReceipt(message, shops)).filter(Boolean);
        const fresh = read.filter((r) => r.messageId
          && !known.has(receiptKey(mailbox.id, r.messageId)));

        for (const receipt of fresh) {
          known.add(receiptKey(mailbox.id, receipt.messageId));
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
            mailbox: mailbox.id,
            messageId: receipt.messageId,
          });
        }

        added += fresh.length;
        runs.push({
          mailbox,
          searched: messages.length,
          recognised: read.length,
          added: fresh.length,
          truncated: Boolean(result.truncated),
        });
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

  function currentQuery() {
    return searchQuery({
      since,
      keys: [...chosen],
      extra: shops,
    });
  }

  /* -------------------------------------------------------------- mailboxes */

  /**
   * Attach a mailbox by signing in as the account that owns it.
   *
   * The sign-in is what proves the URL and the account belong together — the
   * backend at that URL only answers a token issued for the account it runs
   * as, so a wrong pairing fails here rather than silently returning nothing
   * on every scan afterwards.
   */
  async function connectMailbox(url, label) {
    const draft = readMailbox({ url, label });
    if (!draft) {
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

      const mailbox = readMailbox({ url, label, email: profile?.email ?? '' });
      // Prove it answers before it is written down, so a mistyped URL or the
      // wrong account is a message now rather than an empty scan later.
      await new AppsScriptTransport({
        url: mailbox.url, getToken: () => auth.getToken(), deviceId: db.deviceId,
      }).call('ping');

      mailboxes = addMailbox(mailboxes, mailbox);
      links.delete(mailbox.id);
      await db.setMeta(MAILBOXES, mailboxes);
      toast(`${mailbox.label} connected`, { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    } finally {
      busy = false;
      paint();
    }
  }

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
    await db.setMeta(MAILBOXES, mailboxes);
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
      void connectMailbox(url.value, label.value);
      url.value = '';
      label.value = '';
    };

    const counts = new Map();
    for (const receipt of receipts) {
      const key = receipt.mailbox || PRIMARY.id;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return card({}, [
      cardHeader('Mailboxes', null, {
        subtitle: `${mailboxes.length + 1} searched every scan`,
        iconName: 'bank',
      }),

      ...allMailboxes(mailboxes).map((mailbox) => listItem({
        title: mailbox.label,
        subtitle: [
          mailbox.email || (mailbox.primary ? 'the account you are signed in with' : ''),
          `${counts.get(mailbox.id) ?? 0} receipts`,
        ].filter(Boolean).join(' · '),
        leading: badge(mailbox.primary ? 'primary' : 'mail only', mailbox.primary ? 'success' : 'info'),
        trailing: mailbox.primary ? null
          : button('Remove', { onClick: () => forgetMailbox(mailbox) }),
      })),

      divider(),
      h('p', { class: 'small muted' }, [
        'Receipts arrive at more than one address in most households, and a total '
        + 'covering only one of them is misleading rather than merely incomplete. ',
        h('strong', {}, 'Apps Script can only read the mailbox it was authorised against'),
        ', so each extra account deploys its own copy of ',
        h('code', {}, 'apps-script/'),
        ' and you paste its ',
        h('code', {}, '/exec'),
        ' URL here. That account grants its own Gmail permission and can revoke '
        + 'it without touching the others — no single account ends up holding a '
        + 'key to everybody’s inbox.',
      ]),
      h('p', { class: 'small faint' },
        'Backup stays where it is. A mailbox added here answers mail searches and '
        + 'nothing else — it is never given a workbook, a Drive folder, or anything to sync.'),
      h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-2)' } }, [
        url, label, button('Connect', { onClick: submit, disabled: busy }),
      ]),
    ].filter(Boolean));
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
              + (run.truncated ? ` · stopped at ${SCAN_LIMIT}` : ''),
          leading: badge(run.error ? 'failed' : 'read', run.error ? 'warn' : 'success'),
        }))
        : []),

      good.some((run) => run.truncated)
        ? h('p', { class: 'muted small' },
          `A mailbox stopped at ${SCAN_LIMIT} messages, which is the backend's limit for `
          + 'one call. Scan again with a later date to work through the rest.')
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
      cardHeader('Matched to the bank', null, {
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
