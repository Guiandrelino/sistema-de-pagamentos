import { randomUUID } from 'node:crypto';
import { PaymentEvent } from './events';
export { eventSchema, PaymentEvent } from './events';
import { transaction } from './db';
import { postings } from './domain';
import { audit } from './payments';

export async function processEvent(event: PaymentEvent) {
  await transaction(async (db) => {
    // Trust the persisted outbox, not arbitrary broker payloads.
    const source = await db.query('SELECT 1 FROM outbox WHERE id=$1 AND event_type=$2 AND aggregate_id=$3', [event.id, event.type, event.aggregateId]);
    if (!source.rowCount) throw new Error('Unknown event');
    const dedup = await db.query('INSERT INTO processed_events(event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.id]);
    if (!dedup.rowCount) return;
    const result = await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [event.aggregateId]);
    if (!result.rowCount) throw new Error('Payment missing');
    const payment = result.rows[0];
    const refund = event.type === 'refund.requested';
    const expected = refund ? 'REFUND_PENDING' : 'PENDING';
    if (payment.status !== expected) throw new Error(`Unexpected payment state: ${payment.status}`);
    const success = refund || payment.scenario === 'APPROVED';
    if (success) {
      const journalId = randomUUID();
      await db.query('INSERT INTO journal_entries(id,payment_id,operation) VALUES ($1,$2,$3)', [journalId, payment.id, refund ? 'REFUND' : 'PAYMENT']);
      for (const posting of postings(Number(payment.amount), refund)) {
        await db.query('INSERT INTO ledger_postings(journal_id,account,side,amount) VALUES ($1,$2,$3,$4)', [journalId, posting.account, posting.side, posting.amount]);
      }
    }
    const status = refund ? 'REFUNDED' : success ? 'SUCCEEDED' : 'FAILED';
    await db.query('UPDATE payments SET status=$2, updated_at=now() WHERE id=$1', [payment.id, status]);
    if (refund) await db.query("UPDATE refunds SET status='SUCCEEDED', updated_at=now() WHERE payment_id=$1", [payment.id]);
    await audit(db, payment.id, status);
  });
}
