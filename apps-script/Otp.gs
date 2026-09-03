/**
 * One-time codes, for choosing which person is using a device.
 *
 * ## What this is, and the much more important what it is not
 *
 * A household member opens FamilyOS on a phone and has to say which of the
 * people in the household they are. Today that is a stored choice anybody can
 * change. This sends a code to an address that person already owns, so the
 * choice is confirmed by something outside the device.
 *
 * **By default it is not what protects the household's records.** The PIN
 * protects them, and the encryption keys protect them. A one-time code
 * verified here tells a client that an address answered; the client is a
 * browser, and a browser is not a place where an authorisation decision can be
 * enforced. Anybody who can open the developer console can set the same flag
 * this sets.
 *
 * So the screen says so, and this file says so, because a household that
 * believed a code was guarding their bank statements would be wrong in a way
 * that costs them.
 *
 * ## Except when the household turns sign-in by code on
 *
 * An owner can escrow the data key here, per person, so that a verified code
 * opens the records on a device that has never seen this household — in place
 * of the recovery phrase. Then a code really does unlock, and the cost is that
 * **this deployment can decrypt everything.** That half of the file starts at
 * `otpEscrowKey` and explains itself there; the paragraphs above describe what
 * happens for a person the owner has not turned it on for, which is still the
 * default and still every person until somebody chooses otherwise.
 *
 * ## Why this is the first unauthenticated endpoint here
 *
 * Every other action in `doPost` runs `verifyToken` first. A code has to be
 * requestable by somebody who has not signed in yet — that is the whole point
 * — so `otpRequest` and `otpVerify` are reached *before* that check.
 *
 * That makes two of the existing protections useless here and both had to be
 * replaced rather than reused:
 *
 * 1. `enforceRateLimit` keys on the **verified** email. Pre-auth, the caller
 *    supplies the address, so the key is attacker-chosen.
 * 2. It uses `CacheService.getUserCache()`, which for an anonymous web-app
 *    caller is per-session — a fresh bucket every request. It would have
 *    limited nothing at all.
 *
 * `getScriptCache()` is shared across every caller, so the limits below are
 * real: per address, and a global ceiling on sends per hour. Without the
 * second one a deployment URL that sends messages on demand is an abuse
 * vector, and with an SMS gateway attached it is a financial one — draining
 * somebody's gateway credit is an established fraud, not a hypothetical.
 *
 * ## What is stored, and for how long
 *
 * A SHA-256 of the code, salted with the address, never the code itself. Ten
 * minutes. One use. Five wrong attempts and the code is destroyed rather than
 * left to be guessed at leisure.
 *
 * **Ten minutes from when it was issued, and a wrong guess does not move
 * that.** Writing the attempt counter back used to hand the code a fresh ten
 * minutes, because `cache.put` replaces an entry rather than extending one —
 * so four wrong guesses, which is what is allowed before the fifth destroys
 * it, could keep a ten-minute code alive for fifty. The person buying that
 * time was the person guessing. `issuedAt` is stored so the rewrite can put
 * back the life the code had left.
 *
 * Nothing had ever asked: forty-nine checks covered which codes verify, how
 * many wrong ones are allowed and what the cache gives away, and not one of
 * them moved the clock.
 */

/* global CacheService, PropertiesService, MailApp, UrlFetchApp, Utilities, fail */

/** How long a code is worth anything. */
var OTP_TTL_SECONDS = 600;

/** Wrong guesses before the code is thrown away. */
var OTP_MAX_ATTEMPTS = 5;

/** Codes per address per hour. */
var OTP_PER_ADDRESS = 5;

/** Codes this deployment will send per hour, to anybody, in total. */
var OTP_PER_DEPLOYMENT = 60;

/**
 * The actions that may be called without a token.
 *
 * A list rather than a prefix test: a prefix invites the next person to name
 * an action `otp.somethingDangerous` and have it silently become public.
 */
function otpPublicActions() {
  return ['otp.request', 'otp.verify'];
}

function otpIsPublic(action) {
  return otpPublicActions().indexOf(String(action)) !== -1;
}

/** Never the address itself as a cache key — the cache is not the place for it. */
function otpKey(prefix, address) {
  return prefix + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, otpNormalise(address)));
}

