# UI / UX Audit — Phase UI-0

**Measured on `main` at `e14919f`, 23 August 2026.** Every number came from
running the application or reading the tree, not from an earlier document.

**No code was changed for this audit.**

---

## 0. The headline: four screens are broken, and 389 checks pass

The device screenshots supplied with the v8.0 brief are the **first evidence
this application has ever produced from a real phone**. Two of them show
`[object Object]` rendered as page content — on **Chat** and on **Travel**.

The cause is one line, repeated four times:

```js
// js/modules/travel.js:31, chat.js:46, safety.js:51, belongings.js:34
await listSection('trip', route),        // the object, not its node
```

`listSection()` returns `{ node, openForm, reload, destroy }`. Putting that
object into a children array makes `append()` stringify it. Seven other callers
assign the result and insert `.node`; these four do not.

**Four screens are affected — Chat, Travel, Safety, Belongings.** Each loses its
entire record list. On Belongings the tab strip renders and the list beneath it
does not; on Travel the page is the header and the string.

### Why nothing caught it

`tests/browser.mjs` walks every module and asserts:

```js
check(`${module} renders something`, body.length > 0, 'the screen came back empty');
```

`"[object Object]"` has a length greater than zero. The check cannot tell
rendered content from a stringified object, so it passed on all four screens
every time. This is the same fault this repository keeps finding in itself — a
check that cannot fail in the way that matters — and it is the single most
important thing in this audit.

The second lesson is about the test surface, not the test: **every check in this
repository runs in desktop Chromium.** No check has ever run in an Android
WebView. Two of the three defects below could only have been found on a device.

---

## 1. Current architecture

| | |
| --- | --- |
| Framework | **None.** Native ES modules, no bundler, no build step |
| Language | JavaScript with JSDoc types, checked by `tsc --noEmit` |
| Rendering | `h(tag, props, children)` in `js/ui/dom.js`, real DOM nodes |
| Routing | Hash-based, `js/ui/router.js`, dynamic `import()` per module |
| State | Event bus (`js/core/bus.js`) + per-screen closures. No store |
| Storage | IndexedDB behind a repository layer, encrypted on device |
| Service worker | `sw.js`, 217 precached entries |
| Native | Capacitor **8.5.0** — android, ios, app, browser, filesystem, geolocation, share |
| Tests | 2,489 unit · 389 browser · typecheck budget 160 |

`h()` sets text through `textContent` and never parses a string as markup,
which is why the application does not think about escaping. The one place HTML
is unavoidable goes through `js/security/sanitize.js`.

**Sizes:** 23 modules in the schema, 24 module files, 53 entities, 614 fields,
56 domain files, 22 services, 60 exports from `js/ui/`, 1,759 lines of CSS.

## 2. Existing navigation

One source, three surfaces. `js/ui/shell.js` filters the permitted module list
and renders a desktop rail, a mobile drawer and a bottom bar from it, so a
module cannot appear in one and not another.

```js
const PRIMARY = ['dashboard', 'finance', 'documents', 'tasks', 'settings'];
```

| Viewport | Surface |
| --- | --- |
| ≥ 901px | Persistent left rail, 260px |
| ≤ 900px | Bottom bar (the five above), drawer for the other eighteen |

**This is the current bottom navigation, and it is not the one the brief
requires.** See §17.

## 3. Existing screens

23 modules: dashboard, identity, family, finance, investments, documents,
vehicles, health, insurance, property, belongings, travel, education, tasks,
calendar, notes, vault, digital, chat, safety, emergency, reports, settings.

Four screen shapes cover nearly all of them: **dashboard** (summary cards),
**entity list** (header, filter bar, table or card list), **record** (fields,
connected records, history) and **editor** (a modal built from the schema).

## 4. Existing components

60 exports across 11 files in `js/ui/`.

- **`dom.js`** — `h`, `append`, `replace`, `frag`, `text`, `$`, `$$`, `on`,
  `delegate`, `schedule`, `focus`, `trapFocus`, `announce`
