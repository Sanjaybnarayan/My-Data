/**
 * The family tree.
 *
 * Turning a list of relationship edges into generations is the whole problem,
 * and it is pure arithmetic over a graph — so it lives here, tested, rather
 * than tangled into a rendering function.
 *
 * Three things make a real family harder than a textbook tree:
 *
 *  - **It is not a tree.** Two parents per child, spouses joining branches,
 *    and step-relations mean the graph has cycles when you ignore direction.
 *    So generations are assigned by breadth-first relaxation from a root, not
 *    by recursive descent, which would not terminate.
 *  - **Relationships are entered from both ends.** Somebody records "A is
 *    parent of B" and somebody else records "B is child of A". Both are the
 *    same edge and must not produce two.
 *  - **People are missing.** A grandparent with no record still has
 *    grandchildren. An unreachable person is placed rather than dropped —
 *    losing someone from their own family tree is the one unacceptable
 *    outcome.
 */

/** Edge kinds reduced to a canonical direction: parent → child, or spouse. */
const CANONICAL = {
  'parent of': { kind: 'parent', flip: false },
  'child of': { kind: 'parent', flip: true },
  'grandparent of': { kind: 'grandparent', flip: false },
  'grandchild of': { kind: 'grandparent', flip: true },
  'guardian of': { kind: 'parent', flip: false },
  'spouse of': { kind: 'spouse', flip: false },
  'sibling of': { kind: 'sibling', flip: false },
};

/**
 * Deduplicate and normalise. `A parent of B` and `B child of A` collapse to
 * one edge; a spouse edge is undirected and stored once, lowest id first.
 */
export function normaliseEdges(relationships) {
  const seen = new Map();

  for (const record of relationships) {
    if (record.deletedAt) continue;
    const rule = CANONICAL[record.type];
    if (!rule || !record.fromPerson || !record.toPerson) continue;

    let from = rule.flip ? record.toPerson : record.fromPerson;
    let to = rule.flip ? record.fromPerson : record.toPerson;

    if (rule.kind === 'spouse' || rule.kind === 'sibling') {
      // Undirected: order the pair so the two directions are one entry.
      [from, to] = from < to ? [from, to] : [to, from];
    }

    const key = `${rule.kind}:${from}:${to}`;
    if (!seen.has(key)) seen.set(key, { kind: rule.kind, from, to, id: record.id });
  }

  return [...seen.values()];
}

/* --------------------------- what the person form already knows */

/**
 * `person.relationship`, as an edge to or from whoever is `self`.
 *
 * ## The gap this closes
 *
 * The person form carries a `relationship` dropdown — self, spouse, son,
 * daughter, father, mother, and the rest — right beside the name. Filling it in
 * is the obvious thing to do, and nothing on that screen suggests there is
 * anywhere else to record a family.
 *
 * The tree read none of it. Measured on six people, every one of them tagged:
 *
 *     what they filled in        what the tree showed
 *       Sanjay    self             generations : 1
 *       Asha      spouse           edges drawn : 0
 *       Ravi      son              unplaced    : all six
 *       Meera     daughter
 *       Krishnan  father         the same family via the Relationships
 *       Lakshmi   mother         entity gave three correct generations
 *
 * So a household that filled in its family got a flat list of strangers, and
 * the fix needed no new data — only reading what was already recorded.
 *
 * ## Implied, never stored
 *
 * These edges are derived at read time, like classification, provenance and
 * accrual before them. Writing them into the `relationship` entity would give
 * a household two copies of one fact to keep in step, and correcting the
 * dropdown afterwards would leave the copy behind.
 *
 * @param {'parent'|'grandparent'|'spouse'|'sibling'} kind
 * @param {boolean} fromSelf true when the edge runs self → them
 */
const IMPLIED = {
  spouse: { kind: 'spouse', fromSelf: true },
  son: { kind: 'parent', fromSelf: true },
  daughter: { kind: 'parent', fromSelf: true },
  father: { kind: 'parent', fromSelf: false },
  mother: { kind: 'parent', fromSelf: false },
  brother: { kind: 'sibling', fromSelf: true },
  sister: { kind: 'sibling', fromSelf: true },
  grandfather: { kind: 'grandparent', fromSelf: false },
  grandmother: { kind: 'grandparent', fromSelf: false },
  grandson: { kind: 'grandparent', fromSelf: true },
  granddaughter: { kind: 'grandparent', fromSelf: true },
};

/** In-laws hang off the spouse, not off self. */
const IN_LAW = new Set(['father-in-law', 'mother-in-law']);

