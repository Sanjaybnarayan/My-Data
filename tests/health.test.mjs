import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import {
  medicationState, appointmentState, doseOutstanding, followUpState,
  openQuestions, QUESTION, CANNOT_SHOW,
} from '../js/domain/health.js';
import { entities } from '../js/data/schema.js';
import { datedEntities } from '../js/services/attention.js';
import { strings } from '../js/locale/en.js';

setSuite('health');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A fixed today, so "ran out last month" means the same thing every day.
const TODAY = '2026-06-15';
const clock = () => Date.parse(`${TODAY}T12:00:00Z`);
const at = (day) => ({ clock: () => Date.parse(`${day}T12:00:00Z`) });

describe('a medication record, read back', () => {
  test('ongoing with an end date that has passed says two things', () => {
    const said = medicationState({ ongoing: true, endsOn: '2026-03-01' }, { clock });
    assert.equal(said.state, 'contradiction');
    assert.equal(said.question, QUESTION.STILL_TAKING);
    assert.ok(said.days < 0);
  });

  test('ongoing with no end date is an ordinary repeat prescription', () => {
    // The common, correct shape. Listing it as a contradiction would bury the
    // real ones under every medicine the household takes.
    const said = medicationState({ ongoing: true }, { clock });
    assert.equal(said.state, 'open');
    assert.equal(said.question, null);
  });

  test('ongoing with an end date still ahead is running, not a question', () => {
    const said = medicationState({ ongoing: true, endsOn: '2026-07-01' }, { clock });
    assert.equal(said.state, 'running');
    assert.equal(said.question, null);
    assert.equal(said.days, 16);
  });

  test('a course that ends today has not run out', () => {
    // The boundary. `days === 0` is the last day of the course, and asking
    // whether somebody is still taking it is wrong on the day they are.
    const said = medicationState({ ongoing: true, endsOn: TODAY }, { clock });
    assert.equal(said.state, 'running');
    assert.equal(said.question, null);
  });

  test('stopped with no date asks when', () => {
    const said = medicationState({ ongoing: false }, { clock });
    assert.equal(said.state, 'contradiction');
    assert.equal(said.question, QUESTION.STOPPED_WHEN);
  });

  test('stopped with a date is simply ended', () => {
    const said = medicationState({ ongoing: false, endsOn: '2026-03-01' }, { clock });
    assert.equal(said.state, 'ended');
    assert.equal(said.question, null);
  });

  test('a missing ongoing field is read as ongoing, because that is the default', () => {
    // The schema defaults it to true. Treating an absent value as false would
    // report every record written before the field existed as stopped.
    assert.equal(medicationState({}, { clock }).state, 'open');
    assert.equal(entities.medication.fields.find((f) => f.key === 'ongoing').default, true);
  });

  test('and nonsense is not a finding', () => {
    assert.equal(medicationState({ ongoing: true, endsOn: 'soon' }, { clock }).question, null);
    assert.equal(medicationState(null, { clock }).state, 'open');
  });
});

describe('an appointment record, read back', () => {
  test('still scheduled with the date gone by asks whether it happened', () => {
    const said = appointmentState({ date: '2026-05-02', status: 'scheduled' }, { clock });
    assert.equal(said.state, 'unanswered');
    assert.equal(said.question, QUESTION.DID_THEY_GO);
  });

  test('and does not call it missed', () => {
    // "Missed" is a value a person can choose. Deriving it would be this
    // screen deciding somebody did not turn up.
    const said = appointmentState({ date: '2026-05-02', status: 'scheduled' }, { clock });
    assert.notEqual(said.state, 'missed');
    assert.includes(entities.appointment.fields.find((f) => f.key === 'status').options, 'missed');
  });

  test('today is today, not overdue', () => {
    const said = appointmentState({ date: TODAY, status: 'scheduled' }, { clock });
    assert.equal(said.state, 'today');
    assert.equal(said.question, null);
  });

  test('one already answered raises nothing', () => {
    for (const status of ['attended', 'missed', 'cancelled']) {
      const said = appointmentState({ date: '2026-05-02', status }, { clock });
      assert.equal(said.question, null, status);
      assert.equal(said.state, status);
    }
  });

  test('and one still ahead raises nothing', () => {
    assert.equal(appointmentState({ date: '2026-08-01' }, { clock }).state, 'upcoming');
  });
});