- **`components/basics.js`** — `card`, `cardHeader`, `button`, `iconButton`,
  `badge`, `chip`, `avatar`, `metric`, `money`, `empty`, `skeleton`,
  `skeletonList`, `progress`, `listItem`, `dueBadge`, `dateText`, `reveal`,
  `divider`, `pageHeader`
- **`components/form.js`** — `entityForm`, one implementation for all 53 entities
- **`components/table.js`** — `entityTable`, `cellFor`, `filterBar`
- **`components/modal.js`** — `modal`, `confirm`, `inform`, `prompt`
- **`components/toast.js`**, **`components/charts.js`**, **`icons.js`**,
  **`shell.js`**, **`router.js`**, **`theme.js`**

## 5. Existing business logic

56 files in `js/domain/`, 22 in `js/services/`. Screens read through a service,
a service reads through `db.repo(...)` and never `.adapter` — enforced by a
source scan in the suite. 58 direct `db.repo()` calls remain in `js/modules/`,
recorded as a budget that has never been raised.

**Relevant to this redesign, and already built:**

- **`js/domain/reminders.js`** derives every deadline in the application by
  walking the schema for `expiry` fields, with four severities — `overdue`,
  `urgent`, `soon`, `upcoming` — plus anniversaries and upcoming bills. This is
  a real, derived data source for a Notifications tab. It exists today.
- **`js/domain/profile.js`** defines 16 profile sections spanning basics,
  contact, identity, KYC, documents, accounts, loans, investments, insurance,
  health, vehicles, property, education, employment, digital life and emergency,
  with completion scoring. `IdentityService.profiles()` computes it per person.
- **`js/domain/conflict.js`**, **`unusual.js`**, **`cfo.js`**, **`automation.js`**
  produce the "needs verification" and insight material the brief describes.

## 6. Existing integrations

Google (Gmail, Drive, Calendar) via OAuth with PKCE. Capacitor plugins for app
lifecycle, browser, filesystem, geolocation and share, plus three
locally-written Android plugins: background location, screen time, and the
foreground location service.

**There are no bank, broker, CKYCRR, DigiLocker or ABDM integrations**, and
nothing in the UI may imply otherwise.

## 7. Existing data dependencies

Everything renders from IndexedDB through the repository. There is no server.
Nothing in this redesign may require a network call to display a screen.

## 8. Existing mobile issues

| # | Issue | Evidence | Severity |
| --- | --- | --- | --- |
| 1 | `[object Object]` replaces the record list on **Chat, Travel, Safety, Belongings** | Device screenshots; source at four call sites | **Critical** |
| 2 | Native `<select>` popup renders light while the app is dark | Device screenshots (Property, Vehicles, Vault, Legal pickers) | **High** |
| 3 | Bottom navigation is not the required five | `js/ui/shell.js:26` | **High** (brief) |

Recently fixed and verified, listed so they are not re-reported: seven screens
scrolling sideways (four at 1204px on a 390px phone), 18 of 23 control kinds
under the 44px touch minimum, nine light and seven dark text pairs under WCAG
AA, and the chat encryption caveat being pushed off a 320px screen.

## 9. Existing Android issues

**The native picker follows a different theme from the page.** The activity
theme is `Theme.AppCompat.DayNight.NoActionBar`, which follows the *phone's*
setting. The web layer has three states of its own — light, dark, follow system
— stored in `localStorage`. A phone in light mode running the app in dark mode
gets a white native dropdown over a dark page, which is what the screenshots
show. There is no `res/values-night/` (only `drawable-night` for the splash).

Stated as the most likely cause, from the theme file and the screenshots. It has
not been reproduced on a device, and confirming it needs one.

**Declared permissions:** internet, coarse and fine location, background
location, foreground service (+ location), post notifications, package usage
stats. No SMS permissions in the `standard` flavour — that is what keeps Play
Protect from blocking the install.

**`POST_NOTIFICATIONS` is declared and only the location foreground service
posts anything.** A Notifications tab that implies the phone will notify you
would be claiming something the app does not do.

