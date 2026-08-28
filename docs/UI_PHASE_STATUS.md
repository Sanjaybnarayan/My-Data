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
| UI-11 | Wellbeing and health | **PARTIALLY_COMPLETE** | `#134`; `docs/SCREEN_TIME.md`, `docs/HEALTH.md`. An honest subset only — the blocked states are the screen |
| UI-12 | Secondary modules | **MOSTLY_COMPLETE** | `#139`; `docs/SECONDARY_MODULES.md` |
| UI-13 | Settings | **MOSTLY_COMPLETE** | `#140`; `docs/SETTINGS_SCREEN.md` |
| UI-14 | Accessibility | **PARTIALLY_COMPLETE** | `#136`, `#137`; `docs/UI_ACCESSIBILITY.md`. See below |
| UI-15 | Money and figures | **MOSTLY_COMPLETE** | `#138`; `docs/MONEY_ROUNDING.md` |
| UI-16 | Information architecture | **MOSTLY_COMPLETE** | `docs/UI_INFORMATION_ARCHITECTURE.md`, `#143` |
| UI-17 | Android polish | **PARTIALLY_COMPLETE** | `#141`, `#142`, `#143`, `#144`. See below |

## The two that are further behind than the rest

**UI-14, accessibility.** Heading order and accessible names were fixed across
every screen, and contrast is measured rather than asserted. What has not
happened is a single run under a real screen reader. Every claim in
`docs/UI_ACCESSIBILITY.md` is a claim about markup — that an element has a
name, a role, a level — and none is a claim about what somebody hears. The
`listItem` fault found this week is the shape of what that misses: nine rows
carried `role="button"` correctly and answered only a pointer, and no
markup check would have caught it.

**UI-17, Android polish.** Four real faults found and fixed — a dialog
stranded by the back button, an unredacted recents thumbnail, two navigations
at once, and an undeclared keyboard mode. All four were code-level and
verifiable without a phone. The keyboard and the bottom bar have since been
confirmed on a device by the household; the other two have not. "Polish" in
the sense the brief means — how it feels in the hand — is not a thing this
machine can report on.

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
