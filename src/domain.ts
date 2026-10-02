import { createHash } from 'node:crypto';
import { z } from 'zod';

export const paymentInput = z.object({
  merchantId: z.string().uuid(),
  amount: z.number().int().positive().max(100_000_000),
  currency: z.literal('BRL').default('BRL'),
  method: z.enum(['PIX', 'CARD']),
  scenario: z.enum(['APPROVED', 'DECLINED']).default('APPROVED'),
}).strict();
export const merchantInput = z.object({ name: z.string().trim().min(2).max(120) }).strict();
export type PaymentInput = z.infer<typeof paymentInput>;
export function fingerprint(input: PaymentInput): string {
  return createHash('sha256').update(JSON.stringify([
    input.merchantId, input.amount, input.currency, input.method, input.scenario,
  ])).digest('hex');
}
export type Posting = { account: 'provider_clearing' | 'merchant_payable'; side: 'DEBIT' | 'CREDIT'; amount: number };
export function postings(amount: number, refund = false): Posting[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid amount');
  return [
    { account: 'provider_clearing', side: refund ? 'CREDIT' : 'DEBIT', amount },
    { account: 'merchant_payable', side: refund ? 'DEBIT' : 'CREDIT', amount },
  ];
}