## 10. Existing visual inconsistencies

- **35 class names appear in JavaScript with no CSS rule anywhere.** Most are
  hooks the tests select on, which is legitimate. `input--small`, `row--center`,
  `row--tight` and `field__label` read like they were meant to be styled. This
  is how `.tab` shipped at 17px tall.
- Radii are 8 / 14 / 22px; the brief asks for 18–28px on cards.
- Seven colour literals sit outside `tokens.css`; six are cases a variable
  cannot reach (print, a fixed-ground toast, the `theme-color` meta attribute).

## 11. Existing accessibility

**Measured, not asserted** — `tests/browser.mjs` checks each on real renders:

| | |
| --- | --- |
| Touch targets ≥ 44×44 | 11 screens × 390px and 320px — **passing** |
| Text contrast, WCAG AA | 10 screens × light and dark — **passing** |
| No sideways scroll | 27 screens × 390px and 320px — **passing** |
| Reduced motion | every duration token → `0.01ms` |
| Forced colours | shadows dropped, border → `CanvasText` |
| Focus | `:focus-visible`, focus trapped in modals, returned by the drawer |
| Live regions | every toast reaches one; errors assertive |

**Not done:** no screen reader has ever been run against this — no TalkBack, no
NVDA, no VoiceOver. Non-text contrast (WCAG 1.4.11) is unchecked. Font scaling
is untested on a device.

## 12. Existing performance

**Unmeasured.** No startup, render or navigation timing exists. `entityTable`
loads up to 5,000 rows per list with no pagination, and `js/ui/components/table.js`
has a virtual-window implementation that the generic list path does not use.

## 13. Components that can be reused

`card`, `cardHeader`, `badge`, `chip`, `avatar`, `metric`, `money`, `empty`,
`skeleton`, `skeletonList`, `progress`, `listItem`, `dueBadge`, `reveal`,
`divider`, `pageHeader`, `modal`, `confirm`, `toast`, all five charts, the icon
set, `entityForm`, `Router`, `theme.js`, `trapFocus`, `announce`.

The token layer is the foundation the brief asks for and already exists: 108
custom properties, 189 declarations with the dark blocks.

## 14. Components that need refactoring

| Component | Why |
| --- | --- |
| `shell.js` | `PRIMARY` must change; needs a floating nav container and badges |
| `entityTable` | Card mode exists below 720px; needs wallet-card presentation and pagination |
| `filterBar` | Must become a bottom sheet on a phone |
| `basics.js` | Add `walletCard`, `carousel`, `bottomSheet`, `statusChip` |

## 15. Components that need replacing

Nothing needs deleting. The four screens in §0 need one line corrected each.

Native `<select>` needs replacing with a bottom sheet **for the picker case
only** — this is both the brief's instruction and the fix for issue 9.

## 16. Screens requiring redesign

In the brief's order: Dashboard, Notifications (**new**), Chat, Finance,
Profile (**new**), Identity Wallet, Document Wallet, Family, then the secondary
modules through shared components rather than one at a time.

## 17. Route migration plan

**Two of the five required tabs have no module behind them.**

| Required tab | Exists? | Backing |
| --- | --- | --- |
| Dashboard | **Yes** — `dashboard` | — |
| Notifications | **No module** | `js/domain/reminders.js` already derives severities; needs a screen |
| Chat | **Yes** — `chat` | Fix §0 first |
| Finance | **Yes** — `finance` | — |
| Profile | **No module** | `js/domain/profile.js` (16 sections) + `identity` + `settings` + `family` |

| Current route | Becomes |
| --- | --- |
| `#/dashboard` | `#/dashboard` — unchanged |
| — | `#/notifications` — **new** |
| `#/chat` | `#/chat` — promoted to primary |
| `#/finance` | `#/finance` — unchanged |
| — | `#/profile` — **new**, the control centre |
| `#/settings` | `#/profile/settings` — off the bottom bar, kept as a route |
| `#/documents` | secondary, reached from Profile and Dashboard |
| `#/tasks` | secondary, reached from Dashboard "Today" |
| `#/identity` | `#/profile/identity` — the Identity Wallet |
| `#/family`, `#/safety` | reached from Profile → Family |
| the other 13 | unchanged routes, reached contextually and by search |

