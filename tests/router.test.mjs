/**
 * Addresses.
 *
 * Every screen in this application is reached by a hash, and until a screen
 * started routing on a category every segment that had ever gone into one was
 * a module name, an entity name or a ULID — none of which contain a character
 * that needs escaping. So the router wrote its segments raw, and that read as
 * correct for as long as nothing exercised it.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { Router } from '../js/ui/router.js';

setSuite('router');

describe('a segment survives the round trip', () => {
  // Fourteen of the forty-six categories the schema offers contain a space.
  const cases = [
    'groceries', 'food delivery', 'rental income', 'sent to person',
    'bank charges', 'credit card', 'EMI', 'ccn_01M1P926RYX6F2BP3DV09YF43K',
  ];

  for (const id of cases) {
    test(`\`${id}\` comes back as itself`, () => {
      const href = Router.href({ module: 'finance', entity: 'category', id });
      assert.equal(Router.parse(href).id, id);
    });
  }

  test('a space is escaped on the way out rather than left in the address', () => {
    // Assigning `location.hash` makes the browser escape it anyway. Doing it
    // here is what makes the two halves agree: nothing decoded on the way
    // back, so the screen was handed `food%20delivery`, which matches no
    // category, and showed "nothing recorded" for one a household spends in
    // every week.
    assert.equal(
      Router.href({ module: 'finance', entity: 'category', id: 'food delivery' }),
      '#/finance/category/food%20delivery',
    );
  });

  test('a slash inside a segment is data, not a separator', () => {
    const href = Router.href({ module: 'finance', entity: 'category', id: 'a/b' });
    const route = Router.parse(href);
    assert.equal(route.id, 'a/b');
    assert.equal(route.entity, 'category');
  });

  test('a malformed escape is passed through rather than thrown on', () => {
    // A hand-edited address can carry one. `decodeURIComponent` throws on
    // `%zz`, and a route is not worth an exception — the screen it reaches
    // shows its own empty state, which is what an address naming nothing
    // should do.
    assert.equal(Router.parse('#/finance/category/%zz').id, '%zz');
    assert.equal(Router.parse('#/finance/category/100%').id, '100%');
  });
});

describe('the shapes already in use are unchanged', () => {
  test('a plain module', () => {
    assert.equal(Router.parse('#/finance').module, 'finance');
    assert.equal(Router.parse('#/finance').entity, null);
  });

  test('an entity list, and a record inside it', () => {
    const route = Router.parse('#/finance/transaction/ccn_01ABC');
    assert.equal(route.module, 'finance');
    assert.equal(route.entity, 'transaction');
    assert.equal(route.id, 'ccn_01ABC');
  });

  test('the new-record address still reads as an action', () => {
    assert.equal(Router.parse('#/finance/transaction/new').action, 'new');
  });

  test('an empty hash is the dashboard', () => {
    assert.equal(Router.parse('').module, 'dashboard');
    assert.equal(Router.parse('#/').module, 'dashboard');
  });

  test('a query is parsed beside the path, not into it', () => {
    const route = Router.parse('#/finance/transaction?category=food%20delivery');
    assert.equal(route.entity, 'transaction');
    assert.equal(route.id, null);
    assert.equal(route.query.category, 'food delivery');
    assert.equal(route.path, 'finance/transaction');
  });

  test('and `href` builds one back', () => {
    assert.equal(
      Router.href({ module: 'finance', entity: 'transaction', query: { category: 'groceries' } }),
      '#/finance/transaction?category=groceries',
    );
  });

  test('an empty query adds no question mark', () => {
    assert.equal(Router.href({ module: 'finance', query: {} }), '#/finance');
    assert.equal(Router.href({ module: 'finance' }), '#/finance');
  });
});