function otpNormalise(address) {
  return String(address || '').trim().toLowerCase();
}

/** The stored form of a code. Salted with the address so one hash is not another. */
function otpHash(address, code) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, otpNormalise(address) + ':' + String(code)));
}

/**
 * Six digits, from `getSecureRandomBytes` rather than `Math.random`.
 *
 * `Math.random` is not a CSPRNG and its output here would be predictable from
 * a few observed codes. The modulo bias across 4 bytes into 10^6 is under one
 * part in four thousand, which is not worth a rejection loop.
 */
function otpCode() {
  var bytes = Utilities.getSecureRandomBytes(4);
  var n = 0;
  for (var i = 0; i < 4; i += 1) n = (n * 256) + (bytes[i] & 0xff);
  var six = String(n % 1000000);
  while (six.length < 6) six = '0' + six;
  return six;
}

/**
 * Both limits, or a 429.
 *
 * The global one is checked first: an attacker spreading requests across many
 * addresses defeats the per-address limit entirely, and that is the shape of
 * the attack that costs money.
 */
function otpEnforceLimits(address) {
  var cache = CacheService.getScriptCache();
  var hour = Math.floor(Date.now() / 3600000);

  var globalKey = 'otp_all_' + hour;
  var all = Number(cache.get(globalKey) || 0) + 1;
  cache.put(globalKey, String(all), 3700);
  if (all > OTP_PER_DEPLOYMENT) {
    throw fail('this deployment has sent too many codes in the last hour', 429);
  }

  var oneKey = otpKey('otp_rate_' + hour + '_', address);
  var one = Number(cache.get(oneKey) || 0) + 1;
  cache.put(oneKey, String(one), 3700);
  if (one > OTP_PER_ADDRESS) {
    throw fail('too many codes have been sent to that address — wait an hour', 429);
  }
}

/**
 * Is this address one of the household's, and whose?
 *
 * A code is only ever sent to an address already recorded against a person.
 * Sending to anything a caller types would make this an open relay: somebody
 * could use the deployment to mail arbitrary strangers, in the household's
 * name, at the household's Gmail quota.
 *
 * @returns {{personId: string, name: string}|null}
 */
function otpPersonFor(address, channel) {
  var directory = otpDirectory();
  var wanted = otpNormalise(address);
  for (var i = 0; i < directory.length; i += 1) {
    var entry = directory[i] || {};
    var value = otpNormalise(channel === 'sms' ? entry.phone : entry.email);
    if (value && value === wanted) {
      return { personId: String(entry.personId || ''), name: String(entry.name || '') };
    }
  }
  return null;
}

/* ------------------------------------------------------------- sending */

/**
 * `unlocks` decides which of two true sentences this message carries.
 *
 * The old text said a code unlocks nothing on its own, and that stopped being
 * true for a person with an escrow. A message that understates what its own
 * code can do is the one a household would most want to have been warned by:
 * somebody receiving an unexpected code needs to know whether ignoring it is
 * enough, and with an escrow in place it is not.
 */
function otpSendEmail(address, code, name, unlocks) {
  MailApp.sendEmail({
    to: address,
    subject: 'Your FamilyOS code: ' + code,
    body: (name ? name + ',\n\n' : '')
      + 'Your code is ' + code + '. It is good for ten minutes and can be used once.\n\n'
      + (unlocks
        ? 'This code opens your FamilyOS records on a new device. Anyone who has it, '
          + 'and this message, can read them. Do not pass it on.\n\n'
          + 'If you did not ask for this, somebody is trying to get in. Ignore the code, '
          + 'and turn off signing in by code in Settings \u2192 Security.\n'
        : 'This code confirms which household member is using a device. It does not '
          + 'unlock anything on its own: the device PIN and the recovery phrase are what '
          + 'protect your records.\n\n'
          + 'If you did not ask for this, nobody has gained access \u2014 ignore it.\n'),
  });
}

/**
 * SMS, through whatever gateway the household has configured.
 *
 * Inert until `otpSmsEndpoint` and `otpSmsToken` are set in script properties.
 * There is no default gateway and no credentials in this repository, so a
 * deployment that has not been configured refuses rather than pretending.
 *
 * In India a transactional SMS also needs the sender id and template
 * registered under DLT before a gateway will deliver it. That is paperwork
 * between the household and their provider; nothing here can shortcut it, and
 * the refusal below says so rather than failing with a gateway error nobody
 * can act on.
 */
