/**
 * English.
 *
 * The authoritative catalogue: every key the application asks for is defined
 * here, and `coverage()` measures every other language against it. There are
 * no schema labels in this file, because English labels already live in
 * js/data/schema.js and a second copy of 345 of them is the drift this
 * repository keeps finding.
 *
 * Two conventions worth keeping when a second language arrives.
 *
 * **A sentence is one key.** `dates.inDays` is `in {n} days`, not `in` +
 * number + `days`. Assembling a sentence from fragments bakes English word
 * order into the code: Hindi puts the verb last, German splits it, and
 * "Add {noun}" is not "Add" followed by a noun in any of them. Every key here
 * that carries a variable carries the whole sentence around it.
 *
 * **Nothing is case-converted at the point of use.** `No {many} yet` takes the
 * label as it is given rather than lowercasing it, because German capitalises
 * every noun and a language without letter case has nothing to convert.
 */

import { signinStrings } from './en-signin.js';

export const strings = {
  ...signinStrings,

  // Dates. Abbreviated month names, because a table column has no room for
  // the full ones and a household reading its own records knows which is which.
  'month.1': 'Jan',
  'month.2': 'Feb',
  'month.3': 'Mar',
  'month.4': 'Apr',
  'month.5': 'May',
  'month.6': 'Jun',
  'month.7': 'Jul',
  'month.8': 'Aug',
  'month.9': 'Sep',
  'month.10': 'Oct',
  'month.11': 'Nov',
  'month.12': 'Dec',

  // Day and instant. The order of the parts is inside the string so a language
  // that writes the year first can move it.
  'date.day': '{d} {month}',
  'date.dayWithYear': '{d} {month} {year}',
  'date.instant': '{day}, {hh}:{mm}',

  // Relative days. Singular and plural are separate keys rather than an `s`
  // appended, which is a rule that holds in English and almost nowhere else.
  'date.today': 'today',
  'date.tomorrow': 'tomorrow',
  'date.yesterday': 'yesterday',
  'date.inDays': 'in {n} days',
  'date.daysAgo': '{n} days ago',

  // Generic record screens. `{one}` and `{many}` are schema labels, already
  // translated by the time they arrive here.
  'record.add': 'Add {one}',
  'record.save': 'Save changes',
  'record.emptyTitle': 'No {many} yet',
  'record.search': 'Search {many}',
  'record.allOf': 'All {many}',
  'record.addFirst': 'Add the first {one}',
  'record.added': '{One} added',
  'record.deleted': '{One} deleted',
  'record.saved': 'Saved',
  'record.editTitle': 'Edit {one}',
  'record.newTitle': 'New {one}',
  'record.deleteTitle': 'Delete this {one}?',
  'record.deleteBlockedTitle': 'This {one} cannot be deleted yet',

  // Safety. The first module written after this catalogue existed, and the
  // reason the unrouted count did not go up when Phase 15 landed.
  'safety.title': 'Safety',
  'safety.subtitle': 'Where people were, and the places that matter',
  'safety.limits.title': 'What this does not do',
  'safety.limits.background': 'FamilyOS can record where this phone is while it is closed, but only after somebody switches it on and Android is set to allow location "all the time". While it runs there is a notification you cannot dismiss, so a phone that is recording always says so. It is off until you turn it on, and nothing starts it by itself.',
  'safety.trail.warning': 'A phone that is recording shows a notification the whole time. If you do not see one, it is not recording.',
  'identity.provenanceNote': 'These are your own notes on what each institution holds, taken from statements, portals and letters. Nothing here is fetched from the Central KYC Records Registry, and nothing here is verified \u2014 only compared.',
  'finance.subtitle': 'Where the money is, and where it went',
  'finance.addTransaction': 'Add transaction',
  'crud.add': 'Add',
  'identity.title': 'Identity',
  'identity.subtitle': 'Who everyone is, and what each institution holds',
  'finance.title': 'Finance',
  'consent.screenTime.title': 'See how long someone used the applications on this phone',
  'consent.screenTime.what': 'Which applications were opened on this device and for how long. Not what was typed, read, or sent \u2014 Android does not offer that and this does not ask for it.',
  'consent.screenTime.moment': 'Before anything is read, from the person\u2019s record.',
  'consent.screenTime.without': 'Nothing is read. This is the one thing in this list that a \u201cno\u201d actually switches off, rather than only recording that nobody was asked.',
  'trail.blocked.unsupported': 'this device has no FamilyOS location service — a browser cannot record a position while it is closed',
  'trail.blocked.foreground': 'FamilyOS has not been allowed to read this phone\u2019s location at all',
  'trail.blocked.background': 'FamilyOS may read the location only while it is open. Recording a trail needs "Allow all the time", which Android only offers in settings',
  'trail.blocked.notifications': 'Android will not let a recording run without a notification saying so, and notifications are switched off for FamilyOS',
  'screentime.unsupported': 'this device has no FamilyOS screen-time service — a browser cannot see which applications were used',
  'screentime.notPermitted': 'FamilyOS has not been given usage access. Android only offers it in settings, not as a prompt',
  'screentime.withheld.noPerson': 'nobody has said whose phone this is, so there is no one to ask',
  'screentime.withheld.unasked': 'this person has not been asked whether their screen time may be read',
  'screentime.withheld.refused': 'this person was asked and said no',
  // A stored link that is not a link. Shown as the text it is rather than
  // hidden, so a household can see what is actually in the record.
  'url.notLinked': 'Not opened as a link: only http, https, mailto and tel addresses are.',

  // Notifications. Raised by the page when the application is opened — there
  // is no server and no push subscription, so nothing arrives while it is
  // closed, and this card must not suggest otherwise.
  'notify.title': 'Notifications on this device',
  'notify.what': 'When you open FamilyOS, it can raise one notification a day for anything due or lapsing \u2014 a passport, a policy, a course of medicine, a bill. It is the same list the Notifications tab shows.',
  'notify.state.granted': 'allowed',
  'notify.state.denied': 'refused',
  'notify.state.default': 'not asked',
  'notify.state.unsupported': 'not available here',
  'notify.ask': 'Allow notifications',
  'notify.after.granted': 'Allowed. One notification a day at most, and only when the application is opened.',
  'notify.after.denied': 'Refused, and a browser will not ask a second time. If you change your mind, it is in this site\u2019s own settings in your browser \u2014 not here.',
  'notify.after.unsupported': 'This build has no notification service, so nothing can be raised. Asking would show nothing at all.',
  'notify.notPush': 'These are not push notifications. There is no server behind FamilyOS, so nothing is delivered while it is closed \u2014 they are raised when you next open it.',

  // How a date that has come round is said. One phrase per expiry field in
  // three tenses, because the field label is already a phrase and conjugating
  // a verb onto it produced "expires on expires today" — and, worse, "next
  // dose on expired", which is a claim about somebody's vaccination that this
  // application is in no position to make. See js/domain/duewords.js.
  'due.line.ahead.one': '{title} {phrase} in {days} day',
  'due.line.ahead.many': '{title} {phrase} in {days} days',
  'due.line.today': '{title} {phrase}',
  'due.line.past.one': '{title} {phrase} {days} day ago',
  'due.line.past.many': '{title} {phrase} {days} days ago',

  // The fallback, for a dated field nobody has written words for. It names the
  // date instead of guessing at a verb, and a test makes sure no field in the
  // schema reaches it.
  'due.unknown': '{title} \u2014 {label}: {when}',
  'due.noDate': 'no date',
  'due.line.today.bare': 'today',
  'due.bare.ahead.one': 'in {days} day',
  'due.bare.ahead.many': 'in {days} days',
  'due.bare.past.one': '{days} day ago',
  'due.bare.past.many': '{days} days ago',

  'due.expiresOn.ahead': 'expires',
  'due.expiresOn.today': 'expires today',
  'due.expiresOn.past': 'expired',
  'due.nextDueOn.ahead': 'next due',
  'due.nextDueOn.today': 'due today',
  'due.nextDueOn.past': 'was due',
  'due.maturesOn.ahead': 'matures',
  'due.maturesOn.today': 'matures today',
  'due.maturesOn.past': 'matured',
  'due.rcExpiresOn.ahead': 'registration expires',
  'due.rcExpiresOn.today': 'registration expires today',
  'due.rcExpiresOn.past': 'registration expired',
  'due.insuranceExpiresOn.ahead': 'insurance expires',
  'due.insuranceExpiresOn.today': 'insurance expires today',
  'due.insuranceExpiresOn.past': 'insurance expired',
  'due.pucExpiresOn.ahead': 'emissions certificate expires',
  'due.pucExpiresOn.today': 'emissions certificate expires today',
  'due.pucExpiresOn.past': 'emissions certificate expired',
  'due.nextServiceOn.ahead': 'next service due',
  'due.nextServiceOn.today': 'service due today',
  'due.nextServiceOn.past': 'service was due',
  'due.followUpOn.ahead': 'follow-up due',
  'due.followUpOn.today': 'follow-up due today',
  'due.followUpOn.past': 'follow-up was due',
  'due.endsOn.ahead': 'ends',
  'due.endsOn.today': 'ends today',
  'due.endsOn.past': 'ended',
  'due.nextDoseOn.ahead': 'next dose due',
  'due.nextDoseOn.today': 'next dose due today',
  'due.nextDoseOn.past': 'next dose was due',
  'due.date.ahead': 'is',
  'due.date.today': 'is today',
  'due.date.past': 'was',
  'due.renewsOn.ahead': 'renews',
  'due.renewsOn.today': 'renews today',
  'due.renewsOn.past': 'renewed',
  'due.leaseEndsOn.ahead': 'lease ends',
  'due.leaseEndsOn.today': 'lease ends today',
  'due.leaseEndsOn.past': 'lease ended',
  'due.taxPaidTill.ahead': 'tax cover ends',
  'due.taxPaidTill.today': 'tax cover ends today',
  'due.taxPaidTill.past': 'tax cover ended',
  'due.nextFeeDueOn.ahead': 'next fee due',
  'due.nextFeeDueOn.today': 'fee due today',
  'due.nextFeeDueOn.past': 'fee was due',
  'due.agreementEndsOn.ahead': 'agreement ends',
  'due.agreementEndsOn.today': 'agreement ends today',
  'due.agreementEndsOn.past': 'agreement ended',
  'due.dueOn.ahead': 'due',
  'due.dueOn.today': 'due today',
  'due.dueOn.past': 'was due',

  // The two strings a broken Google sign-in actually needs. Not folded: the
  // commonest sign-in failure has nothing to do with scopes.
  'settings.origin.title': 'Where this copy is served from',
  'settings.origin.why': 'On the OAuth client \u2014 not the consent screen \u2014 these two must be listed exactly, or Google refuses the sign-in before it asks you anything.',

  // The OAuth scope list, folded away: setup reference rather than a control.
  'settings.scopes.title': 'Google permissions',
  'settings.scopes.where': 'Cloud Console \u2192 APIs & Services \u2192 OAuth consent screen \u2192 Scopes',

  // The Settings screen's sections. The order keeps the reasoning already
  // here: privacy leads because, as its own card says, it is the question
  // people actually have.
  'settings.group.data': 'Your data, and where it is',
  'settings.group.device': 'This device',
  'settings.group.agreed': 'Who has agreed to what',
  'settings.group.connections': 'Connections',
  'settings.group.wrong': 'When something goes wrong',
  'settings.group.about': 'About',

  // A tenancy recorded in two places. Questions, never verdicts: only the
  // household knows which record is current, and one may be last year's
  // tenant nobody deleted.
  'tenancy.title': 'Tenancies recorded in two places',
  'tenancy.count': '{n} to settle',
  'tenancy.lead': 'A tenancy can be written on the property itself and in a tenant record, and this application reads a different one for each question \u2014 rent receipts come from the property, and a reminder from whichever record carries the date. Where the two do not match, only you know which is current.',
  'tenancy.unnamed': 'An unnamed property',
  'tenancy.state.disagree': 'Two answers',
  'tenancy.state.onlyProperty': 'No tenant record',
  'tenancy.state.onlyTenant': 'Not on the property',
  'tenancy.cost.onlyProperty': 'The tenancy is on the property and there is no tenant record, so nothing warns when the agreement ends.',
  'tenancy.cost.onlyTenant': 'The tenancy is in a tenant record and not on the property, so no rent receipt can be produced and the rent is not counted in reports.',
  'tenancy.cost.disagree': 'The property and the tenant record say different things. Receipts use the property; reminders use whichever carries the date.',

  // A record saying two things about itself, on the secondary modules.
  'upkeep.tasks.title': 'Tasks that say two things',
  'upkeep.tasks.lead': 'A status and a completion date are set separately. These are not overdue \u2014 a due date already appears on the Notifications tab \u2014 they are records disagreeing with themselves.',
  'upkeep.tasks.unnamed': 'An unnamed task',
  'upkeep.task.doneNoDate': 'Marked done, with no date saying when.',
  'upkeep.task.dateNotDone': 'Has a completion date, and is not marked done.',
  'upkeep.tag.doneNoDate': 'No date',
  'upkeep.tag.dateNotDone': 'Two answers',
  'upkeep.reach.title': 'Could this list be used in a hurry?',
  'upkeep.reach.badge': 'Worth fixing',
  'upkeep.reach.nobody': 'There are no emergency contacts recorded at all.',
  'upkeep.reach.noFirst': 'No contact has a priority, so nothing says who to ring first.',
  'upkeep.reach.tied': 'More than one contact claims first place, so \u201cwho do I ring first\u201d has no single answer:',
  'upkeep.reach.noPhone': 'Recorded with no phone number, which is the only thing anybody uses in the first ten minutes:',

  // Where a module's derived answer already lives. A second implementation of
  // one question is the fault this repository has spent the week removing.
  'secondary.title': 'Where the answer to this already is',
  'secondary.insurance': 'Policies with nobody named on them are reported by the estate review, together with accounts and holdings \u2014 one list rather than three that could disagree.',
  'secondary.digital': 'Which digital accounts say what should happen to them, and which say nothing, is reported by the estate review alongside every other nomination.',
  'secondary.education': 'A fee falling due and a certificate running out are both reminders already, so they appear on the Notifications tab with everything else that is due.',
  'secondary.notes': 'Nothing here is worked out from anything else. A note is what somebody wrote, and this screen has no view of it worth adding.',
  'secondary.go.insurance': 'Open the estate review',
  'secondary.go.digital': 'Open the estate review',
  'secondary.go.education': 'Open Notifications',

  // Health. Records of what somebody was told — never a medical opinion, and
  // the absences below say which of them are deliberate.
  'health.title': 'Health',
  'health.subtitle': 'Records of what somebody was told \u2014 consultations, medicines, jabs and appointments.',
  'health.questions.title': 'What these records do not agree about',
  'health.questions.count': '{n} to settle',
  'health.questions.none': 'nothing contradictory',
  'health.questions.noneMeans': 'Nothing in these records contradicts itself and no date they set has gone by unanswered. That is a statement about the records, not about anybody\u2019s health \u2014 this application has no way of knowing that.',
  'health.questions.lead': 'Each of these is the records saying two things, or a date they set going by with nothing recorded either way. Only the household can settle them.',
  'health.q.unnamed': 'an unnamed entry',
  'health.q.since': 'since {days} days ago',
  'health.q.stillTaking': 'Is {subject} still being taken? The record says ongoing, and its end date has passed',
  'health.q.stillTaking.tag': 'Two answers',
  'health.q.stoppedWhen': 'When did {subject} stop? It is marked no longer ongoing, with no end date',
  'health.q.stoppedWhen.tag': 'No date',
  'health.q.didTheyGo': 'Did the appointment for {subject} happen? It is still marked scheduled and the date has passed',
  'health.q.didTheyGo.tag': 'Unanswered',
  'health.q.nextDose': 'Has the next dose of {subject} been given? The date it names has passed and no later dose is recorded',
  'health.q.nextDose.tag': 'No later dose',
  'health.q.followedUp': 'Was {subject} followed up? The follow-up date has passed and nothing here says either way',
  'health.q.followedUp.tag': 'Nothing recorded',
  'health.current.title': 'Being taken, and coming up',
  'health.current.ahead': 'ahead',
  'health.current.derived': 'Worked out from the dates on each record rather than from the \u201congoing\u201d tick box, which starts ticked and is rarely unticked \u2014 a list built from it alone would show a course that finished months ago.',
  'health.absent.title': 'What this screen cannot show',
  'health.absent.sensors': 'No steps, exercise, sleep or activity. Those come from a phone\u2019s sensors or a wearable, and this application reads neither.',
  'health.absent.vitals': 'No heart rate, blood pressure, blood oxygen, temperature or body composition. Nothing here is measured \u2014 every figure in these records is one a person wrote down after being told it.',
  'health.absent.cycle': 'No cycle tracking or predictions. A prediction is a clinical claim, and this application is in no position to make one.',
  'health.absent.interactions': 'Nothing checks these medicines against each other. There is no drug database here, so two medicines appearing side by side means only that both were written down.',
  'health.absent.adherence': 'No figure for doses taken or missed. Nothing records a dose being taken, so any percentage would be arithmetic on data that does not exist.',
  'health.absent.advice': 'No advice, no diagnosis and no score. These are records of what somebody was told, kept so a household can find them again \u2014 they are not a second opinion.',

  // Screen time, on a screen. Every absence below is named because a phone's
  // own wellbeing page shows it and this one deliberately does not.
  'wellbeing.title': 'Screen time',
  'wellbeing.subtitle': 'How long applications were open on this phone, over the last seven days.',
  'wellbeing.hoursMinutes': '{hours}h {minutes}m',
  'wellbeing.shareOf': '{app}, {percent} per cent of the time counted',
  'wellbeing.week.title': 'The last seven days',
  'wellbeing.week.window': 'Counted from what Android recorded over the last seven days. A phone that was switched off for some of them still reports seven, so there is no daily average here \u2014 it would look like a habit and be an artefact.',
  'wellbeing.week.more': '{n} more applications, not listed.',
  'wellbeing.none.title': 'Nothing was recorded',
  'wellbeing.none.message': 'Android has usage access and reported no foreground time for any application over the last seven days.',
  'wellbeing.blocked.title': 'There is no reading',
  'wellbeing.blocked.badge': 'Not read',
  'wellbeing.blocked.noPrompt': 'Usage access is not a permission Android will prompt for. The only way to grant it is the settings page itself, which is what this button opens.',
  'wellbeing.blocked.open': 'Open usage access settings',
  'wellbeing.blocked.consent': 'Where consent is recorded',
  'wellbeing.blocked.noPerson': 'Nobody is signed in on this device, so there is no one whose screen time this would be and no one to ask.',
  'wellbeing.blocked.unasked': 'The person this phone belongs to has not been asked whether their screen time may be read. Until they are, nothing is read \u2014 the reading is not taken and then hidden.',
  'wellbeing.blocked.refused': 'The person this phone belongs to was asked and said no. Nothing is read. That answer stands until they change it where it was recorded.',
  'wellbeing.blocked.noPlugin': 'This build has no screen-time service. A browser cannot see which applications were used, and the Android build is where this screen has something to show.',
  'wellbeing.blocked.noAccess': 'FamilyOS has not been given usage access on this phone, so Android will not say which applications were open.',
  'wellbeing.blocked.deviceRefused': 'Usage access was granted and the phone refused the reading anyway. It may have been withdrawn since this screen opened.',
  'wellbeing.blocked.unknown': 'This screen was told a reason it does not recognise, so it is not guessing at one. Nothing was read.',
  'wellbeing.absent.title': 'What this screen cannot show',
  'wellbeing.absent.categories': 'No categories. \u201cSocial\u201d, \u201cproductivity\u201d and the rest are a taxonomy applied to package names; Android reports the package and nothing else, and a built-in list of guesses would be wrong for every application it had never heard of.',
  'wellbeing.absent.motion': 'No screen time while walking or driving. That needs motion sensors this application does not read, and inferring it from usage figures alone would be invention.',
  'wellbeing.absent.hearing': 'No listening volume or hearing exposure. Nothing here comes from the audio system.',
  'wellbeing.absent.limits': 'No app timers, no bedtime mode and no focus mode. Those enforce something on the phone, and this build only reads. A timer that did not actually stop anything would be worse than none.',
  'wellbeing.appName': 'Package names, not the names a launcher shows. Android reports the package, and a friendlier name here would be this screen guessing which application you are looking at.',
  'safety.trail.title': 'Recording where this phone is',
  'safety.trail.off': 'Off. Nothing is recorded while FamilyOS is closed.',
  'safety.trail.on': 'On. This phone is recording its position, and says so in a notification.',
  'safety.trail.start': 'Start recording',
  'safety.trail.stop': 'Stop recording',
  'safety.trail.settings': 'Open Android settings',
  'safety.trail.pending': '{n} readings taken and not yet saved',
  'safety.trail.untested': 'This has never been run on a real phone. It compiles, which is a different thing.',
  'safety.limits.geofence': 'Zones are circles this app measures against a reading it already has. They are not registered with the phone, so crossing one does not wake anything.',
  'safety.where.title': 'Where everyone was',
  'safety.where.count': '{n} of {total} with a reading',
  'safety.where.nobody': 'Nobody is on file yet',
  'safety.where.readMine': 'Record where I am',
  'safety.where.recorded': 'Position recorded',
  'safety.where.noPerson': 'This sign-in is not linked to a person, so there is nobody to record a position for.',
  'safety.fresh': 'just now',
  'safety.ageing': 'a while ago',
  'safety.stale': 'old',
  'safety.crossings.title': 'Zone crossings',
  'safety.crossings.arrived': 'Arrived at {zone}',
  'safety.crossings.left': 'Left {zone}',
  'safety.crossings.unsure': 'Noticed at {at}, but {hours} hours passed since the previous reading — the crossing happened somewhere in between',
  'safety.crossings.approx': 'when is a guess',

  // Whereabouts, in words. Sentences rather than fragments, so a language that
  // orders them differently can say so.
  'safety.none': '{name} has no location on this device.',
  'safety.seen': '{name} was {place} {when}.',
  'safety.seenStale': '{name} was {place} {when}. That is the last reading on this device, and it is old enough that it says nothing about now.',
  'safety.atZone': 'at {zone}',
  'safety.awayFromZones': 'away from every saved zone',
  'safety.justNow': 'just now',
  'safety.minutesAgo': '{n} minutes ago',
  'safety.hoursAgo': '{n} hours ago',

  // Why a position could not be read. Separate keys because "you said no" and
  // "the device could not get a fix" want different answers from the reader.
  'position.denied': 'This device has not been given permission to share its location. It can be granted in the browser or system settings for this app.',
  'position.unavailable': 'The device could not work out where it is. Indoors and underground are the usual reasons.',
  'position.timedOut': 'The device took too long to find a position.',
  'position.unsupported': 'This device has no location service available to the app.',
  'position.unknown': 'The location could not be read.',

  // What a notification is allowed to say. Read off a lock screen by whoever
  // is holding the phone, so it carries how many and how urgent and never
  // what: the body used to be the full reminder sentence, which put a vehicle
  // registration number and a household's rent outside the application's own
  // PIN. `describeReminder` still says everything, in the places behind it.
  'notify.push.title': '{n} thing(s) need attention',
  'notify.push.lapsed': '{overdue} already lapsed. Open FamilyOS to see what.',
  'notify.push.today': 'Something is due today. Open FamilyOS to see what.',
  'notify.push.soon': 'The next one is due in {days} day(s). Open FamilyOS to see what.',

  // What the portfolio can say about an RD instalment against the ledger.
  // `ambiguous` is deliberately not phrased as a problem to fix: instalments
  // are the same amount every month, so two debits a day apart are genuinely
  // indistinguishable and naming both is the honest answer.
  'instalments.title': 'Recurring deposit instalments',
  'instalments.subtitle': '{matched} of {total} match a row in the ledger',
  'instalments.unmatched': '{n} instalment(s) have no bank row in the ledger for the same '
    + 'amount within a day. Either the payment is not imported yet, or it did not leave the '
    + 'account.',
  'instalments.ambiguous': '{n} could be more than one row. Instalments are the same amount '
    + 'every month, so nothing here can tell two debits a day apart apart — both are kept and '
    + 'neither is chosen.',

  // Rule 57 counted across a household. `scopeCapped` exists because the old
  // sentence said "movements" while counting only the sample it had walked.
  'explain.scopeAll': '{total} movements',
  'explain.scopeCapped': 'the {examined} most recent of {total} movements',
  'explain.counts': 'Of {scope}: {documented} are made only of rows parsed from a statement, '
    + '{partlyTyped} include a row somebody typed, and {unexplained} have no rows behind them '
    + 'at all. None of this was checked by a person.',
  'explain.unreadable': '{n} could not be read on this device and are in none of those '
    + 'three counts.',

  // What a report says when part of it could not be read. On the document
  // itself, in `summary`, which leads every format — a report is kept, and the
  // moment it was made is forgotten long before it is read again.
  'report.incomplete.label': 'Incomplete',
  'report.incomplete.text': '{n} record type(s) could not be read on this device ({names}). '
    + 'This report is missing them — it is not a statement that there are none.',
  'report.emptyPeriod': 'No records fall in this period.',

  // The bottom bar's third badge state. A tab with no badge means nothing is
  // late; this means the check itself did not finish, which is a different
  // thing and used to look identical.
  // Whole sentences including the tab's own name, not fragments joined with a
  // comma: a language that orders "Notifications, 3 things need attention"
  // differently cannot do it from pieces.
  'attention.tabUnknown': '{label}, how many things need attention could not be worked out',
  'attention.tabOne': '{label}, 1 thing needs attention',
  'attention.tabMany': '{label}, {n} things need attention',

  // What a mailbox scan is able to say about itself. `unreachable` is the one
  // that had no words at all: messages Gmail listed and refused to hand over
  // used to be dropped silently, so a scan that lost a third of the mail read
  // exactly like a mailbox with less in it.
  'receipts.scan.unreachable': 'Gmail listed {n} message(s) it would not hand over, so they '
    + 'were not read. The counts above are what came back, not what the mailbox holds. '
    + 'Scanning again usually reaches them — a refusal is normally a rate limit.',
  'receipts.scan.unreachableShort': '{n} not handed over',
  'receipts.scan.truncated': 'A mailbox still has more than this scan could reach — either a '
    + 'single day holds more than {limit} receipts, or there were more than {passes} calls\u2019 '
    + 'worth. Press Scan again and it carries on from where it stopped.',
  'receipts.scan.nothingRecognised': 'Mail came back but none of it looked like a receipt — '
    + 'usually a shop that sends from a different address than expected. The From line of one '
    + 'of those emails, added as a shop below, will fix it.',
  'receipts.scan.mailboxFailed': 'A mailbox that could not be read is usually one whose Google '
    + 'account is signed out, or whose backend has not been redeployed since Gmail.gs was '
    + 'added. The others were still read.',

  // The card that raises an alarm. Every one of these says, or is written so
  // the card around it says, that nothing here sends anything. A household
  // discovering that after pressing the button is the failure this guards.
  'sos.card.title': 'Raise an alarm',
  'sos.card.what': 'This writes a message saying you need help, with your position if it can be '
    + 'read, and hands it to your phone to send. Nothing here sends it for you — there is no '
    + 'server behind this application.',
  'sos.card.raise': 'Raise an alarm',
  'sos.confirm.title': 'Raise an alarm?',
  'sos.confirm.message': 'This does not call anybody and does not send a message on its own. It '
    + 'writes the message and opens your phone’s share sheet so you can send it. If this is an '
    + 'emergency, call the emergency services first.',
  'sos.confirm.yes': 'Write the message',
  'sos.reason.title': 'What is wrong?',
  'sos.reason.label': 'Anything you want the message to say (optional)',
  'sos.reason.placeholder': 'Fallen, cannot get up',
  'sos.reason.save': 'Continue',
  'sos.sent.title': 'Your message',
  'sos.sent.notSent': 'This has NOT been sent. It is recorded here and the text is above — send '
    + 'it from your phone, or read it out.',
  'sos.sent.close': 'Done',

  // The SOS message itself, which somebody sends from their own phone.
  'sos.needsHelp': '{name} needs help.',
  'sos.near': 'Near {zone}.',
  'sos.map': 'Map: {url}',
  'sos.accuracy': 'Accurate to about {n} m.',
  'sos.noPosition': 'No position could be read on this device.',
  'safety.somebody': 'This person',

  // How coarse a fix is, said in the units a person thinks in.
  'accuracy.unstated': 'the device did not say how accurate this is',
  'accuracy.metres': 'accurate to about {n} m',
  'accuracy.kilometres': 'accurate to about {n} km, so this is a neighbourhood and not a place',

  // Chat. The honesty lines are above the conversations on purpose: somebody
  // deciding whether to type something sensitive decides before they scroll.
  /* ----------------------------------------------------------- dashboard */
  'dash.attention.clear': 'Nothing needs attention',
  'dash.attention.clearBody': 'Nothing recorded here is late or falls due this week.',
  'dash.attention.one': '1 thing needs your attention',
  'dash.attention.many': '{n} things need your attention',
  'dash.attention.seeAll': 'See all {n}',
  'dash.attention.open': 'Open notifications',
  'dash.wallet.title': 'Your wallet',
  'dash.wallet.netWorth': 'Family net worth',
  'dash.wallet.split': '{assets} assets · {owed} owed',
  'dash.wallet.recorded': 'From what has been recorded',
  'dash.wallet.staleOne': '1 holding is valued at cost',
  'dash.wallet.staleMany': '{n} holdings are valued at cost',
  'dash.wallet.partial': 'partial',
  'dash.wallet.owed': 'Owed',
  'dash.wallet.held': 'Held',
  'dash.wallet.cards': 'Wallet cards',
  'dash.wallet.empty.title': 'Nothing recorded yet',
  'dash.wallet.empty.message': 'Add a bank account, an investment or a property and the figures appear here.',
  'dash.wallet.empty.action': 'Add an account',
  'dash.family.title': 'Household',
  'dash.family.one': '1 person',
  'dash.family.many': '{n} people',
  'dash.family.open': 'Open the family',
  'dash.family.safety': 'Safety',
  'dash.family.empty.title': 'No people yet',
  'dash.family.empty.message': 'Add the people in your household and their records gather here.',
  'dash.family.empty.action': 'Add a person',
  'dash.papers.title': 'Papers',
  'dash.papers.running': 'Papers running out',
  'dash.papers.clear': 'Nothing recorded here expires in the next 45 days.',
  'dash.papers.open': 'Open documents',
  'dash.dateFallback': 'Date',

  /* ------------------------------------------------------- notifications */
  'notifications.title': 'Notifications',
  'notifications.subtitle': 'Dates this household has recorded, and what is coming',
  'notifications.group.overdue': 'Already past',
  'notifications.group.urgent': 'This week',
  'notifications.group.soon': 'Soon',
  'notifications.group.upcoming': 'Later',
  'notifications.overdueBlurb': 'These dates have gone by.',
  'notifications.empty.title': 'Nothing is due',
  'notifications.empty.message': 'Nothing recorded here expires or falls due in the next 45 days. Add a policy, a document or a bill and its dates appear here.',
  'notifications.reach.title': 'How you find out',
  'notifications.reach.body': 'This list is here when you open it. The application does not send anything to your phone’s notification tray, so nothing here will interrupt you.',
  'notifications.reach.elsewhere': 'Dates also appear on the calendar and on the dashboard.',
  'notifications.dateFallback': 'Date',
  'notifications.search': 'Search what is due',
  'notifications.all': 'All {n}',
  'notifications.open': 'Open',
  'notifications.openNamed': 'Open {title}',
  'notifications.clearFilters': 'Clear filters',
  'notifications.noMatch.title': 'Nothing matches',
  'notifications.noMatch.message': 'No date due in the next 45 days matches that. Clear the filters to see everything.',
  'notifications.noRead.title': 'Why nothing is marked read',
  'notifications.noRead.body': 'This application does not record what you have looked at, so nothing here can be marked as read and no count claims to be unread. What is counted is what is actually late or falls due soon, and it goes down when the thing is dealt with rather than when it is seen.',

  /* ------------------------------------------------------------- profile */
  'profile.title': 'Profile',
  'profile.subtitle': 'You, your household, and the controls',
  'profile.signedInAs': 'Signed in as {role}',
  'profile.signedIn': 'Signed in',
  'profile.recorded': 'Recorded',
  'profile.openRecord': 'Open your record',
  'profile.noPerson': 'No person record is linked to this sign-in yet, so there is nothing to measure. Add yourself under Identity and it appears here.',
  'profile.household': 'Household',
  'profile.people': '{n} people',
  'profile.person': '1 person',
  'profile.recordedAcross': 'Recorded across everyone',
  'profile.notEnough': 'Not enough recorded yet to measure.',
  'profile.averagedAll': 'Averaged across all {n} people',
  'profile.averagedSome': 'Averaged across {scored} of {n} people — the rest have nothing recorded yet',
  'profile.openFamily': 'Open the family',
  'profile.empty.title': 'No people recorded yet',
  'profile.empty.message': 'Add the people in your household and their records gather here.',
  'profile.group.you': 'You and the household',
  'profile.group.owned': 'What you own and owe',
  'profile.group.life': 'Life',
  'profile.group.records': 'Safety and records',
  'profile.group.rest': 'Everything else',
  'wallet.title': 'Identity documents',
  'wallet.count': '{n} recorded',
  'wallet.pressing': '{n} need attention',
  'wallet.typed': 'Every number here was typed in from a document somebody was holding. Nothing in this application checks them against an issuing authority \u2014 there is no connection to CKYCRR, DigiLocker or any government registry \u2014 so nothing here is verified, only recorded.',
  'wallet.state.expired': 'expired',
  'wallet.state.soon': 'expiring',
  'wallet.state.valid': 'in date',
  'wallet.state.unknown': 'no expiry recorded',
  'wallet.expires': 'Expires {day}',
  'wallet.noExpiry': 'No expiry recorded',
  'wallet.noNumber': 'No number recorded',
  'wallet.nobody': 'Not linked to a person',
  'wallet.updated': 'Record last changed {day}',
  'wallet.neverUpdated': 'Never changed since it was added',
  'profile.device.title': 'This device',
  'profile.wellbeing': 'Screen time',
  'profile.wellbeingHint': 'How long applications were open on this phone, when the person it belongs to has agreed to it being read.',
  'profile.settings': 'Settings',
  'profile.settingsHint': 'Security, privacy, connections, display, data',
  'amounts.unreadable.one': 'One record has an amount this device cannot read, so it is not in these totals. Check it in your spreadsheet.',
  'amounts.unreadable.many': '{n} records have an amount this device cannot read, so they are not in these totals. Check them in your spreadsheet.',
  'assistant.unreadable': 'I could not read your {names} records, so I cannot answer that. This is not the same as having none — something went wrong reading them.',
  'search.keepTyping': 'Keep typing — {n} letters or more to search',
  'profile.lockNow': 'Lock now',
  'profile.lockNowHint': 'Drop the key from this device. Your PIN opens it again',

  /* ------------------------------------------------------- chat settings */
  'chatSettings.title': 'Chat settings',
  'chatSettings.subtitle': 'How messages look, and who can read them',
  'chatSettings.theme.title': 'Chat theme',
  'chatSettings.theme.body': 'The tint on the messages you send.',
  'chatSettings.theme.note': 'Each tint is a colour already in the design system, so the text on it stays readable in both light and dark. This is kept on this device only.',
  'chatSettings.bubble.accent': 'Blue',
  'chatSettings.bubble.secondary': 'Teal',
  'chatSettings.bubble.positive': 'Green',
  'chatSettings.bubble.info': 'Slate',
  'chatSettings.devices.title': 'Linked devices',
  'chatSettings.devices.count': '{n} active',
  'chatSettings.devices.body': 'A message is sealed to each of these, one by one. A device that is not on this list cannot open anything sent while it was missing.',
  'chatSettings.devices.none': 'No device has been enrolled yet',
  'chatSettings.devices.thisOne': 'this device',
  'chatSettings.devices.added': 'added {day}',
  'chatSettings.devices.verifiedBadge': 'verified',
  'chatSettings.devices.unverifiedBadge': 'unverified',
  'chatSettings.devices.compare': 'Show safety number',
  'chatSettings.devices.matched': 'It matched',
  'chatSettings.devices.markedDone': 'Recorded as compared and matched',
  'chatSettings.devices.revoke': 'Revoke',
  'chatSettings.devices.revokeConfirm': 'Stop sealing new messages to this device?\n\nThis cannot be undone, and it does not reach backwards: everything already sent to this device stays readable by it.',
  'chatSettings.devices.revokedDone': 'No new message will be sealed to that device',
  'chatSettings.devices.revokedCount': '{n} revoked',
  'chatSettings.devices.revokedOn': 'Revoked {day}',
  'chatSettings.devices.revokedBadge': 'revoked',
  'chatSettings.devices.alreadyHere': 'This device is enrolled, so messages sent to it can be read here.',
  'chatSettings.devices.enrolHere': 'Enrol this device',
  'chatSettings.privacy.title': 'Privacy',
  'chatSettings.privacy.sealed': 'Each message is sealed to each device',
  'chatSettings.privacy.sealedWhy': 'Not to a person and not to a server. Google holds the sealed bytes and cannot open them, and neither can anyone in this household who is not in the conversation.',
  'chatSettings.privacy.escrow': 'The recovery phrase opens everything',
  'chatSettings.privacy.escrowWhy': 'Every message is also sealed to a key that phrase opens, so a restored backup can still read old conversations. Whoever holds the phrase can read every conversation, including ones they were never part of.',
  'chatSettings.privacy.withdraw': 'Withdrawing a message removes it here and everywhere it syncs',
  'chatSettings.privacy.withdrawWhy': 'The sealed body and any attached file are deleted and the row is marked withdrawn. A device that had already opened and copied it is beyond this application\u2019s reach.',
  'chatSettings.privacy.revoke': 'Revoking a device only stops new messages',
  'chatSettings.privacy.revokeWhy': 'A key that has been used cannot be un-used. Everything already sealed to that device stays readable by it, and pretending otherwise would be the most dangerous sentence on this screen.',
  'chatSettings.privacy.plaintext': 'An opened file is never written to disk',
  'chatSettings.privacy.plaintextWhy': 'It is decrypted in memory, handed to you, and released immediately \u2014 which is the point of having sealed it.',
  'chatSettings.privacy.more': 'Household privacy settings',
  'chatSettings.notify.title': 'Notifications',
  'chatSettings.notify.badge': 'none, on any platform',
  'chatSettings.notify.none': 'Nothing about a message reaches your notification tray. A new message is seen when you open the chat screen \u2014 there is no background delivery, no sound, and no badge on the app icon.',
  'chatSettings.notify.receipts': 'No read receipts, and no unread counts',
  'chatSettings.notify.receiptsWhy': 'Nothing records whether a message has been read, so neither can be shown without inventing it.',
  'chatSettings.notify.presence': 'No typing indicator, and no online status',
  'chatSettings.notify.presenceWhy': 'Nothing observes either, and a dot claiming somebody is online would be guessing.',
  'chatSettings.notify.instead': 'The Notifications tab is about what is due \u2014 renewals, payments, expiring documents. It has never carried messages.',
  'chatSettings.notify.open': 'Open notifications',
  'transport.notPublic': '{action} needs a signed-in caller \u2014 only a one-time code can be asked for without one.',
  'scope.sendMail.title': 'Send mail as the account that deployed it',
  'scope.sendMail.why': 'Only if you kept Otp.gs. It sends one-time codes, and only to addresses already recorded against a person in your household. Delete that file and this scope to opt out.',
  'scope.sendMail.without': 'Household members choose who they are without confirming an address first.',
  'chatSettings.composer.title': 'The composer',
  'chatSettings.composer.body': 'What the Enter key does while you are writing a message.',
  'chatSettings.composer.sends': 'Enter sends the message',
  'chatSettings.composer.newline': 'Enter starts a new line',
  'chatSettings.composer.note': 'Shift and Enter always start a new line, whichever is chosen. Kept on this device.',
  'chatSettings.storage.title': 'Storage and data',
  'chatSettings.storage.conversations': 'Conversations',
  'chatSettings.storage.messages': 'Messages held on this device',
  'chatSettings.storage.withdrawn': 'Withdrawn messages',
  'chatSettings.storage.withdrawnWhy': 'The row stays after the body is deleted \u2014 it is how every other device learns the message was withdrawn \u2014 so the space does not come back.',
  'chatSettings.storage.attachments': 'Attached files',
  'chatSettings.storage.attachmentsWhere': 'Sealed, and kept on this device rather than uploaded.',
  'chatSettings.storage.mb': '{n} MB in {files}',
  'chatSettings.storage.files': '{files} files',
  'chatSettings.storage.backup': 'A backup carries the sealed bytes, not the readable text. Restoring it on a new device gives that device nothing until it is enrolled, and only the recovery phrase reaches conversations from before then.',
  'chatSettings.storage.manage': 'Export or erase data',
  'chatSettings.access.title': 'Accessibility',
  'chatSettings.access.body': 'How large the text in a conversation is. Kept on this device.',
  'chatSettings.size.normal': 'Normal',
  'chatSettings.size.large': 'Large',
  'chatSettings.size.largest': 'Largest',
  'chatSettings.access.checked': 'Every control in a conversation is at least 44 by 44 pixels, nothing is distinguished by colour alone, and the layout is measured for overflow at 320 pixels wide in both themes \u2014 automatically, on every change.',
  'chatSettings.access.untested': 'No screen reader has ever been run against this application. The roles and labels are written for one and checked by machine, but checked markup and a tested experience are different claims and only the first is true here.',
  'chatSettings.invite.title': 'Adding somebody',
  'chatSettings.invite.badge': 'No invitation links',
  'chatSettings.invite.body': 'There is no link to send. A link would carry a key over a channel this application does not control, so joining is two deliberate steps instead.',
  'chatSettings.invite.one': 'Add them as a person in this household',
  'chatSettings.invite.oneWhy': 'A record, here, on this device. Nothing is emailed and nothing is sent anywhere.',
  'chatSettings.invite.two': 'They open FamilyOS on their own phone and enrol it',
  'chatSettings.invite.twoWhy': 'The private half of the key is made on their phone and never leaves it. Until this happens, a message cannot be sealed to them and sending will say so rather than fail quietly.',
  'chatSettings.invite.three': 'Compare safety numbers once, in person',
  'chatSettings.invite.threeWhy': 'Both phones show the same number for each other. Reading it aloud is the only check that the device claiming to be theirs is theirs.',
  'chatSettings.invite.addPerson': 'Add a person',
  'chatSettings.invite.startOne': 'Start a conversation',
  'chatSettings.theme.system': 'Light and dark, for the whole app',

  'chat.manage': 'Manage conversations',
  'chat.untitled': 'Untitled conversation',
  'chat.nothingSaid': 'Nothing said yet',
  'chat.lastSealed': 'Sealed to a device this one cannot read',
  'chat.none.title': 'No conversations yet',
  'chat.none.message': 'Start one between people in this household.',
  'chat.none.action': 'Start a conversation',
  'chat.settings.open': 'Chat settings',
  'chat.title': 'Chat',
  'chat.subtitle': 'Messages between people in this household',
  'chat.honesty.title': 'What this encryption covers',
  'chat.honesty.badge': 'end-to-end, with one exception',
  'chat.honesty.covered': 'A message is sealed to each participant\u2019s devices. Google cannot read it, and neither can anyone in this household who is not in the conversation.',
  'chat.honesty.escrow': 'Except the recovery phrase. Every message is also sealed to a key that phrase opens, so a restored backup can still read old conversations \u2014 which means whoever holds the phrase can read every conversation, including ones they were never part of.',
  'chat.honesty.unaudited': 'This uses standard Web Crypto and has been tested, but it has not been reviewed by a cryptographer. There is no forward secrecy: somebody who takes a device\u2019s key can read everything ever sent to it.',
  'chat.devices.title': 'Devices that can read messages',
  'chat.devices.count': '{n} enrolled',
  'chat.devices.none': 'No device has been enrolled yet',
  'chat.devices.notEnrolled': 'This device has no chat key yet, so it cannot read or send messages. Enrolling makes one and keeps the private half on this device only.',
  'chat.devices.enrol': 'Enrol this device',
  'chat.devices.enrolled': 'This device is enrolled',
  'chat.say': 'Say something',
  'chat.send': 'Send',
  'chat.withdraw': 'Withdraw',
  'chat.search': 'Search conversations',
  'chat.filters': 'Filter conversations',
  'chat.filter.all': 'All ({n})',
  'chat.filter.pinned': 'Pinned ({n})',
  'chat.filter.groups': 'Groups ({n})',
  'chat.filter.archived': 'Archived ({n})',
  'chat.noMatch.title': 'Nothing matches',
  'chat.noMatch.message': 'No conversation here has that in its name or its last message. Clearing the box brings them all back \u2014 nothing has been deleted.',
  'chat.pinned': 'pinned',
  'chat.pinned.on': 'Pin',
  'chat.pinned.off': 'Unpin',
  'chat.archived.on': 'Archive',
  'chat.archived.off': 'Unarchive',
  'chat.star': 'Star',
  'chat.unstar': 'Unstar',
  'chat.starred.title': 'Starred messages',
  'chat.starred.none': 'Nothing starred yet',
  'chat.starred.hint': 'Star a message in a conversation and it appears here. Stars are kept on this device only \u2014 they do not follow you to another phone and nobody else in the household sees them.',
  'chat.starred.open': 'Open the conversation',
  'chat.deviceOnly': 'Pinning, archiving and starring are kept on this device only. They are not sent anywhere and will not appear on another phone.',
  'chat.withdrawConfirm': 'Withdraw this message?\n\nThe sealed text and any attached file are deleted here and on every device that syncs. A device that had already opened it may still have a copy, and that is beyond this application\u2019s reach.',
  'chat.withdrawn': 'Withdrawn \u2014 the text and any file are gone',
  'chat.someone': 'Someone',
  'chat.empty': 'Nothing has been said yet',
  'chat.file.choose': 'Choose a file',
  'chat.file.send': 'Send the file',
  'chat.file.open': 'Open',
  'chat.file.chosen': 'Ready to send: {name}',
  'chat.file.gone': 'That file is no longer on this device.',
  'auth.google.locked': 'This device is locked, so the saved Google sign-in cannot be read. Unlock FamilyOS and try again.',
  'auth.google.unreadable': 'The saved Google sign-in cannot be read on this device. Sign in with Google again.',
  'chat.attribution.disputed': 'This says it is from somebody else. The key that sealed it belongs to {name}.',
  'chat.why.withdrawn': 'This message was withdrawn.',
  'chat.why.sentBefore': 'Sent before this device joined, so it was never sealed to it.',
  'chat.why.keyChanged': 'Sealed to a key this device no longer has.',
  'chat.why.notEnrolled': 'This device has no chat identity yet.',
  'chat.why.unreadable': 'This message could not be opened.',
  'chat.devices.thisDevice': 'This device',
  'chat.devices.done': 'This device can now read messages sent to it',
  'chat.devices.noPerson': 'This sign-in is not linked to a person, so there is nobody to enrol a device for.',
  'chat.devices.verified': 'The safety number was compared and matched',
  'chat.devices.unverified': 'Nobody has compared this device\u2019s safety number yet',
  'chat.devices.verifiedBadge': 'verified',
  'chat.devices.unverifiedBadge': 'unverified',

  // Every place the household's own records disagree about money. A whole
  // sentence per key, because each of these ends with what the application
  // deliberately did *not* do, and a translator handed the halves separately
  // would have no way to keep the refusal attached to the finding.
  'conflict.title': 'Disagreements',
  'conflict.none.title': 'Nothing disagrees',
  'conflict.none.body': 'Every payment with more than one source states the same figure on every one of them, and the wages recorded match the wages agreed. That is the records agreeing with each other \u2014 not a person having checked that any of them is true.',
  'conflict.heading.amount': 'Sources that name different amounts',
  'conflict.heading.date': 'Sources that name different days',
  'conflict.heading.missing-row': 'Paid, and not in the ledger',
  'conflict.heading.wages': 'Wages that are not the wages agreed',
  'conflict.why.amount': 'Two things that describe the same payment do not state the same figure. Every figure is kept exactly as it was recorded \u2014 correcting one means opening that record and changing it.',
  'conflict.why.date': 'These were matched on a reference both sources copied from the same rail, so they are one payment described twice. A gap of a day is a posting delay and is not listed; a wider one is worth a look.',
  'conflict.why.missing-row': 'An email receipt and a bank alert agree about a payment, and no imported statement row matches it. Nothing has been added \u2014 import the statement it belongs to, or record the payment yourself.',
  'conflict.why.wages': 'A whole month where what is recorded as paid is not what was agreed. Months that cannot honestly be judged \u2014 a part month, or one touched by unpaid leave \u2014 are left out rather than guessed at.',
  'conflict.said.amount': 'the sources for this payment do not state the same amount. Every figure is kept as it was recorded; nothing here decides which is right.',
  'conflict.said.date': 'the sources for this payment name days {n} apart. They were matched on a shared reference rather than a date, so this is one payment described twice \u2014 a delay between the alert and the posting is the usual reason. Neither date is changed.',
  'conflict.said.missing-row': '{finding}. Nothing has been added to the ledger.',
  'conflict.said.wages': 'wages recorded for {month} are not the wages agreed. Both figures are kept; nothing here decides which is right.',
  'conflict.said.wagesNone': 'nothing is recorded as paid for {month}, and this month was not one of the ones left unjudged.',
  'conflict.figure.noAmount': 'no figure',
  'conflict.figure.date': '{source} {date}',
  'conflict.figure.amount': '{source} {amount}',
  'conflict.sentence': '{figures} \u2014 {why}',
  'conflict.banner.title': 'Records that disagree',
  'conflict.banner.body': '{n} things the household\u2019s own records do not agree about, including payments the ledger has never seen. They are all on one screen, with every figure named beside whatever stated it.',
  'conflict.banner.go': 'Open Disagreements',
  'evidence.corroborated': '{n} of {total} payments have more than one thing saying they happened. That is corroboration, not verification \u2014 none of these sources is a person having checked it.',
  'conflict.row.payment': 'A payment',
  'conflict.row.staff': 'A staff member',
  'conflict.more': '{n} more, not listed here.',
  'conflict.nothingDecided': 'Nothing on this screen has been decided. Every figure is still recorded as whatever stated it, and this list disappears when the record that is wrong is corrected \u2014 there is nothing here to tick off.',

  // A tab that does not exist. Reachable by editing the address bar, so it
  // is a sentence a person can actually see.
  'finance.unknownSection': 'Unknown section',

  // The language picker itself.
  'locale.title': 'Language',
  'locale.english': 'English',
  'locale.partial': '{name} — {percent}% translated, the rest appears in English',
  'locale.complete': '{name} — complete',
  'locale.refused': '{n} lines in {name} were left in English because a number or name was missing from the translation',
  'locale.only': 'FamilyOS is available in English only. docs/LOCALISATION.md says what a second language needs.',
};
