import { test, describe, assert, setSuite, fakeClock } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import {
  buildTree, normaliseEdges, describeRelation, generationLabel,
  impliedEdges, relationshipConflicts,
} from '../js/domain/tree.js';
import {
  nextOccurrence, recurringToAdvance, tasksToRepeat,
  notifiableReminders, notificationFor, runAutomations,
} from '../js/domain/automation.js';
import {
  guessCategory, formatSize, iconForMime, matches, categoryForEntity,
  personFolderName, documentPath, categoryFolderName, HOUSEHOLD_FOLDER,
} from '../js/domain/filing.js';
import { subjectOf } from '../js/modules/documents.js';
import { canReadText, indexableText } from '../js/domain/filing.js';
import { toMinor } from '../js/core/money.js';

setSuite('tree & automation');

/* ------------------------------------------------------------------- tree */

const person = (id, over = {}) => ({ id, name: id, deletedAt: null, ...over });
const rel = (from, type, to) => ({
  id: `r-${from}-${to}`, fromPerson: from, type, toPerson: to, deletedAt: null,
});

describe('relationship edges', () => {
  test('the same link entered from both ends is one edge', () => {
    const edges = normaliseEdges([
      rel('a', 'parent of', 'b'),
      rel('b', 'child of', 'a'),
    ]);
    assert.length(edges, 1);
    assert.equal(edges[0].from, 'a');
    assert.equal(edges[0].to, 'b');
  });

  test('a spouse link is undirected and stored once', () => {
    const edges = normaliseEdges([
      rel('b', 'spouse of', 'a'),
      rel('a', 'spouse of', 'b'),
    ]);
    assert.length(edges, 1);
  });

  test('a deleted relationship is not an edge', () => {
    assert.length(normaliseEdges([{ ...rel('a', 'parent of', 'b'), deletedAt: 'x' }]), 0);
  });

  test('an unknown relationship type is ignored rather than guessed at', () => {
    assert.length(normaliseEdges([rel('a', 'friend of', 'b')]), 0);
  });
});

describe('generations', () => {
  const family = () => ({
    people: [
      person('grandpa'), person('dad'), person('mum'),
      person('me', { relationship: 'self' }), person('sister'), person('kid'),
    ],
    links: [
      rel('grandpa', 'parent of', 'dad'),
      rel('dad', 'parent of', 'me'),
      rel('mum', 'parent of', 'me'),
      rel('dad', 'spouse of', 'mum'),
      rel('me', 'parent of', 'kid'),
      rel('me', 'sibling of', 'sister'),
    ],
  });

  test('everyone lands in the right generation', () => {
    const { people, links } = family();
    const tree = buildTree(people, links, { rootId: 'me' });

    assert.equal(tree.levelOf.get('me'), 0);
    assert.equal(tree.levelOf.get('sister'), 0, 'a sibling shares a generation');
    assert.equal(tree.levelOf.get('dad'), -1);
    assert.equal(tree.levelOf.get('mum'), -1, 'a spouse shares a generation');
    assert.equal(tree.levelOf.get('grandpa'), -2);
    assert.equal(tree.levelOf.get('kid'), 1);
  });

  test('generations come back oldest first', () => {
    const { people, links } = family();
    const levels = buildTree(people, links, { rootId: 'me' }).generations.map((g) => g.level);
    assert.deep(levels, [-2, -1, 0, 1]);
  });

  test('a cycle through both parents terminates', () => {
    // Two parents of one child means the undirected graph has a cycle. A
    // recursive descent would not come back.
    const { people, links } = family();
    const tree = buildTree(people, links, { rootId: 'me' });
    assert.equal(tree.levelOf.size, people.length);
  });

  test('a grandparent edge moves two generations, not one', () => {
    const tree = buildTree(
      [person('gran'), person('me', { relationship: 'self' })],
      [rel('gran', 'grandparent of', 'me')],
      { rootId: 'me' },
    );
    assert.equal(tree.levelOf.get('gran'), -2);
  });

  test('somebody with no relationships is still placed, and reported', () => {
    const { people, links } = family();
    people.push(person('cousin'));
    const tree = buildTree(people, links, { rootId: 'me' });

    assert.ok(tree.levelOf.has('cousin'), 'losing someone from their own tree is unacceptable');
    assert.ok(tree.unplaced.some((p) => p.id === 'cousin'));
    assert.equal(tree.generations.reduce((n, g) => n + g.people.length, 0), people.length);
  });

  test('an edge pointing at a deleted person is dropped', () => {
    const tree = buildTree(
      [person('me', { relationship: 'self' })],
      [rel('me', 'parent of', 'ghost')],
      { rootId: 'me' },
    );
    assert.length(tree.edges, 0);
  });

  test('a generation lists its oldest member first', () => {
    const tree = buildTree(
      [
        person('younger', { birthday: '2015-01-01' }),
        person('older', { birthday: '2010-01-01' }),
      ],
      [rel('older', 'sibling of', 'younger')],
      { rootId: 'older' },
    );
    assert.deep(tree.generations[0].people.map((p) => p.id), ['older', 'younger']);
  });

  test('an empty family does not throw', () => {
    const tree = buildTree([], [], {});
    assert.length(tree.generations, 0);
  });

  test('generations are labelled in words a person would use', () => {
    assert.equal(generationLabel(0), 'This generation');
    assert.equal(generationLabel(-1), 'Parents');
    assert.equal(generationLabel(2), 'Grandchildren');
    assert.includes(generationLabel(-4), 'generations back');
  });
});

