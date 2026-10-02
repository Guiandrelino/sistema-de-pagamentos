import 'reflect-metadata';
import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext,
  Get, Headers, Injectable, Module, Param, Post, UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { matchesApiKey } from './auth';
import { z } from 'zod';
import { config } from './config';
import { pool } from './db';
import { merchantInput, paymentInput } from './domain';
import { createPayment, getPayment, refundPayment } from './payments';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error.issues);
  return result.data;
}
const uuid = z.string().uuid();
const keySchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/);

@Injectable()
class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const value = context.switchToHttp().getRequest().headers['x-api-key'];
    if (!matchesApiKey(value, config.API_KEY)) throw new UnauthorizedException();
    return true;
  }
}

@Controller()
class PaymentsController {
  @Get('health')
  async health() {
    await pool.query('SELECT 1');
    return { status: 'ok', mode: 'SIMULATION_ONLY' };
  }

  @Post('merchants')
  async merchant(@Body() body: unknown) {
    const input = parse(merchantInput, body);
    const result = await pool.query('INSERT INTO merchants(id,name) VALUES ($1,$2) RETURNING *', [randomUUID(), input.name]);
    return result.rows[0];
  }

  @Post('payments')
  create(@Body() body: unknown, @Headers('idempotency-key') key: unknown) {
    return createPayment(parse(paymentInput, body), parse(keySchema, key));
  }

  @Get('payments/:id')
  get(@Param('id') id: string) {
    return getPayment(parse(uuid, id));
  }

  @Post('payments/:id/refunds')
  refund(@Param('id') id: string, @Headers('idempotency-key') key: unknown, @Body() body: unknown) {
    parse(z.object({}).strict(), body ?? {});
    return refundPayment(parse(uuid, id), parse(keySchema, key));
  }

  @Get('payments/:id/audit')
  async audit(@Param('id') id: string) {
    await getPayment(parse(uuid, id));
    const result = await pool.query('SELECT action, created_at FROM audit_events WHERE payment_id=$1 ORDER BY id', [id]);
    return result.rows;
  }

  @Get('merchants/:id/balance')
  async balance(@Param('id') id: string) {
    const merchantId = parse(uuid, id);
    const merchant = await pool.query('SELECT id FROM merchants WHERE id=$1', [merchantId]);
    if (!merchant.rowCount) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException('Merchant not found');
    }
    const result = await pool.query(
      `SELECT coalesce(sum(CASE WHEN l.side='CREDIT' THEN l.amount ELSE -l.amount END),0)::text AS amount
       FROM ledger_postings l JOIN journal_entries j ON j.id=l.journal_id
       JOIN payments p ON p.id=j.payment_id WHERE p.merchant_id=$1 AND l.account='merchant_payable'`, [merchantId],
    );
    return { merchantId, amount: result.rows[0].amount, currency: 'BRL', simulated: true };
  }
}

@Module({ controllers: [PaymentsController], providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }] })
class AppModule {}

async function main() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.PORT, '127.0.0.1');
  console.log('SIMULATION ONLY: no real payment provider configured');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
