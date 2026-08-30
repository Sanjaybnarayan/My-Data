/**
 * English, for the example household.
 *
 * The example household is a **fictional** family used to show what the
 * application looks like with records in it. Its text lives here rather than
 * in `js/domain/example.js` for two reasons, and only one of them is the
 * strings ratchet.
 *
 * The real reason is that this text is exactly what a translator would need to
 * change. A demonstration shown in a Hindi interface wants names and
 * institutions a Hindi reader recognises, not transliterated English ones —
 * so a person's name in a *demonstration* is user-facing English in a way a
 * real household's typed-in name never is.
 *
 * Nothing here describes a real person, a real account or a real policy. The
 * identifiers that go with these names are built in `js/domain/example.js` to
 * be structurally invalid as the real thing, and the reasoning is written
 * there beside them.
 *
 * ## Why this one is not spread into `en.js`
 *
 * `en-signin.js` and `en-tradebook.js` are, and this file deliberately is not.
 *
 * `coverage()` measures a language as the share of *all* keys translated, and
 * `tests/locale.test.mjs` holds the fact that follows from it: schema labels
 * outnumber UI strings, so a translator who finishes the catalogue is not
 * close to done. Spreading these thirty-five keys in was enough to make that
 * false — the UI catalogue went past the whole schema label set, and a
 * measurement of *how translated the interface is* moved because a
 * demonstration family got names.
 *
 * The keys are read directly by `domain/example.js` instead. Everything else
 * holds: the English is in `js/locale/`, so it is a catalogue and not a string
 * escaping into the source, and a second language adds `hi-example.js` beside
 * this. What it does not get is automatic switching with the active locale,
 * which is an honest limit to state rather than a cost worth corrupting a
 * measurement for — there is no second language yet.
 */

export const exampleStrings = {
  // Six people: two grandparents, two parents, a son and a daughter.
  'example.person.ramesh': 'Ramesh Iyer',
  'example.person.lakshmi': 'Lakshmi Iyer',
  'example.person.anand': 'Anand Iyer',
  'example.person.priya': 'Priya Iyer',
  'example.person.vikram': 'Vikram Iyer',
  'example.person.ananya': 'Ananya Iyer',

  'example.occupation.retired': 'Retired, State Transport',
  'example.occupation.homemaker': 'Homemaker',
  'example.occupation.engineer': 'Software engineer',
  'example.occupation.teacher': 'Schoolteacher',
  'example.occupation.student': 'Student',

  'example.employer.tech': 'Meridian Systems',
  'example.employer.school': 'Nandini Vidyalaya',

  // Institutions. Invented, so that no real bank is named as holding an
  // account that does not exist.
  'example.bank.sapphire': 'Sapphire Bank',
  'example.bank.deccan': 'Deccan Cooperative Bank',
  'example.bank.harbour': 'Harbour National Bank',
  'example.bank.kaveri': 'Kaveri Grameen Bank',

  'example.insurer.health': 'Ashwin General Insurance',
  'example.insurer.motor': 'Palladium Motor Insurance',

  'example.policy.floater': 'Family health cover',
  'example.policy.senior': 'Senior citizen top-up',
  'example.policy.motorErtiga': 'Comprehensive motor cover, the estate',
  'example.policy.motorHatch': 'Comprehensive motor cover, the hatchback',

  // The cars. Real makes, because a make is a product and naming one is not
  // a claim about anybody; routed here with the rest of the display text.
  'example.make.estate': 'Maruti Suzuki',
  'example.make.hatchback': 'Hyundai',

  'example.address': '14, Second Cross, Malleswaram, Bengaluru 560003',

  // Said on the records themselves, so a person reading one in isolation —
  // in a list, in an export, on a shared screen — can see what it is.
  'example.note': 'Part of the example household. Not a real record.',

  // The control, and what it says before and after.
  'example.load.title': 'Example household',
  'example.load.body': 'Six people, twelve savings accounts, two cars, four '
    + 'insurance policies and their identity documents — all invented, so you '
    + 'can see how the screens behave with records in them.',
  'example.load.action': 'Load the example household',
  'example.remove.action': 'Remove the example household',
  'example.loaded': 'Loaded: {count} records. Every one is marked as an '
    + 'example and can be removed together.',
  'example.removed': 'Removed {count} example records.',
  'example.refused': 'This household already has {count} people in it, so the '
    + 'example was not loaded. It is only offered on an empty household, '
    + 'because mixing invented records into real ones is not something that '
    + 'can be undone by hand.',
  'example.present': 'The example household is loaded. {count} records.',
};