describe('describing a relation', () => {
  test('reads the direction off the edge', () => {
    const links = [rel('dad', 'parent of', 'me')];
    assert.equal(describeRelation('dad', 'me', links), 'parent');
    assert.equal(describeRelation('me', 'dad', links), 'child');
  });

  test('two people sharing a parent are siblings whether or not anyone said so', () => {
    const links = [rel('dad', 'parent of', 'me'), rel('dad', 'parent of', 'sister')];
    assert.equal(describeRelation('me', 'sister', links), 'sibling');
  });

  test('a person is not their own sibling', () => {
    const links = [rel('dad', 'parent of', 'me')];
    assert.equal(describeRelation('me', 'me', links), null);
  });

  test('strangers have no relation', () => {
    assert.equal(describeRelation('a', 'b', []), null);
  });
});

/* ------------------------ the relationships the person form already collects */

/**
 * A household filling in the obvious field: every person record carries a
 * `relationship` picked from the dropdown beside their name. Nobody opens the
 * separate Relationships screen, because nothing suggests one exists.
 */
const HOUSEHOLD = [
  person('p1', { name: 'Sanjay', relationship: 'self' }),
  person('p2', { name: 'Asha', relationship: 'spouse' }),
  person('p3', { name: 'Ravi', relationship: 'son' }),
  person('p4', { name: 'Meera', relationship: 'daughter' }),
  person('p5', { name: 'Krishnan', relationship: 'father' }),
  person('p6', { name: 'Lakshmi', relationship: 'mother' }),
];

const levels = (tree) => tree.generations.map((g) => [g.level, g.people.map((p) => p.name)]);