/**
 * Edges implied by the `relationship` field on each person record.
 *
 * @returns {{edges: object[], why: string}} `why` is empty when it worked, and
 *   otherwise says what stopped it — never a silent nothing.
 */
export function impliedEdges(people) {
  const alive = (people ?? []).filter((p) => !p.deletedAt);
  const selves = alive.filter((p) => p.relationship === 'self');

  if (!selves.length) {
    return {
      edges: [],
      why: 'nobody is marked as “self”, so there is no one for “son” or '
        + '“mother” to be relative to',
    };
  }
  // Two people cannot both be the centre of one family. Picking one would
  // silently rearrange everybody else around a guess.
  if (selves.length > 1) {
    return {
      edges: [],
      why: `${selves.map((p) => p.name).join(' and ')} are both marked as “self”, `
        + 'so it is not clear whose family these relationships describe',
    };
  }

  const self = selves[0];
  const edges = [];
  let spouseless = 0;

  // An in-law is a parent of the spouse, so the spouse has to be found first.
  const spouse = alive.find((p) => p.relationship === 'spouse');

  // `self` needs no skip of its own: it is absent from both tables below, so
  // it falls through the same way `other` does. A guard for it survived
  // mutation testing precisely because it could never fire.
  for (const person of alive) {
    if (IN_LAW.has(person.relationship)) {
      if (!spouse) { spouseless += 1; continue; }
      edges.push({
        id: `implied:${person.id}`, type: 'parent of',
        fromPerson: person.id, toPerson: spouse.id, implied: true,
      });
      continue;
    }

    const rule = IMPLIED[person.relationship];
    if (!rule) continue;

    const [from, to] = rule.fromSelf ? [self.id, person.id] : [person.id, self.id];
    edges.push({
      id: `implied:${person.id}`,
      type: rule.kind === 'parent' ? 'parent of'
        : rule.kind === 'grandparent' ? 'grandparent of'
        : rule.kind === 'spouse' ? 'spouse of' : 'sibling of',
      fromPerson: from,
      toPerson: to,
      implied: true,
    });
  }

  return {
    edges,
    why: spouseless
      ? `${spouseless} in-law${spouseless === 1 ? '' : 's'} could not be placed, `
        + 'because no spouse is recorded for them to be a parent of'
      : '',
  };
}

/**
 * Where the dropdown and the recorded edges disagree.
 *
 * Two ways to record one fact means two ways to record it differently, and the
 * codebase's rule is that an uncertain match is never forced. So neither side
 * wins: both are reported, named, and left for a person to settle.
 *
 * @returns {Array<{person: object, said: string, recorded: string}>}
 */
export function relationshipConflicts(people, relationships) {
  const alive = (people ?? []).filter((p) => !p.deletedAt);
  const self = alive.find((p) => p.relationship === 'self');
  if (!self) return [];

  const stored = normaliseEdges(relationships ?? []);
  const byId = new Map(alive.map((p) => [p.id, p]));
  const conflicts = [];

  for (const implied of normaliseEdges(impliedEdges(alive).edges)) {
    const other = implied.from === self.id ? implied.to : implied.from;
    if (!byId.has(other)) continue;

    // Only edges between the same pair can disagree. A pair with no stored
    // edge at all is not a conflict — it is the gap this fills.
    const between = stored.filter((edge) => (edge.from === implied.from && edge.to === implied.to)
      || (edge.from === implied.to && edge.to === implied.from));
    if (!between.length) continue;

    const agrees = between.some((edge) => edge.kind === implied.kind
      && edge.from === implied.from && edge.to === implied.to);
    if (agrees) continue;

    const recorded = between[0];
    conflicts.push({
      person: byId.get(other),
      said: byId.get(other).relationship,
      recorded: recorded.from === self.id
        ? `${recorded.kind} of them` : `their ${recorded.kind}`,
    });
  }

  return conflicts;
}

/**
 * Assign every person a generation number, where 0 is the root's generation,
 * negative is older and positive is younger.
 *
 * @param {object[]} people
 * @param {object[]} relationships
 * @param {{rootId?: string, implied?: boolean}} [options]
 *   `implied` reads the `relationship` field on each person as an edge too.
 *   On by default: leaving it off is what produced a flat tree for every
 *   household that filled the form in and never opened Relationships.
 * @returns {{generations: Array<{level: number, people: object[]}>,
 *            edges: object[], levelOf: Map<string, number>, unplaced: object[],
 *            impliedCount: number, why: string}}
 */