describe('a next dose', () => {
  const hepB1 = {
    id: 'v1', person: 'p1', vaccine: 'Hepatitis B', date: '2025-12-01', nextDoseOn: '2026-03-01',
  };

  test('is outstanding when the date passed and nothing later is recorded', () => {
    const said = doseOutstanding(hepB1, [hepB1], { clock });
    assert.equal(said.outstanding, true);
    assert.equal(said.laterDose, null);
  });

  test('is not outstanding once a later dose of the same vaccine is on record', () => {
    // The reason this reads the whole list rather than one row: a screen that
    // asked only "is the date in the past" would keep asking a question the
    // household already answered, and one that keeps asking is one people
    // stop reading.
    const hepB2 = { id: 'v2', person: 'p1', vaccine: 'hepatitis b', date: '2026-03-04' };
    const said = doseOutstanding(hepB1, [hepB1, hepB2], { clock });
    assert.equal(said.outstanding, false);
    assert.equal(said.laterDose?.id, 'v2');
  });

  test('a later dose for somebody else does not answer it', () => {
    const theirs = { id: 'v3', person: 'p2', vaccine: 'Hepatitis B', date: '2026-03-04' };
    assert.equal(doseOutstanding(hepB1, [hepB1, theirs], { clock }).outstanding, true);
  });

  test('and neither does a different vaccine', () => {
    const other = { id: 'v4', person: 'p1', vaccine: 'Tetanus', date: '2026-03-04' };
    assert.equal(doseOutstanding(hepB1, [hepB1, other], { clock }).outstanding, true);
  });

  test('an abbreviation is not treated as the same vaccine', () => {
    // `Hep B` and `Hepatitis B` may well be the same jab. Deciding that they
    // are is a clinical judgement, and getting it wrong here would silently
    // mark a dose as given.
    const abbreviated = { id: 'v5', person: 'p1', vaccine: 'Hep B', date: '2026-03-04' };
    assert.equal(doseOutstanding(hepB1, [hepB1, abbreviated], { clock }).outstanding, true);
  });

  test('a dose recorded before the due date does not answer it either', () => {
    const early = { id: 'v6', person: 'p1', vaccine: 'Hepatitis B', date: '2026-01-04' };
    assert.equal(doseOutstanding(hepB1, [hepB1, early], { clock }).outstanding, true);
  });

  test('a date still ahead is not outstanding', () => {
    const ahead = { ...hepB1, nextDoseOn: '2026-09-01' };
    assert.equal(doseOutstanding(ahead, [ahead], { clock }).outstanding, false);
  });

  test('and no next dose at all raises nothing', () => {
    assert.equal(doseOutstanding({ id: 'v7', person: 'p1', vaccine: 'BCG' }, [], { clock })
      .outstanding, false);
  });
});

describe('a follow-up', () => {
  test('that has gone by says the records are silent, not that it was missed', () => {
    const said = followUpState({ followUpOn: '2026-04-01' }, { clock });
    assert.equal(said.state, 'passed');
    // There is no field recording that a follow-up happened, so nothing here
    // could say it did not.
    assert.not(entities.healthRecord.fields.some((f) => /followedUp|attended/i.test(f.key)));
  });

  test('that is ahead is ahead', () => {
    assert.equal(followUpState({ followUpOn: '2026-07-01' }, { clock }).state, 'ahead');
  });

  test('and no date is no finding', () => {
    assert.equal(followUpState({}, { clock }).state, 'none');
  });
});

