# FamilyOS — Deployment

FamilyOS is static files. There is no build step, no bundler and no server to
run: `index.html`, the `js/` tree as native ES modules, three stylesheets and
a service worker. Any static host will serve it.

---

## What the host must do

Three requirements, and only three:

1. **HTTPS.** WebCrypto, service workers and WebAuthn are unavailable outside a
   secure context. Without it, FamilyOS cannot encrypt anything, so it refuses
   to start rather than storing records in the clear.
2. **Correct MIME types.** `.js` must be served as `text/javascript`. A host
   that sends `text/plain` breaks every module import with an error that does
   not obviously say so.
3. **`sw.js` served from the root of the scope.** A service worker can only
   control paths at or below where it is served from.

Everything else — caching, offline, updates — the app handles itself.

## Recommended headers

```
Content-Type: text/javascript; charset=utf-8   # for .js
Cache-Control: public, max-age=31536000, immutable   # for js/, css/, assets/
Cache-Control: no-cache                        # for index.html and sw.js
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains
Permissions-Policy: geolocation=(), microphone=(), camera=(self), payment=()
Cross-Origin-Opener-Policy: same-origin-allow-popups
```

`index.html` and `sw.js` must not be cached hard. If they are, a browser will
keep serving an old shell that points at files a deploy has already replaced,
and the app appears to be broken until someone clears their cache.

`Cross-Origin-Opener-Policy` is `same-origin-allow-popups`, not `same-origin`:
the OAuth flow uses a popup that must be able to `postMessage` back.

The Content-Security-Policy is already in `index.html` as a meta tag. Sending
it as a header instead is stronger, because a header applies before the
document parses — copy the same directives.

## Hosting options

### GitHub Pages

The application is the repository root, so there is no build and no subtree to
push: point Pages at the default branch and it serves what is already there.

Settings → Pages → source **Deploy from a branch**, branch `main`, folder `/`.
The app lands at
`https://<user>.github.io/<repo>/`. Use exactly that origin in the OAuth
client's authorised origins, and `…/oauth-callback.html` as the redirect URI.

Pages sends correct MIME types and HTTPS. It does not let you set headers, so
the meta-tag CSP is what you get. `.nojekyll` is committed because Pages
otherwise runs the site through Jekyll, which drops files it does not
recognise — quietly, and only some of them.

**A private repository needs GitHub Pro** for Pages at all, and the published
site is public either way unless you are on Enterprise. Nothing of yours is in
it: records live in each visitor's own browser, and `familyos.config.json` is
not in the repository. A stranger who opens the URL gets an empty app.

**Connecting a hosted copy.** Because that config file is not in version
control, a copy served from a static host arrives unconfigured. Rather than
committing one family's deployment, **Settings → Google account** asks for the
two values and keeps them on the device. Neither is a secret: the OAuth client
id is public by design, and the Apps Script URL is refused by the script itself
without a token belonging to your account.

### Netlify / Vercel / Cloudflare Pages

Publish directory `.` (the repository root), no build command.

`netlify.toml` is committed and already carries all of this, so connecting the
repository needs no further settings. For a host that reads `_headers` instead:

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin-allow-popups
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/js/*
  Cache-Control: public, max-age=31536000, immutable
```

### Your own server

Nginx:

```nginx
root /var/www/my-data;
location / { try_files $uri $uri/ /index.html; }
location = /sw.js       { add_header Cache-Control "no-cache"; }
location = /index.html  { add_header Cache-Control "no-cache"; }
location /js/           { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

### A single household, no host at all

`node tools/serve.mjs` on a machine on the home network, reached over
`localhost` on that machine. No HTTPS, no hosting, no OAuth origins to
register — and no sync, because the Google client needs a registered origin.
Perfectly usable as a single-device record keeper.

---

## Releasing a new version

1. Bump `VERSION` in `sw.js`. This is the only version that matters — it is
   the cache name, and changing it is what makes the old cache get cleared.
2. If any file was added or renamed, add it to the `SHELL` array in `sw.js`.
   A module missing from that list works online and fails offline, which is
   the worst way to find out.
3. Deploy.

The new worker installs in the background and waits. Open tabs show
"A new version of FamilyOS is ready" with a reload button. Nothing is swapped
under a half-filled form.

To verify: DevTools → Application → Service Workers should show the new worker
"waiting to activate", and Cache Storage should show both cache names until
the reload.

---

## Backing up the backup

Your records live in three places, and the point of the design is that losing
any one of them is survivable:

| Where | What is there | Lost if |
| --- | --- | --- |
| The device | Everything, encrypted | Browser data cleared, device lost |
| Google Sheets | Everything except encrypted fields, which are ciphertext | Google account lost |
| Google Drive | The document files, one folder per person | Google account lost |

For a fourth copy, **Reports → Export raw data** writes CSV or Excel of every
record type. Do it yearly and keep it somewhere else. If you tick "include
encrypted fields", that file is your data in the clear — treat it exactly as
carefully as you would the documents themselves.

**Settings → Sync → Verify backup** compares row counts here against row counts
in the sheet. A backup nobody has verified is a backup nobody has; the app runs
this weekly and shows the result, but check it by hand after a large import.

---

## Monitoring a deployment

The Apps Script side writes a `_Log` tab in the workbook: timestamp, action,
detail and duration, trimmed to the last thousand lines. That is deliberately
in the spreadsheet rather than in Stackdriver, because the family that owns the
deployment can open the spreadsheet.

Quota limits worth knowing, from Google's consumer tier:

| Limit | Value | What it means here |
| --- | --- | --- |
| Script runtime | 6 minutes | Why sync is batched at 500 rows |
| URL fetch calls | 20,000/day | Token verification is cached for 5 minutes |
| Sheets cells | 10,000,000 | About 200,000 records across all tabs |
| Drive storage | Your plan | Documents are the only large thing stored |

At household scale none of these bind. The batch size exists so that a first
sync of ten thousand transactions does not hit the runtime limit and fail
halfway — which it would survive anyway, because the cursor only advances past
what actually arrived.
