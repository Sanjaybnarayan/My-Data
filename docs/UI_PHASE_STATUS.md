# v8.0 UI Phases — What Is Done, and What Is Not

Reconstructed from the commits and the docs each phase left behind, not from
memory. Phases UI-0 to UI-10 were named in their own commit subjects; UI-11
onward were built without the number in the subject, so those rows name the
commit that carries the work instead.

**No phase here is called complete on the strength of a browser passing.**
Nothing in this project has run under a screen reader, and only the last four
rows have been confirmed on a physical device — by the household using it,
not by a check.

| Phase | What it was | State | Evidence |
| --- | --- | --- | --- |
| UI-0 | Audit the existing UI against the brief | **COMPLETE** | `docs/UI_UX_AUDIT.md`, `#125` — no code changed |
| UI-1 | Design tokens | **MOSTLY_COMPLETE** | `#126`; contrast measured in `#122`, `#137` |
| UI-2 | App shell | **MOSTLY_COMPLETE** | `#127`, reworked in `#143` and again for the header |
| UI-3 | The five primary tabs | **COMPLETE** | `#127`, `#132` — five, no sixth, checked |
| UI-4 | Dashboard | **MOSTLY_COMPLETE** | `#128`; sync card added since |
| UI-5 | Notifications and what is due | **MOSTLY_COMPLETE** | `#129`, `#135`; `docs/NOTIFICATIONS_AND_DUE.md` |
| UI-6 | Chat | **MOSTLY_COMPLETE** | `#130`; `docs/CHAT_AND_E2EE.md` |
| UI-7 | Masking sweep, unopened screen | **MOSTLY_COMPLETE** | `#131` |
| UI-8 | Navigation: no module without a home | **COMPLETE** | `#132`, re-established in `#143` |
| UI-9 / UI-10 | Chat state, one-time codes | **MOSTLY_COMPLETE** | `#133` |
| UI-11 | Wellbeing and health | **BLOCKED** | `#134`; `docs/SCREEN_TIME.md`, `docs/HEALTH.md`. Not partial — see below |
| UI-12 | Secondary modules | **MOSTLY_COMPLETE** | `#139`; `docs/SECONDARY_MODULES.md` |
| UI-13 | Settings | **MOSTLY_COMPLETE** | `#140`; `docs/SETTINGS_SCREEN.md` |
| UI-14 | Accessibility | **PARTIALLY_COMPLETE** | `#136`, `#137`, `#146`; `docs/UI_ACCESSIBILITY.md`, `docs/KEYBOARD_NAVIGATION.md`, `docs/TEXT_SIZE_AND_ROTATION.md`. See below |
| UI-15 | Money and figures | **MOSTLY_COMPLETE** | `#138`; `docs/MONEY_ROUNDING.md` |
| UI-16 | Information architecture | **MOSTLY_COMPLETE** | `docs/UI_INFORMATION_ARCHITECTURE.md`, `#143` |
| UI-17 | Android polish | **PARTIALLY_COMPLETE** | `#141`, `#142`, `#143`, `#144`. See below |

## UI-11 is blocked, not partial

Calling it partial implied there was UI work left in it. There is not. What
`docs/HEALTH.md` and `docs/SCREEN_TIME.md` list as unshowable is unshowable
because **the data does not exist**, not because a screen was left unbuilt:

- `health.absent.vitals`, `sensors`, `cycle` — no device integration, and the
  brief forbids inventing one.
- `health.absent.adherence` — checked rather than assumed: **no field in any
  entity records a dose being taken**. Adherence is not computable from what
  the household has entered. Making it possible is a data-model change and a
  new capture flow, not a phase of UI.
- `health.absent.interactions`, `advice` — clinical claims this application is
  not entitled to make.
- The four `wellbeing.absent.*` entries need Android APIs that are not built.

The `CANNOT_SHOW` lists **are** the completed work: a screen that says which
of six named reasons applies, rather than one that shows nothing or, worse,
shows a number it made up.

## The two that are further behind than the rest

**UI-14, accessibility.** Heading order and accessible names were fixed across
every screen, contrast is measured rather than asserted, keyboard operability
is now driven rather than assumed (`#146`), and the layout is checked at
Android's larger text settings and in landscape. What has not happened is a
single run under a real screen reader. Every claim in
`docs/UI_ACCESSIBILITY.md` is a claim about markup — that an element has a
name, a role, a level — and none is a claim about what somebody hears. The
`listItem` fault found this week is the shape of what that misses: nine rows
carried `role="button"` correctly and answered only a pointer, and no
markup check would have caught it.

Two more since, both in `js/ui/components/modal.js` and both in the half that
markup checks *can* see — they survived because fifteen dialog checks all read
the text and none asked what a dialog was called. The title id was a constant
in a module that stacks dialogs, so `aria-labelledby` resolved to the first
match and the dialog on top was announced with the name of the one underneath
it — reached by Settings → Connection → *Changes that could not be sent* →
**Discard**, a destructive confirmation introducing itself as the list behind
it. And `focus(firstField ?? dialog)` had never worked, because the dialog had
no `tabindex` and `.focus()` on a plain `div` is a no-op, so any dialog whose
only control is its own Close button never took focus at all. Five checks now
cover them, mutation-tested both ways. `docs/KEYBOARD_NAVIGATION.md` has the
measurements.

**UI-17, Android polish.** Four real faults found and fixed — a dialog
stranded by the back button, an unredacted recents thumbnail, two navigations
at once, and an undeclared keyboard mode. All four were code-level and
verifiable without a phone. The keyboard and the bottom bar have since been
confirmed on a device by the household; the other two have not. "Polish" in
the sense the brief means — how it feels in the hand — is not a thing this
machine can report on.

## What "complete" would take, for the three that are not

- **UI-11** — a device integration or a new data model. Neither is UI work,
  and the sensor half must not be faked.
- **UI-14** — one session with a real screen reader (TalkBack on the APK,
  NVDA or VoiceOver on the web build). Everything checkable without one has
  now been checked.
- **UI-17** — a person with the APK on a phone. Two of its four fixes are
  confirmed that way; the recents thumbnail and the back-button behaviour are
  not.

None of the three can be closed from a build machine, and none is waiting on
code that could be written here.

## What is not started

Nothing in the phase list. What is outstanding is not UI work:

- **A cryptographic review.** Phase 14 of the v6.0 build cannot exceed
  MOSTLY_COMPLETE without one, and no amount of UI closes it.
- **The hosting decision.** Phase 1 is capped at 55 pending it.
- **Blocked on other parties**, not on code: ABDM participant status, a broker
  API agreement, real translation, and the SMS gateway with its DLT
  registration.

## Why nothing reads COMPLETE except UI-0, UI-3 and UI-8

Those three are complete because each is a closed question with a check that
answers it: an audit that was performed, a tab bar that has five entries and
is held to five, and a navigation in which every module the schema declares is
reachable — all three verified by tests that fail when they stop being true.

Everything else is a screen, and a screen is not finished by a passing test.
