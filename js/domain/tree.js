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

/**
 * Assign every person a generation number, where 0 is the root's generation,
 * negative is older and positive is younger.
 *
 * @param {object[]} people
 * @param {object[]} relationships
 * @param {{rootId?: string}} [options]
 * @returns {{generations: Array<{level: number, people: object[]}>,
 *            edges: object[], levelOf: Map<string, number>, unplaced: object[]}}
 */
export function buildTree(people, relationships, { rootId } = {}) {
  const alive = people.filter((p) => !p.deletedAt);
  const byId = new Map(alive.map((p) => [p.id, p]));
  const edges = normaliseEdges(relationships).filter(
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
  if (!root) return { generations: [], edges, levelOf, unplaced: [] };

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
