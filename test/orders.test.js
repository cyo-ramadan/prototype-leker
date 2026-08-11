import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, validateRequestedItems } from '../src/orders.js';
import { getJakartaBusinessDate } from '../src/time.js';

test('order lifecycle is Dipesan -> Diterima -> Dibuat -> Sudah Jadi', () => {
  assert.equal(canTransition('NEW', 'PREPARING'), true);
  assert.equal(canTransition('NEW', 'CANCELLED'), true);
  assert.equal(canTransition('PREPARING', 'READY'), true);
  assert.equal(canTransition('PREPARING', 'CANCELLED'), false);
  assert.equal(canTransition('READY', 'COMPLETED'), true);
  assert.equal(canTransition('READY', 'CANCELLED'), false);
  assert.equal(canTransition('COMPLETED', 'READY'), false);
  assert.equal(canTransition('CANCELLED', 'PREPARING'), false);
});

test('requested item quantity is validated', () => {
  assert.equal(validateRequestedItems([{ menuId: 1, qty: 2 }]).ok, true);
  assert.equal(validateRequestedItems([{ menuId: 1, qty: 0 }]).ok, false);
  assert.equal(validateRequestedItems([{ menuId: 1, qty: 21 }]).ok, false);
});

test('Jakarta business date is stable around UTC day boundary', () => {
  const date = new Date('2026-08-07T18:30:00.000Z');
  assert.equal(getJakartaBusinessDate(date), '2026-08-08');
});
