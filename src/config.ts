import 'dotenv/config';
import { z } from 'zod';

export const config = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://payments:payments@localhost:5432/payments'),
  AMQP_URL: z.string().min(1).default('amqp://payments:payments@localhost:5672'),
  API_KEY: z.string().min(16).default('local-simulation-only'),
}).parse(process.env);
