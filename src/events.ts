import { z } from 'zod';

/** Envelope mínimo: os dados financeiros são consultados na outbox persistida. */
export const eventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['payment.requested', 'refund.requested']),
  aggregateId: z.string().uuid(),
}).strict();

export type PaymentEvent = z.infer<typeof eventSchema>;
