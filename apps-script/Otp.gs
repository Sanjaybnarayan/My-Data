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
 * **It is not what protects the household's records.** The PIN protects them,
 * and the encryption keys protect them. A one-time code verified here tells a
 * client that an address answered; the client is a browser, and a browser is
 * not a place where an authorisation decision can be enforced. Anybody who can
 * open the developer console can set the same flag this sets.
 *
 * So the screen says so, and this file says so, because a household that
 * believed a code was guarding their bank statements would be wrong in a way
 * that costs them.
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
  var raw = PropertiesService.getUserProperties().getProperty('otpDirectory');
  if (!raw) return null;

  var directory;
  try { directory = JSON.parse(raw); } catch (err) { return null; }

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

function otpSendEmail(address, code, name) {
  MailApp.sendEmail({
    to: address,
    subject: 'Your FamilyOS code: ' + code,
    body: (name ? name + ',\n\n' : '')
      + 'Your code is ' + code + '. It is good for ten minutes and can be used once.\n\n'
      + 'This code confirms which household member is using a device. It does not '
      + 'unlock anything on its own: the device PIN and the recovery phrase are what '
      + 'protect your records.\n\n'
      + 'If you did not ask for this, nobody has gained access — ignore it.\n',
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
function otpSendSms(address, code) {
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
      // The code and nothing else. A message body assembled from anything the
      // caller supplied would let somebody send text of their choosing.
      text: 'Your FamilyOS code is ' + code + '. Good for ten minutes.',
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
    }), OTP_TTL_SECONDS);

    if (channel === 'sms') otpSendSms(address, code);
    else otpSendEmail(address, code, person.name);
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
    cache.put(key, JSON.stringify(stored), OTP_TTL_SECONDS);
    throw fail('that code is not right', 401);
  }

  // One use. A code that still works after it worked is a code somebody can
  // replay from a message that stayed in an inbox.
  cache.remove(key);

  return {
    verified: true,
    personId: stored.personId,
    // Said in the response as well as on the screen, so a second client built
    // against this cannot quietly treat it as an authorisation.
    grants: 'identity-only',
  };
}