**No route is deleted.** Every existing hash keeps working, so a bookmark, a
deep link or a saved back-stack entry does not break.

---

# Report

## 18. Proposed component architecture

Add to `js/ui/components/`, reusing what exists:

| New | Built from |
| --- | --- |
| `walletCard` | `card` + `money` + `badge` |
| `carousel` | scroll-snap container; keyboard and reduced-motion aware |
| `bottomSheet` | `modal` with a different presentation and `trapFocus` |
| `statusChip` | `badge` + the icon set, glyph **and** word, never colour alone |
| `attentionCard` | `reminders.js` output + `listItem` |
| `profileHeader` | `avatar` + `progress` + `profile.js` completion |
| `settingsList` | `listItem`, grouped |

## 19. Proposed navigation architecture

`PRIMARY = ['dashboard', 'notifications', 'chat', 'finance', 'profile']`, a
rounded floating container above the safe-area inset, unread badges on
Notifications and Chat, everything else reached through those five, contextual
links and search. No sixth tab. Settings inside Profile.

## 20–22. Proposed Dashboard, Notifications, Chat, Finance, Profile, Settings

As the brief specifies, with one constraint: **every figure must come from data
that exists.** The screenshots show ₹0 everywhere because the device has no
records yet — the redesign must look right empty, not only full. Each section
therefore needs a real empty state, and "Everyone safe" must not appear unless
the safety module actually says so.

The AI insight card renders `js/domain/cfo.js` and `unusual.js` output only,
with its evidence. It states nothing it cannot show a reason for.

## 23. Android-specific changes

1. Fix the native picker theme, or replace pickers with bottom sheets, so the
   page and the popup cannot disagree.
2. Add `res/values-night/` if the native theme is kept.
3. Safe areas: `viewport-fit=cover` is set and the CSS uses the insets;
   **verify on a device with a cutout** — no check covers it.
4. Back button through `@capacitor/app` mapped to router history.
5. Do not imply push notifications. `POST_NOTIFICATIONS` is declared but only
   the location service posts.

## 24. Risks

| Risk | Mitigation |
| --- | --- |
| A redesign hides a broken screen behind a nicer shell | Fix §0 **before** UI-1 |
| Checks pass while the phone is wrong | Every phase adds a check that fails first |
| "Renders something" is not "renders correctly" | Replace that assertion with one that rejects `[object Object]` and empty content |
| Wallet cards imply live bank data | Cards show only stored records and say when they were last updated |
| Settings moving under Profile loses a route | Keep `#/settings` working |
| Carousel breaks keyboard access | Tab order and reduced motion in the same commit |
| Losing a screen's business logic while restyling it | Screens already read through services; keep that seam |

## 25. Testing plan

Per phase: unit suite, typecheck against the 160 budget, browser suite, module
size, plus **a new check that would have failed before the change** — that is
the standard the rest of this repository is held to.

Additions needed:

1. **Reject `[object Object]` and near-empty content on every screen**, replacing
   the length check. Would have caught §0.
2. Assert the five primary tabs, from the same list the shell renders.
3. Extend the tap-target, contrast and overflow sweeps to the new screens.
4. Carousel: keyboard reachable, snap points, reduced motion.
5. Masking: no identifier appears unmasked in a list or in a URL.

**What no check here can do:** run in an Android WebView, drive a real device,
or use a screen reader. Two of the three live defects in §8 were found from
screenshots, not from 389 passing checks. Device screenshots after each phase
are worth more than any assertion I can write.

---

## Status

**Phase UI-0 complete. No code changed. Stopping here for instruction.**

The one thing worth doing before UI-1: the four `[object Object]` screens are
broken in the build now on the phone, and they are a one-line fix each.