describe('everything the records raise', () => {
  const sources = {
    medications: [
      { id: 'm1', person: 'p1', name: 'Amoxicillin', ongoing: true, endsOn: '2026-01-10' },
      { id: 'm2', person: 'p1', name: 'Thyroxine', ongoing: true },
    ],
    appointments: [
      { id: 'a1', person: 'p1', title: 'Dentist', date: '2026-06-01', status: 'scheduled' },
      { id: 'a2', person: 'p1', title: 'Eye test', date: '2026-08-01', status: 'scheduled' },
    ],
    vaccinations: [
      { id: 'v1', person: 'p1', vaccine: 'Tetanus', date: '2025-11-01', nextDoseOn: '2026-05-01' },
    ],
    records: [
      { id: 'h1', person: 'p1', title: 'Knee scan', followUpOn: '2026-02-01' },
      { id: 'h2', person: 'p1', title: 'Blood test', followUpOn: '2026-12-01' },
    ],
  };

  test('is one list, not four', () => {
    const out = openQuestions(sources, { clock });
    assert.length(out, 4);
    assert.deep([...new Set(out.map((one) => one.entity))].sort(),
      ['appointment', 'healthRecord', 'medication', 'vaccination']);
  });

  test('longest unanswered first, across kinds', () => {
    // Grouping by entity would bury a prescription that ran out in January
    // under whichever kind happened to be listed first.
    const out = openQuestions(sources, { clock });
    assert.deep(out.map((one) => one.id), ['m1', 'h1', 'v1', 'a1']);
  });

  test('and the ordering is not the order they were handed in', () => {
    const shuffled = {
      records: sources.records, vaccinations: sources.vaccinations,
      appointments: sources.appointments, medications: sources.medications,
    };
    assert.deep(openQuestions(shuffled, { clock }).map((one) => one.id),
      openQuestions(sources, { clock }).map((one) => one.id));
  });

  test('two questions from the same day keep a stable order', () => {
    const same = {
      medications: [
        { id: 'mB', person: 'p1', name: 'B', ongoing: true, endsOn: '2026-06-01' },
        { id: 'mA', person: 'p1', name: 'A', ongoing: true, endsOn: '2026-06-01' },
      ],
    };
    assert.deep(openQuestions(same, { clock }).map((one) => one.id), ['mA', 'mB']);
  });

  test('records that agree with themselves raise nothing at all', () => {
    const quiet = {
      medications: [{ id: 'm2', person: 'p1', name: 'Thyroxine', ongoing: true }],
      appointments: [{ id: 'a2', title: 'Eye test', date: '2026-08-01', status: 'scheduled' }],
      vaccinations: [], records: [],
    };
    assert.length(openQuestions(quiet, { clock }), 0);
  });

  test('nothing at all is nothing, not a throw', () => {
    assert.length(openQuestions(), 0);
    assert.length(openQuestions({}, { clock }), 0);
  });

  test('the same records asked on a later day raise more, not fewer', () => {
    // A question does not answer itself by the passage of time.
    const later = openQuestions(sources, at('2026-09-01'));
    assert.equal(later.length >= openQuestions(sources, { clock }).length, true);
  });

  test('every question has a sentence naming what it is about', () => {
    for (const key of Object.values(QUESTION)) {
      const said = strings[`health.q.${key}`];
      assert.ok(said, `health.q.${key} has no English`);
      assert.includes(said, '{subject}', `health.q.${key} names no record`);
      assert.ok(strings[`health.q.${key}.tag`], `health.q.${key}.tag has no English`);
    }
  });

  test('and none of them states a medical fact', () => {
    // Every finding is about the records. A sentence saying somebody is
    // overdue, at risk, or should do something would be this application
    // giving medical advice out of a tick box.
    for (const key of Object.values(QUESTION)) {
      const said = strings[`health.q.${key}`].toLowerCase();
      for (const word of ['overdue', 'you should', 'at risk', 'dangerous', 'urgent']) {
        assert.not(said.includes(word), `health.q.${key} says "${word}"`);
      }
    }
  });
});

describe('the medicine running out now warns', () => {
  test('every date a household must act on before it arrives is a reminder', () => {
    // Three of the four health dates already reached the reminders and the
    // tablets running out did not — the one a household has to act on
    // *before* the day rather than after it.
    const dates = [
      ['medication', 'endsOn'], ['vaccination', 'nextDoseOn'],
      ['healthRecord', 'followUpOn'], ['appointment', 'date'],
    ];
    for (const [name, key] of dates) {
      const field = entities[name].fields.find((f) => f.key === key);
      assert.ok(field?.expiry, `${name}.${key} produces no reminder`);
      assert.ok(Number(field.expiryLead) > 0, `${name}.${key} has no lead`);
    }
  });

  test('and medication is therefore derived rather than named by hand', () => {
    assert.includes(datedEntities(), 'medication');
  });
});

describe('what the screen admits it cannot show', () => {
  test('every absence has a sentence', () => {
    for (const key of CANNOT_SHOW) assert.ok(strings[key], `${key} has no English`);
  });

  test('and the list covers what a health app shows and this does not', () => {
    const said = CANNOT_SHOW.map((key) => strings[key]).join(' ').toLowerCase();
    for (const absent of ['steps', 'heart rate', 'sleep', 'cycle', 'drug database',
      'doses taken', 'diagnosis']) {
      assert.includes(said, absent, `nothing tells a household there is no ${absent}`);
    }
  });

  test('the screen draws them rather than only the domain declaring them', () => {
    const module = readFileSync(join(ROOT, 'js/modules/health.js'), 'utf8');
    assert.includes(module, 'CANNOT_SHOW');
    assert.includes(module, "from '../services/health.js'");
  });

  test('and the empty state claims nothing about anybody being well', () => {
    const said = strings['health.questions.noneMeans'].toLowerCase();
    assert.includes(said, 'not about');
    for (const word of ['healthy', 'all well', 'in good health', 'fine']) {
      assert.not(said.includes(word), `the empty state says "${word}"`);
    }
  });
});
