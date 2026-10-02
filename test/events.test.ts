import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventSchema } from '../src/events';

const event = {
  id: 'dd97ea93-11ea-4181-b1cb-c9ad6c09123c',
  type: 'payment.requested',
  aggregateId: 'bce4a37d-dc91-490a-85c0-b83e2c1d5c77',
};

test('aceita apenas os tipos de evento conhecidos', () => {
  for (const type of ['payment.requested', 'refund.requested']) {
    assert.equal(eventSchema.safeParse({ ...event, type }).success, true);
  }
  assert.equal(eventSchema.safeParse({ ...event, type: 'payment.succeeded' }).success, false);
});

test('rejeita eventos incompletos e identificadores inválidos', () => {
  for (const value of [null, {}, { ...event, id: 'inválido' }, { ...event, aggregateId: '' }]) {
    assert.equal(eventSchema.safeParse(value).success, false);
  }
});

test('rejeita campos extras no envelope de evento', () => {
  assert.equal(eventSchema.safeParse({ ...event, amount: 500 }).success, false);
});
