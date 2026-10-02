import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { pool, transaction } from '../../src/db';
import { paymentInput } from '../../src/domain';
import { createPayment, getPayment, refundPayment } from '../../src/payments';
import { PaymentEvent, processEvent } from '../../src/processor';

after(() => pool.end());

async function eventFor(id: string, type: PaymentEvent['type']): Promise<PaymentEvent> {
  const result = await pool.query('SELECT id, event_type AS type, aggregate_id AS "aggregateId" FROM outbox WHERE aggregate_id=$1 AND event_type=$2', [id, type]);
  return result.rows[0];
}

test('concurrent idempotency, duplicate delivery, decline and refund', async () => {
  const merchantId = randomUUID();
  await pool.query('INSERT INTO merchants(id,name) VALUES ($1,$2)', [merchantId, 'Integration test']);
  const input = paymentInput.parse({ merchantId, amount: 2500, method: 'PIX' });
  const key = randomUUID();
  const payments = await Promise.all(Array.from({ length: 5 }, () => createPayment(input, key)));
  assert.equal(new Set(payments.map((p) => p.id)).size, 1);
  await assert.rejects(createPayment({ ...input, amount: 2501 }, key));
  const payment = payments[0];
  const event = await eventFor(payment.id, 'payment.requested');
  await Promise.all([processEvent(event), processEvent(event)]);
  assert.equal((await getPayment(payment.id)).status, 'SUCCEEDED');
  const journal = await pool.query('SELECT id FROM journal_entries WHERE payment_id=$1', [payment.id]);
  assert.equal(journal.rowCount, 1);

  const refundKey = randomUUID();
  const refunds = await Promise.all([refundPayment(payment.id, refundKey), refundPayment(payment.id, refundKey)]);
  assert.equal(refunds[0].id, refunds[1].id);
  await assert.rejects(refundPayment(payment.id, randomUUID()));
  const refundEvent = await eventFor(payment.id, 'refund.requested');
  await processEvent(refundEvent);
  await processEvent(refundEvent);
  assert.equal((await getPayment(payment.id)).status, 'REFUNDED');
  const balance = await pool.query(`SELECT sum(CASE WHEN l.side='CREDIT' THEN l.amount ELSE -l.amount END)::text AS total
    FROM ledger_postings l JOIN journal_entries j ON j.id=l.journal_id
    WHERE j.payment_id=$1 AND l.account='merchant_payable'`, [payment.id]);
  assert.equal(balance.rows[0].total, '0');

  const declined = await createPayment({ ...input, scenario: 'DECLINED' }, randomUUID());
  await processEvent(await eventFor(declined.id, 'payment.requested'));
  assert.equal((await getPayment(declined.id)).status, 'FAILED');
  const declinedJournal = await pool.query('SELECT 1 FROM journal_entries WHERE payment_id=$1', [declined.id]);
  assert.equal(declinedJournal.rowCount, 0);
  await assert.rejects(refundPayment(declined.id, randomUUID()));

  await assert.rejects(transaction(async (db) => {
    await db.query("INSERT INTO journal_entries(id,payment_id,operation) VALUES ($1,$2,'PAYMENT')", [randomUUID(), declined.id]);
  }), /Unbalanced journal/);
  await assert.rejects(pool.query('DELETE FROM ledger_postings WHERE journal_id=$1', [journal.rows[0].id]), /append-only/);
});
