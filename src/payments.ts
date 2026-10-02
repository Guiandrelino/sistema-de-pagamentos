import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { pool, transaction } from './db';
import { fingerprint, PaymentInput } from './domain';

export async function enqueue(db: PoolClient, type: string, aggregateId: string) {
  await db.query('INSERT INTO outbox(id, event_type, aggregate_id) VALUES ($1,$2,$3)', [randomUUID(), type, aggregateId]);
}
export async function audit(db: PoolClient, paymentId: string, action: string) {
  await db.query('INSERT INTO audit_events(payment_id, action) VALUES ($1,$2)', [paymentId, action]);
}
export async function createPayment(input: PaymentInput, key: string) {
  return transaction(async (db) => {
    const merchant = await db.query('SELECT id FROM merchants WHERE id=$1', [input.merchantId]);
    if (!merchant.rowCount) throw new NotFoundException('Merchant not found');
    const hash = fingerprint(input);
    const inserted = await db.query(
      `INSERT INTO payments(id, merchant_id, amount, currency, method, scenario, idempotency_key, request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (merchant_id, idempotency_key) DO NOTHING RETURNING *`,
      [randomUUID(), input.merchantId, input.amount, input.currency, input.method, input.scenario, key, hash],
    );
    if (inserted.rowCount) {
      const payment = inserted.rows[0];
      await enqueue(db, 'payment.requested', payment.id);
      await audit(db, payment.id, 'PAYMENT_CREATED');
      return payment;
    }
    const existing = await db.query('SELECT * FROM payments WHERE merchant_id=$1 AND idempotency_key=$2', [input.merchantId, key]);
    if (existing.rows[0].request_hash !== hash) throw new ConflictException('Idempotency key reused with different payload');
    return existing.rows[0];
  });
}
export async function getPayment(id: string) {
  const result = await pool.query('SELECT * FROM payments WHERE id=$1', [id]);
  if (!result.rowCount) throw new NotFoundException('Payment not found');
  return result.rows[0];
}
export async function refundPayment(id: string, key: string) {
  return transaction(async (db) => {
    const payment = await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id]);
    if (!payment.rowCount) throw new NotFoundException('Payment not found');
    const existing = await db.query('SELECT * FROM refunds WHERE payment_id=$1', [id]);
    if (existing.rowCount) {
      if (existing.rows[0].idempotency_key !== key) throw new ConflictException('Payment already has a refund');
      return existing.rows[0];
    }
    if (payment.rows[0].status !== 'SUCCEEDED') throw new ConflictException('Only successful payments can be refunded');
    const result = await db.query('INSERT INTO refunds(id, payment_id, idempotency_key) VALUES ($1,$2,$3) RETURNING *', [randomUUID(), id, key]);
    await db.query("UPDATE payments SET status='REFUND_PENDING', updated_at=now() WHERE id=$1", [id]);
    await enqueue(db, 'refund.requested', id);
    await audit(db, id, 'REFUND_REQUESTED');
    return result.rows[0];
  });
}
