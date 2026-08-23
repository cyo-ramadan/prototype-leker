import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAccountingBridgeIfEnabled } from '../src/index.js';

const payloadByType = Object.freeze({
  SALE: { sale: { id: 'sale-1' } },
  PURCHASE: { id: 'purchase-1' },
  EXPENSE: { ids: ['expense-1', 'expense-2'] }
});

function fakeDb(edition) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) {
          statement.args = args;
          return statement;
        },
        first() {
          queries.push({ sql, args: statement.args });
          if (/^SELECT store_id FROM (sales|purchases|expenses)/.test(sql)) return { store_id: 'store-1' };
          if (sql === 'SELECT edition FROM stores WHERE id = ? LIMIT 1') return { edition };
          throw new Error(`Unexpected SQL: ${sql}`);
        }
      };
      return statement;
    }
  };
}

for (const edition of ['LITE', 'FLEXIBLE']) {
  for (const factType of ['SALE', 'PURCHASE', 'EXPENSE']) {
    test(`${edition} ${factType} skips Accounting dispatcher entirely`, async () => {
      const DB = fakeDb(edition);
      const response = Response.json(payloadByType[factType], { status: 201 });
      const deliveries = [];
      const dispatch = async (committedResponse, env, type) => {
        deliveries.push({ committedResponse, env, type });
        return Response.json({ unexpected: true }, { status: 201 });
      };

      const result = await attachAccountingBridgeIfEnabled(response, { DB }, factType, dispatch);

      assert.equal(result, response);
      assert.equal(deliveries.length, 0);
      assert.equal(DB.queries.length, 2);
      assert.match(DB.queries[0].sql, new RegExp(`^SELECT store_id FROM ${{ SALE: 'sales', PURCHASE: 'purchases', EXPENSE: 'expenses' }[factType]}`));
      assert.equal(DB.queries[1].sql, 'SELECT edition FROM stores WHERE id = ? LIMIT 1');
      assert.deepEqual(DB.queries[1].args, ['store-1']);
    });
  }
}

for (const factType of ['SALE', 'PURCHASE', 'EXPENSE']) {
  test(`ACCOUNTING ${factType} preserves the existing dispatcher path`, async () => {
    const DB = fakeDb('ACCOUNTING');
    const response = Response.json(payloadByType[factType], { status: 201 });
    const calls = [];
    const dispatched = Response.json({ dispatched: factType }, { status: 201 });
    const dispatch = async (committedResponse, env, type) => {
      calls.push({ committedResponse, env, type });
      return dispatched;
    };

    const result = await attachAccountingBridgeIfEnabled(response, { DB }, factType, dispatch);

    assert.equal(result, dispatched);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].committedResponse, response);
    assert.equal(calls[0].env.DB, DB);
    assert.equal(calls[0].type, factType);
  });
}

test('unresolved edition preserves the previous Accounting bridge behavior instead of silently dropping delivery', async () => {
  const DB = fakeDb(null);
  const response = Response.json(payloadByType.SALE, { status: 201 });
  let calls = 0;
  const dispatch = async () => {
    calls += 1;
    return Response.json({ bridgeStatus: 'FAILED' }, { status: 201 });
  };

  const result = await attachAccountingBridgeIfEnabled(response, { DB }, 'SALE', dispatch);

  assert.equal(calls, 1);
  assert.deepEqual(await result.json(), { bridgeStatus: 'FAILED' });
});