export function buildTree(people, relationships, { rootId, implied = true } = {}) {
  const alive = people.filter((p) => !p.deletedAt);
  const byId = new Map(alive.map((p) => [p.id, p]));

  // Stored edges first, so `normaliseEdges` keeps the recorded one where an
  // implied edge would collapse onto it. A relationship somebody entered
  // deliberately should be the one that carries its own id.
  const derived = implied ? impliedEdges(alive) : { edges: [], why: '' };
  const edges = normaliseEdges([...(relationships ?? []), ...derived.edges]).filter(
    (e) => byId.has(e.from) && byId.has(e.to),
  );

  // Adjacency with a generation delta on each step: a parent edge moves one
  // generation, a grandparent edge two, a spouse or sibling edge none.
  const links = new Map(alive.map((p) => [p.id, []]));
  const delta = { parent: 1, grandparent: 2, spouse: 0, sibling: 0 };

  for (const edge of edges) {
    links.get(edge.from).push({ to: edge.to, step: delta[edge.kind] });
    links.get(edge.to).push({ to: edge.from, step: -delta[edge.kind] });
  }

  const root = rootId && byId.has(rootId)
    ? rootId
    : (alive.find((p) => p.relationship === 'self') ?? alive[0])?.id;

  const levelOf = new Map();
  if (!root) {
    return {
      generations: [], edges, levelOf, unplaced: [],
      impliedCount: derived.edges.length, why: derived.why,
    };
  }

  // Breadth-first over every component, not just the root's: a family with an
  // in-law branch nobody has linked yet still has to appear.
  const roots = [root, ...alive.map((p) => p.id)];
  for (const start of roots) {
    if (levelOf.has(start)) continue;
    levelOf.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      const level = levelOf.get(current);
      for (const link of links.get(current) ?? []) {
        if (levelOf.has(link.to)) continue;
        levelOf.set(link.to, level + link.step);
        queue.push(link.to);
      }
    }
  }

  const byLevel = new Map();
  for (const person of alive) {
    const level = levelOf.get(person.id) ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(person);
  }

  const generations = [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, group]) => ({
      level,
      // Oldest first inside a generation, then by name — so siblings appear
      // in the order a family would list them.
      people: group.sort((a, b) => {
        if (a.birthday && b.birthday) return a.birthday.localeCompare(b.birthday);
        if (a.birthday) return -1;
        if (b.birthday) return 1;
        return String(a.name).localeCompare(String(b.name));
      }),
    }));

  return {
    generations,
    edges,
    levelOf,
    unplaced: alive.filter((p) => !links.get(p.id)?.length),
    // How much of the tree came from the person form rather than from the
    // Relationships entity. Worth surfacing: a household seeing their family
    // appear should be able to tell it was inferred from what they typed.
    impliedCount: derived.edges.length,
    why: derived.why,
  };
}

/** A label for a generation, relative to the root's. */
export function generationLabel(level) {
  if (level === 0) return 'This generation';
  if (level === -1) return 'Parents';
  if (level === -2) return 'Grandparents';
  if (level === 1) return 'Children';
  if (level === 2) return 'Grandchildren';
  return level < 0 ? `${-level} generations back` : `${level} generations on`;
}

/**
 * How two people are related, in words, derived from the edges rather than
 * from a stored label — so it stays right when somebody edits the graph.
 */
export function describeRelation(fromId, toId, relationships) {
  const edges = normaliseEdges(relationships);

  for (const edge of edges) {
    if (edge.kind === 'parent' && edge.from === fromId && edge.to === toId) return 'parent';
    if (edge.kind === 'parent' && edge.to === fromId && edge.from === toId) return 'child';
    if (edge.kind === 'grandparent' && edge.from === fromId && edge.to === toId) return 'grandparent';
    if (edge.kind === 'grandparent' && edge.to === fromId && edge.from === toId) return 'grandchild';
    if (edge.kind === 'spouse' && (edge.from === fromId || edge.to === fromId)
      && (edge.from === toId || edge.to === toId)) return 'spouse';
    if (edge.kind === 'sibling' && (edge.from === fromId || edge.to === fromId)
      && (edge.from === toId || edge.to === toId)) return 'sibling';
  }

  // Two people sharing a parent are siblings whether or not anyone said so.
  const parentsOf = (id) => edges
    .filter((e) => e.kind === 'parent' && e.to === id)
    .map((e) => e.from);
  const shared = parentsOf(fromId).filter((p) => parentsOf(toId).includes(p));
  if (shared.length && fromId !== toId) return 'sibling';

  return null;
}