describe('a family entered on the person form', () => {
  test('appears as a family rather than a flat list of strangers', () => {
    // Measured before this existed: six people, every one tagged, and the tree
    // showed one generation, zero edges and all six unplaced.
    const tree = buildTree(HOUSEHOLD, []);

    assert.deep(levels(tree), [
      [-1, ['Krishnan', 'Lakshmi']],
      [0, ['Asha', 'Sanjay']],
      [1, ['Meera', 'Ravi']],
    ]);
    assert.length(tree.unplaced, 0);
  });

  test('and matches what the Relationships entity would have produced', () => {
    // The two routes must agree, or a household gets a different family
    // depending on which screen they happened to use.
    const explicit = [
      rel('p1', 'spouse of', 'p2'), rel('p1', 'parent of', 'p3'),
      rel('p1', 'parent of', 'p4'), rel('p5', 'parent of', 'p1'),
      rel('p6', 'parent of', 'p1'),
    ];
    const bare = HOUSEHOLD.map((p) => ({ ...p, relationship: p.id === 'p1' ? 'self' : '' }));

    assert.deep(levels(buildTree(HOUSEHOLD, [])), levels(buildTree(bare, explicit)));
  });

  test('an implied edge and a recorded one are the same edge, not two', () => {
    const tree = buildTree(HOUSEHOLD, [rel('p1', 'parent of', 'p3')]);
    const between = tree.edges.filter((e) => (e.from === 'p1' && e.to === 'p3')
      || (e.from === 'p3' && e.to === 'p1'));

    assert.length(between, 1);
    // The recorded one keeps its own id: somebody entered it deliberately.
    assert.not(String(between[0].id).startsWith('implied:'), String(between[0].id));
  });

  test('siblings, grandparents and grandchildren land in the right generation', () => {
    const wider = [
      person('s', { name: 'Self', relationship: 'self' }),
      person('b', { name: 'Brother', relationship: 'brother' }),
      person('g', { name: 'Grandmother', relationship: 'grandmother' }),
      person('k', { name: 'Grandson', relationship: 'grandson' }),
    ];
    const tree = buildTree(wider, []);

    assert.equal(tree.levelOf.get('b'), 0, 'a brother is the same generation');
    assert.equal(tree.levelOf.get('g'), -2, 'a grandmother is two back');
    assert.equal(tree.levelOf.get('k'), 2, 'a grandson is two on');
  });

  test('an in-law hangs off the spouse, not off self', () => {
    // A father-in-law is not your parent, and placing him as one would put
    // your spouse's family in the wrong branch.
    const tree = buildTree([
      person('s', { name: 'Self', relationship: 'self' }),
      person('w', { name: 'Asha', relationship: 'spouse' }),
      person('f', { name: 'Raghavan', relationship: 'father-in-law' }),
    ], []);

    const edge = tree.edges.find((e) => e.from === 'f' || e.to === 'f');
    assert.equal(edge.to, 'w', 'the in-law edge should point at the spouse');
    assert.equal(tree.levelOf.get('f'), -1);
  });

  test('the tree says how much of itself was inferred', () => {
    // A household seeing their family appear should be able to tell it came
    // from what they typed on the person form rather than from edges they
    // never entered.
    assert.equal(buildTree(HOUSEHOLD, []).impliedCount, 5);
    assert.equal(buildTree(HOUSEHOLD, [], { implied: false }).impliedCount, 0);
  });

  test('and turning it off gives back exactly the old behaviour', () => {
    const off = buildTree(HOUSEHOLD, [], { implied: false });
    assert.length(off.edges, 0);
    assert.length(off.unplaced, 6);
  });
});