function otpSendSms(address, code, unlocks) {
  var props = PropertiesService.getUserProperties();
  var endpoint = props.getProperty('otpSmsEndpoint');
  var token = props.getProperty('otpSmsToken');

  if (!endpoint || !token) {
    throw fail('this deployment has no SMS gateway configured — set otpSmsEndpoint '
      + 'and otpSmsToken in script properties, and register the sender id and '
      + 'template with your provider first', 501);
  }

  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      to: address,
      // The code and one of two fixed sentences. A message body assembled from
      // anything the caller supplied would let somebody send text of their
      // choosing; which sentence is chosen by the escrow, not by the caller.
      text: 'Your FamilyOS code is ' + code + '. Good for ten minutes.'
        + (unlocks ? ' It opens your records on a new device \u2014 do not pass it on.' : ''),
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    throw fail('the SMS gateway refused the message', 502);
  }
}

/* ------------------------------------------------------------- actions */

function otpRequest(payload) {
  var channel = String((payload && payload.channel) || 'email');
  var address = otpNormalise(payload && payload.address);

  if (channel !== 'email' && channel !== 'sms') {
    throw fail('a code can be sent by email or sms', 400);
  }
  if (!address) throw fail('no address was given', 400);

  otpEnforceLimits(address);

  var person = otpPersonFor(address, channel);
  var code = otpCode();

  if (person) {
    CacheService.getScriptCache().put(otpKey('otp_code_', address), JSON.stringify({
      hash: otpHash(address, code),
      personId: person.personId,
      attempts: 0,
      // When it was issued, so a rewrite of the attempt counter can put back
      // the life it had left rather than a fresh ten minutes. See `otpVerify`.
      issuedAt: Date.now(),
    }), OTP_TTL_SECONDS);

    if (channel === 'sms') otpSendSms(address, code, Boolean(otpEscrowFor(person.personId)));
    else otpSendEmail(address, code, person.name, Boolean(otpEscrowFor(person.personId)));
  }

  /*
   * The same answer whether or not the address is known.
   *
   * Saying "no such person" would turn this endpoint into a way to ask which
   * addresses belong to the household, one guess at a time. The rate limit is
   * charged either way, so guessing is slow as well as uninformative.
   */
  return { sent: true, expiresInSeconds: OTP_TTL_SECONDS };
}

function otpVerify(payload) {
  var address = otpNormalise(payload && payload.address);
  var code = String((payload && payload.code) || '');
  if (!address || !code) throw fail('an address and a code are needed', 400);

  var cache = CacheService.getScriptCache();
  var key = otpKey('otp_code_', address);
  var raw = cache.get(key);
  if (!raw) throw fail('that code has expired or was never sent', 401);

  var stored;
  try { stored = JSON.parse(raw); } catch (err) {
    cache.remove(key);
    throw fail('that code has expired or was never sent', 401);
  }

  if (stored.hash !== otpHash(address, code)) {
    stored.attempts = Number(stored.attempts || 0) + 1;
    if (stored.attempts >= OTP_MAX_ATTEMPTS) {
      // Destroyed rather than left to be guessed at leisure.
      cache.remove(key);
      throw fail('too many wrong codes — ask for a new one', 429);
    }

    /*
     * Written back with the life it had left, not a fresh ten minutes.
     *
     * `cache.put` replaces an entry rather than extending one, so this line
     * used to hand the code a whole new TTL every time somebody guessed wrong
     * — and four wrong guesses are allowed before the fifth destroys it. A
     * code the household was told would last ten minutes could be kept alive
     * for fifty by the person trying to guess it. A failed attempt must
     * shorten a secret's life or leave it alone; it must never lengthen it.
     *
     * `expiresInSeconds: OTP_TTL_SECONDS` goes back to the caller from
     * `otpRequest`, so this was a promise the backend made and did not keep.
     *
     * A code issued before this change carries no `issuedAt`. It gets one
     * second, which expires it almost at once: the alternative is to trust an
     * unknown age, and the safe direction for a secret with no known issue
     * time is gone rather than kept.
     */
    var age = Math.floor((Date.now() - Number(stored.issuedAt || 0)) / 1000);
    var left = stored.issuedAt ? (OTP_TTL_SECONDS - age) : 1;
    if (left <= 0) {
      cache.remove(key);
      throw fail('that code has expired or was never sent', 401);
    }
    cache.put(key, JSON.stringify(stored), left);
    throw fail('that code is not right', 401);
  }

  // One use. A code that still works after it worked is a code somebody can
  // replay from a message that stayed in an inbox.
  cache.remove(key);

  var unlock = otpEscrowFor(stored.personId);

  return {
    verified: true,
    personId: stored.personId,
    /*
     * Which of the two things this code just did, said in the response as well
     * as on the screen.
     *
     * `identity-only` is the original meaning and still the default: the
     * address answered, and a second client built against this must not treat
     * that as an authorisation, because a browser cannot enforce one.
     *
     * `identity-and-unlock` means an escrow was released in `unlock` below and
     * the caller can now decrypt this household's records. Named differently
     * so nothing has to infer it from the presence of a field.
     */
    grants: unlock ? 'identity-and-unlock' : 'identity-only',
    // The 32 bytes that unwrap the data key, and the wrapping they open.
    // Released only here, only after the hash matched, and only for a person
    // the owner turned this on for. See the note above `otpEscrowKey`.
    unlock: unlock,
  };
}

