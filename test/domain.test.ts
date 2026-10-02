import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, paymentInput, postings } from '../src/domain';

const input = { merchantId: 'bce4a37d-dc91-490a-85c0-b83e2c1d5c77', amount: 1099, method: 'PIX' as const };

test('amount must be positive integer cents', () => {
  for (const amount of [0, -1, 1.5, 100_000_001, Number.NaN]) {
    assert.equal(paymentInput.safeParse({ ...input, amount }).success, false);
  }
  assert.equal(paymentInput.parse(input).amount, 1099);
});
test('no raw card data or unsupported currencies accepted', () => {
  assert.equal(paymentInput.safeParse({ ...input, cardNumber: '4242424242424242' }).success, false);
  assert.equal(paymentInput.safeParse({ ...input, currency: 'USD' }).success, false);
});
test('fingerprint is stable and includes simulation scenario', () => {
  const parsed = paymentInput.parse(input);
  assert.equal(fingerprint(parsed), fingerprint(paymentInput.parse({ ...input, currency: 'BRL', scenario: 'APPROVED' })));
  assert.notEqual(fingerprint(parsed), fingerprint({ ...parsed, amount: 1100 }));
  assert.notEqual(fingerprint(parsed), fingerprint({ ...parsed, scenario: 'DECLINED' }));
});
test('payment and refund produce balanced reverse postings', () => {
  const payment = postings(1099);
  const refund = postings(1099, true);
  for (const entries of [payment, refund]) {
    assert.equal(entries.reduce((sum, entry) => sum + (entry.side === 'DEBIT' ? entry.amount : -entry.amount), 0), 0);
  }
  assert.equal(payment[0].side, 'DEBIT');
  assert.equal(refund[0].side, 'CREDIT');
  assert.throws(() => postings(0));
  assert.throws(() => postings(1.2));
});