describe('where the person form cannot be read', () => {
  test('nobody marked as self, because there is nothing to be relative to', () => {
    // "son" is a relationship *to somebody*. Guessing who would rearrange the
    // whole family around an assumption.
    // The same household with the one `self` marking removed. Written out
    // rather than derived, so what is missing is visible in the fixture.
    const { edges, why } = impliedEdges([
      person('p1', { name: 'Sanjay', relationship: '' }),
      person('p2', { name: 'Asha', relationship: 'spouse' }),
      person('p3', { name: 'Ravi', relationship: 'son' }),
      person('p5', { name: 'Krishnan', relationship: 'father' }),
    ]);

    assert.length(edges, 0);
    assert.includes(why, 'nobody is marked');
  });

  test('two people marked as self, because it is not one family then', () => {
    const two = [
      person('a', { name: 'A', relationship: 'self' }),
      person('b', { name: 'B', relationship: 'self' }),
      person('c', { name: 'C', relationship: 'son' }),
    ];
    const { edges, why } = impliedEdges(two);

    assert.length(edges, 0);
    assert.includes(why, 'both marked as');
    assert.includes(why, 'A and B');
  });

  test('an in-law with no spouse recorded is named rather than dropped', () => {
    const { edges, why } = impliedEdges([
      person('s', { name: 'Self', relationship: 'self' }),
      person('f', { name: 'Raghavan', relationship: 'father-in-law' }),
    ]);

    assert.length(edges, 0);
    assert.includes(why, 'no spouse is recorded');
  });

  test('a relationship nobody has a rule for implies nothing', () => {
    const { edges, why } = impliedEdges([
      person('s', { name: 'Self', relationship: 'self' }),
      person('x', { name: 'X', relationship: 'other' }),
    ]);

    assert.length(edges, 0);
    assert.equal(why, '', 'and it is not an error either');
  });

  test('nobody is made their own parent', () => {
    // `self` is absent from the mapping tables, so it falls through the way
    // `other` does. Locked as a property rather than as a guard: a self-loop
    // would put one person in two generations at once.
    const { edges } = impliedEdges(HOUSEHOLD);
    const loops = edges.filter((e) => e.fromPerson === e.toPerson);

    assert.length(loops, 0);
    assert.not(edges.some((e) => e.id === 'implied:p1'), 'self implies no edge of its own');
  });

  test('a deleted person implies nothing', () => {
    const { edges } = impliedEdges([
      person('s', { name: 'Self', relationship: 'self' }),
      person('d', { name: 'Gone', relationship: 'son', deletedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    assert.length(edges, 0);
  });
});

describe('when the two ways of recording disagree', () => {
  test('the contradiction is reported rather than silently resolved', () => {
    // Ravi's own record says he is a son; an edge says he is Sanjay's parent.
    // Neither side wins: an uncertain match is never forced, and a family tree
    // that quietly picked one would be wrong in a way nobody could see.
    const [conflict] = relationshipConflicts(HOUSEHOLD, [rel('p3', 'parent of', 'p1')]);

    assert.ok(conflict, 'a contradiction should be reported');
    assert.equal(conflict.person.name, 'Ravi');
    assert.equal(conflict.said, 'son');
    assert.includes(conflict.recorded, 'parent');
  });

  test('agreement is not a conflict', () => {
    assert.length(relationshipConflicts(HOUSEHOLD, [rel('p1', 'parent of', 'p3')]), 0);
  });

  test('nor is a relationship recorded only one way', () => {
    // The gap this whole thing fills. A person with a dropdown value and no
    // edge is not in conflict with anything.
    assert.length(relationshipConflicts(HOUSEHOLD, []), 0);
  });

  test('and with nobody marked as self there is nothing to compare', () => {
    const bare = HOUSEHOLD.map((p) => ({ ...p, relationship: '' }));
    assert.length(relationshipConflicts(bare, [rel('p3', 'parent of', 'p1')]), 0);
  });
});

/* ------------------------------------------------------------- automation */

describe('recurrence', () => {
  test('the usual intervals', () => {
    assert.equal(nextOccurrence('daily', '2025-06-15'), '2025-06-16');
    assert.equal(nextOccurrence('weekly', '2025-06-15'), '2025-06-22');
    assert.equal(nextOccurrence('monthly', '2025-01-31'), '2025-02-28', 'clamped, not overflowed');
    assert.equal(nextOccurrence('yearly', '2024-02-29'), '2025-02-28');
    assert.equal(nextOccurrence('none', '2025-06-15'), null);
  });

  test('a weekday task skips the weekend', () => {
    // 2025-06-13 is a Friday.
    assert.equal(nextOccurrence('weekdays', '2025-06-13'), '2025-06-16');
    assert.equal(nextOccurrence('weekdays', '2025-06-16'), '2025-06-17');
  });

  test('an overdue recurring payment catches up in one move', () => {
    const rows = recurringToAdvance([
      { id: 'r1', nextDueOn: '2025-01-15', frequency: 'monthly', active: true, deletedAt: null },
    ], '2025-06-10');
    assert.length(rows, 1);
    assert.equal(rows[0].nextDueOn, '2025-06-15');
  });

  test('a payment already in the future is left alone', () => {
    assert.length(recurringToAdvance([
      { id: 'r1', nextDueOn: '2025-07-15', frequency: 'monthly', active: true, deletedAt: null },
    ], '2025-06-10'), 0, 'a no-op run must write nothing');
  });

  test('an inactive payment does not advance', () => {
    assert.length(recurringToAdvance([
      { id: 'r1', nextDueOn: '2025-01-15', frequency: 'monthly', active: false, deletedAt: null },
    ], '2025-06-10'), 0);
  });

  test('a completed repeating task produces its successor', () => {
    const rows = tasksToRepeat([
      {
        id: 't1', title: 'Pay the maid', status: 'done', repeat: 'monthly',
        completedOn: '2025-06-01', priority: 'normal', deletedAt: null,
      },
    ], '2025-06-10');
    assert.length(rows, 1);
    assert.equal(rows[0].next.dueOn, '2025-07-01');
    assert.equal(rows[0].next.status, 'todo');
  });

  test('a task that already has an open twin is not duplicated', () => {
    const rows = tasksToRepeat([
      {
        id: 't1', title: 'Pay the maid', status: 'done', repeat: 'monthly',
        completedOn: '2025-06-01', deletedAt: null,
      },
      { id: 't2', title: 'Pay the maid', status: 'todo', repeat: 'monthly', deletedAt: null },
    ], '2025-06-10');
    assert.length(rows, 0, 'a launch loop must not breed tasks');
  });

  test('a one-off task is not repeated', () => {
    assert.length(tasksToRepeat([
      { id: 't1', title: 'x', status: 'done', repeat: 'none', deletedAt: null },
    ], '2025-06-10'), 0);
  });
});

describe('notifications', () => {
  test('only the urgent is worth interrupting somebody for', () => {
    const due = notifiableReminders([
      { group: 'expiry', days: -2, title: 'A', label: 'insurance' },
      { group: 'expiry', days: 5, title: 'B', label: 'PUC' },
      { group: 'expiry', days: 40, title: 'C', label: 'passport' },
      { group: 'date', days: 0, title: 'Birthday' },
      { group: 'date', days: 20, title: 'Anniversary' },
    ]);
    assert.length(due, 3);
    assert.not(due.some((r) => r.days === 40), 'six weeks out teaches people to dismiss');
  });

  test('one thing gets a sentence, several get a digest', () => {
    const single = notificationFor([
      { id: 'x', group: 'expiry', days: -3, title: 'KA01AB1234', label: 'PUC expiry' },
    ]);
    assert.includes(single.body, 'expired 3 days ago');

    const many = notificationFor([
      { id: 'a', group: 'expiry', days: -1, title: 'A', label: 'x' },
      { id: 'b', group: 'expiry', days: 2, title: 'B', label: 'y' },
    ]);
    assert.includes(many.title, '2 things');
    assert.includes(many.body, '1 already lapsed');
  });

  test('nothing due produces no notification at all', () => {
    assert.equal(notificationFor([]), null);
  });
});

describe('the automation run', () => {
  test('advances payments and repeats tasks, once', async () => {
    const clock = fakeClock(Date.parse('2025-06-15T10:00:00'));
    const db = await makeDb();

    const payment = await db.repo('recurringPayment').create({
      name: 'Broadband', kind: 'bill', amount: '1499',
      frequency: 'monthly', nextDueOn: '2025-01-20', active: true,
    });
    await db.repo('task').create({
      title: 'Pay the maid', status: 'done', repeat: 'monthly', completedOn: '2025-06-01',
    });

    const first = await runAutomations(db, { clock, notify: false });
    assert.equal(first.advanced, 1);
    assert.equal(first.repeated, 1);
    assert.equal((await db.repo('recurringPayment').get(payment.id)).nextDueOn, '2025-06-20');

    // Running again the same day must do nothing: this is called on every
    // launch, and a second pass would breed a second task.
    const second = await runAutomations(db, { clock, notify: false });
    assert.ok(second.skipped);
    assert.equal(second.repeated, 0);
    assert.equal((await db.repo('task').list()).length, 2);
  });

  test('a role that cannot write does not fail the run', async () => {
    const clock = fakeClock(Date.parse('2025-06-15T10:00:00'));
    const db = await makeDb();
    await db.repo('recurringPayment').create({
      name: 'Broadband', kind: 'bill', amount: '1499',
      frequency: 'monthly', nextDueOn: '2025-01-20', active: true,
    });

    db.setActor({ personId: 'p3', role: 'child' });
    const result = await runAutomations(db, { clock, notify: false });
    assert.equal(result.advanced, 0, 'a child may not rewrite the household bills');
    assert.not(result.skipped);
  });
});

/* -------------------------------------------------------------- documents */

describe('document filing', () => {
  test('a filename is filed where a person would file it', () => {
    assert.equal(guessCategory('Aadhaar-card-scan.pdf'), 'identity');
    assert.equal(guessCategory('HDFC bank statement Mar.pdf'), 'financial');
    assert.equal(guessCategory('KA01AB1234 PUC.jpg'), 'vehicle');
    assert.equal(guessCategory('blood report.pdf'), 'health');
    assert.equal(guessCategory('IMG_20250612.jpg'), 'other');
  });

  test('the guess is a real category, never an invented one', async () => {
    const { entity } = await import('../js/data/schema.js');
    const allowed = entity('document').fieldMap.category.options;
    for (const name of ['pan.pdf', 'policy.pdf', 'sale deed.pdf', 'itr.pdf', 'x.bin']) {
      assert.includes(allowed, guessCategory(name));
    }
  });

  test('sizes are shown in units a person reads', () => {
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(2048), '2 kB');
    assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
    assert.equal(formatSize(undefined), '0 B');
  });

  test('an attachment on another record lands in that record\'s folder', () => {
    assert.equal(categoryForEntity('vehicle'), 'vehicle');
    assert.equal(categoryForEntity('policy'), 'insurance');
    assert.equal(categoryForEntity('note'), 'other');
  });

  test('the icon follows the file type', () => {
    assert.equal(iconForMime('image/jpeg'), 'eye');
    assert.equal(iconForMime('application/pdf'), 'file');
    assert.equal(iconForMime(undefined), 'file');
  });

  test('search covers the fields a document is actually remembered by', () => {
    const document = {
      title: 'Passport', category: 'identity', fileName: 'scan.pdf',
      ocrText: 'Republic of India', tags: ['travel'], notes: 'in the safe',
    };
    assert.ok(matches(document, 'passport'));
    assert.ok(matches(document, 'republic'));
    assert.ok(matches(document, 'travel'));
    assert.ok(matches(document, 'safe'));
    assert.not(matches(document, 'aadhaar'));
  });
});

export { toMinor };

describe('a folder for each individual', () => {
  test('a person gets their own folder, named after them', () => {
    assert.equal(personFolderName({ id: 'p1', name: 'Asha Narayan' }), 'Asha Narayan');
  });

  test('anything not about one individual goes to the household', () => {
    assert.equal(personFolderName(null), HOUSEHOLD_FOLDER);
    assert.equal(personFolderName({ id: 'p1', name: '   ' }), HOUSEHOLD_FOLDER);
    assert.equal(personFolderName(undefined), HOUSEHOLD_FOLDER);
  });

  test('two people with the same name get two folders, not one', () => {
    const people = [{ id: 'p2', name: 'Ravi Kumar' }, { id: 'p1', name: 'Ravi Kumar' }];
    const names = people.map((person) => personFolderName(person, people));
    assert.equal(new Set(names).size, 2, 'merging two people’s papers is the worst outcome here');
  });

  test('the older record keeps the plain name when a namesake is added', () => {
    const people = [{ id: 'p1', name: 'Ravi Kumar' }, { id: 'p2', name: 'Ravi Kumar' }];
    // Ids sort by creation time, so p1 is the older record.
    assert.equal(personFolderName(people[0], people), 'Ravi Kumar');
    assert.equal(personFolderName(people[1], people), 'Ravi Kumar (2)');
  });

  test('a name that would break a path is cleaned, not passed through', () => {
    const name = personFolderName({ id: 'p1', name: 'A/B:C*?"<>|' });
    for (const character of '/\\:*?"<>|') {
      assert.not(name.includes(character), `a folder name cannot contain ${character}`);
    }
  });

  test('the path is person then category', () => {
    assert.deep(
      documentPath({ id: 'p1', name: 'Asha' }, 'identity'),
      ['Asha', 'Identity'],
    );
    assert.deep(documentPath(null, 'property'), [HOUSEHOLD_FOLDER, 'Property']);
  });

  test('an unknown category falls to Other rather than inventing a folder', () => {
    assert.equal(categoryFolderName('nonsense'), 'Other');
    assert.equal(categoryFolderName(undefined), 'Other');
    assert.equal(categoryFolderName('HEALTH'), 'Health');
  });

  test('an attachment inherits whose record it hangs off', () => {
    assert.equal(subjectOf('vaccination', { person: 'p1' }), 'p1');
    assert.equal(subjectOf('vehicle', { owner: 'p2' }), 'p2');
    assert.equal(subjectOf('policy', { holder: 'p3' }), 'p3');
    assert.equal(subjectOf('loan', { borrower: 'p4' }), 'p4');
    assert.equal(subjectOf('person', { id: 'p5' }), 'p5');
  });

  test('a household record has no subject, and is not given one', () => {
    assert.equal(subjectOf('property', { owner: 'p1' }), undefined,
      'a property deed belongs to the household even though the flat has an owner');
    assert.equal(subjectOf('note', { createdBy: 'p1' }), undefined);
    assert.equal(subjectOf('vehicle', {}), undefined);
  });
});

describe('uploading to the right folder', () => {
  test('the person travels with the file, by id and by name', async () => {
    const { DocumentStore } = await import('../js/sync/drive.js');
    const { FakeTransport } = await import('../js/sync/transport.js');
    const { makePerson } = await import('./fixture.mjs');

    const db = await makeDb();
    const person = await makePerson(db, { name: 'Asha Narayan' });

    const transport = new FakeTransport({
      upload: (payload) => ({ fileId: 'f1', folderId: 'fold1', versionCount: 1, payload }),
    });
    const store = new DocumentStore({ db, transport });

    await store.capture(fakeFile('passport.pdf'), { title: 'Passport', category: 'identity', person: person.id });
    await store.flush();

    const upload = transport.calls.find((c) => c.action === 'upload');
    assert.equal(upload.payload.person.id, person.id);
    assert.equal(upload.payload.person.name, 'Asha Narayan');
    assert.equal(upload.payload.category, 'identity');
  });

  test('a household document sends no person rather than a guess', async () => {
    const { DocumentStore } = await import('../js/sync/drive.js');
    const { FakeTransport } = await import('../js/sync/transport.js');

    const db = await makeDb();
    const transport = new FakeTransport({
      upload: () => ({ fileId: 'f1', folderId: 'fold1', versionCount: 1 }),
    });
    const store = new DocumentStore({ db, transport });

    await store.capture(fakeFile('deed.pdf'), { title: 'Sale deed', category: 'property' });
    await store.flush();

    const upload = transport.calls.find((c) => c.action === 'upload');
    assert.equal(upload.payload.person, null);
  });

  test('a file is encrypted on the device before any of this', async () => {
    const db = await makeDb();
    const store = new (await import('../js/sync/drive.js')).DocumentStore({ db, transport: null });
    const { document } = await store.capture(fakeFile('passport.pdf'), { title: 'Passport' });

    const [blob] = await db.adapter.query('blobs', {});
    assert.equal(blob.documentId, document.id);
    assert.ok(blob.iv, 'a blob with no nonce was never encrypted');
    assert.not(Buffer.from(blob.data).toString('latin1').includes('a small but real pdf'),
      'the plaintext must not be sitting in IndexedDB');
  });
});

/** A `File`-shaped object; Node has no `File` constructor worth relying on. */
function fakeFile(name, text = 'a small but real pdf') {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    size: bytes.length,
    type: 'application/pdf',
    arrayBuffer: async () => bytes.buffer,
  };
}

/* ------------------------------------------------------- reading documents */

setSuite('documents');

describe('reading what is inside a document', () => {
  test('only a PDF is worth trying to read', () => {
    // Both a scanned and a generated PDF arrive as application/pdf, so this
    // says what is worth attempting, not what will succeed.
    assert.ok(canReadText('application/pdf'));
    assert.not(canReadText('image/jpeg'));
    assert.not(canReadText('application/vnd.ms-excel'));
    assert.not(canReadText(''));
    assert.not(canReadText(undefined));
  });

  test('pages become one searchable string', () => {
    const text = indexableText([
      { lines: ['Policy   number', 'ABC 123'] },
      { lines: ['Sum assured', '5,00,000'] },
    ]);
    assert.equal(text, 'Policy number ABC 123 Sum assured 5,00,000');
  });

  test('nothing to read is an empty string, not a crash', () => {
    assert.equal(indexableText([]), '');
    assert.equal(indexableText(null), '');
    assert.equal(indexableText([{}, { lines: [] }]), '');
  });

  test('a long document is cut, because the field becomes a spreadsheet cell', () => {
    // A Sheets cell holds 50,000 characters. Exceeding it would not truncate
    // the text — it would reject the write for the whole row.
    const pages = [{ lines: Array.from({ length: 5000 }, () => 'lorem ipsum dolor') }];
    const text = indexableText(pages);
    assert.ok(text.length <= 20_000, `${text.length} characters is over the cap`);
    assert.ok(text.length > 19_000, 'the cut should take the cap, not far less');
  });

  test('the cut lands on a word boundary', () => {
    // Half an account number matches nothing and reads like corruption.
    const pages = [{ lines: [`${'x'.repeat(40)} `.repeat(20)] }];
    const text = indexableText(pages, { limit: 100 });
    assert.ok(text.length <= 100);
    assert.not(text.endsWith(' '), 'trailing space should be trimmed');
    assert.ok(/x$/.test(text), 'the cut should leave a whole word');
  });

  test('a single word longer than the cap is still cut', () => {
    const text = indexableText([{ lines: ['y'.repeat(500)] }], { limit: 50 });
    assert.equal(text.length, 50, 'no word boundary exists, so the cap still applies');
  });
});