/* ------------------------------------------------- sign-in by code: the key */

/**
 * ## The part that turns a code into access, and what it gives up
 *
 * Everything above this line is identity: a code proves an address answered,
 * and the file says at length that a browser cannot enforce more than that.
 * What follows makes a code open the data on a device that has never seen this
 * household — which is a different thing, and a weaker arrangement, and the
 * household asked for it knowing that.
 *
 * **This deployment can decrypt the household's records once this is on.**
 *
 * Not a flaw in the implementation. It is arithmetic. A new device starts with
 * nothing; for a six-digit code to yield the data key, something the code
 * reaches has to hold both the wrapped key *and* the secret that unwraps it.
 * That something is these script properties. Anyone who can open this Apps
 * Script project — the Google account that deployed it, anyone that account
 * shares the project with, anyone who phishes it — can read the escrow below
 * and decrypt every record the household has.
 *
 * The recovery phrase does not have this property: it is printed once, held on
 * paper, and never stored anywhere. Turning this on is choosing convenience
 * over that. `docs/SIGN_IN_BY_CODE.md` puts the same sentence in front of the
 * household before they choose, and the Settings row repeats it.
 *
 * ## Why the escrow is not readable without a code
 *
 * `otpEscrowFor` is reached only from `otpVerify`, after the hash matched and
 * the code was destroyed. There is no public action that reads an escrow, and
 * `signin` — the action that writes one — runs behind `verifyToken` like every
 * other authenticated action. So the exposure is exactly the one named above:
 * whoever holds the script, not whoever can reach its URL.
 *
 * ## Owner only
 *
 * A member escrowing the household's data key to the shared backend is a
 * decision about everybody's records, not their own. `manageMembers` draws the
 * same line for the same reason.
 */

/** Where one person's escrow lives. Per person, so dropping one leaves the rest. */
function otpEscrowKey(personId) {
  return 'otpEscrow_' + String(personId || '');
}

/**
 * The escrow for a person, or null.
 *
 * @returns {{key: string, wrapped: {iv: string, key: string}}|null}
 */
function otpEscrowFor(personId) {
  if (!personId) return null;
  var raw = PropertiesService.getUserProperties().getProperty(otpEscrowKey(personId));
  if (!raw) return null;

  var record;
  try { record = JSON.parse(raw); } catch (err) { return null; }

  // A half-written escrow releases nothing. The two halves are useless apart,
  // and handing back one of them would look like success to a client that then
  // adopts a wrapping it can never open.
  if (!record || !record.key || !record.wrapped || !record.wrapped.iv || !record.wrapped.key) {
    return null;
  }
  return { key: record.key, wrapped: record.wrapped };
}

/**
 * The household directory, as an array. Empty when there is none.
 *
 * Read here as well as in `otpPersonFor` because `signin` writes it: until
 * this existed the directory had no writer anywhere in the repository, so
 * `otpPersonFor` always returned null and no code was ever sent to anybody.
 * A feature configurable only by hand-editing script properties is a feature
 * nobody has.
 */
function otpDirectory() {
  var raw = PropertiesService.getUserProperties().getProperty('otpDirectory');
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (err) {
    return [];
  }
}

/** Replace this person's directory entry, keeping everybody else's. */
function otpDirectoryWrite(entry) {
  var kept = [];
  var directory = otpDirectory();
  for (var i = 0; i < directory.length; i += 1) {
    if (String((directory[i] || {}).personId) !== String(entry.personId)) kept.push(directory[i]);
  }
  kept.push(entry);
  PropertiesService.getUserProperties().setProperty('otpDirectory', JSON.stringify(kept));
}

function otpDirectoryDrop(personId) {
  var kept = [];
  var directory = otpDirectory();
  for (var i = 0; i < directory.length; i += 1) {
    if (String((directory[i] || {}).personId) !== String(personId)) kept.push(directory[i]);
  }
  PropertiesService.getUserProperties().setProperty('otpDirectory', JSON.stringify(kept));
}

/**
 * Turn sign-in by code on, off, or say who has it.
 *
 * `status` never returns key material — an owner asking which people can sign
 * in this way does not need the escrow, and a reply that carried it would put
 * the data key in a response nobody asked to receive.
 */
function otpEscrowManage(payload, context) {
  var op = String((payload && payload.op) || 'status');

  if (op === 'status') {
    if (!context.isOwner) {
      throw fail('only the account that deployed this backend can see who may sign in by code', 403);
    }
    var directory = otpDirectory();
    var out = [];
    for (var i = 0; i < directory.length; i += 1) {
      var entry = directory[i] || {};
      out.push({
        personId: String(entry.personId || ''),
        name: String(entry.name || ''),
        // Masked. An owner needs to recognise the address, not read it out of
        // a response that travels further than the screen showing it.
        email: otpMask(entry.email),
        phone: otpMask(entry.phone),
        unlocks: Boolean(otpEscrowFor(entry.personId)),
      });
    }
    return { people: out };
  }

  if (!context.isOwner) {
    throw fail('only the account that deployed this backend can change sign-in by code', 403);
  }

  var personId = String((payload && payload.personId) || '');
  if (!personId) throw fail('no person was named', 400);

  if (op === 'drop') {
    PropertiesService.getUserProperties().deleteProperty(otpEscrowKey(personId));
    otpDirectoryDrop(personId);
    return { dropped: true, personId: personId };
  }

  if (op !== 'put') throw fail('unknown sign-in operation: ' + op, 400);

  var email = otpNormalise(payload && payload.email);
  var phone = otpNormalise(payload && payload.phone);
  if (!email && !phone) throw fail('a code needs somewhere to be sent', 400);

  var key = String((payload && payload.key) || '');
  var wrapped = (payload && payload.wrapped) || null;
  if (!key || !wrapped || !wrapped.iv || !wrapped.key) {
    throw fail('sign-in by code needs both the unlock key and the wrapping it opens', 400);
  }

  /*
   * The directory first, the escrow second, and it matters which way round.
   *
   * Two properties cannot be written atomically here. If the second write
   * fails, this order leaves an address that can be sent a code and no escrow
   * to release — which is identity-only, the behaviour every person has by
   * default. The other order would leave an escrow nothing can ever reach.
   * `drop` is ordered by the same argument and comes out the other way: the
   * key goes first, so a half-failure has removed the dangerous half.
   */
  otpDirectoryWrite({
    personId: personId,
    name: String((payload && payload.name) || ''),
    email: email,
    phone: phone,
  });
  PropertiesService.getUserProperties().setProperty(otpEscrowKey(personId), JSON.stringify({
    key: key,
    wrapped: { iv: String(wrapped.iv), key: String(wrapped.key) },
    updatedAt: new Date().toISOString(),
  }));

  return { stored: true, personId: personId };
}

/** Enough of an address to recognise, not enough to use. */
function otpMask(value) {
  var text = otpNormalise(value);
  if (!text) return '';
  var at = text.indexOf('@');
  if (at > 0) return text.charAt(0) + '···@' + text.slice(at + 1);
  return text.length > 4 ? '···' + text.slice(-4) : '···';
}
