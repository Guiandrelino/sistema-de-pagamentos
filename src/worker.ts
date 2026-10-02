import amqp, { ConfirmChannel } from 'amqplib';
import { config } from './config';
import { pool, transaction } from './db';
import { eventSchema, processEvent } from './processor';

const queue = 'payments.commands';
const retryQueue = 'payments.retry';
const deadQueue = 'payments.dead';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function publish(channel: ConfirmChannel, target: string, content: Buffer, headers: Record<string, unknown> = {}) {
  await new Promise<void>((resolve, reject) => {
    channel.sendToQueue(target, content, { persistent: true, headers, contentType: 'application/json' }, (error) => error ? reject(error) : resolve());
  });
}

async function main() {
  const connection = await amqp.connect(config.AMQP_URL);
  connection.on('error', (error) => console.error('RabbitMQ connection error', error));
  // Exit on lost connection. A process supervisor can restart the worker.
  connection.on('close', () => { if (!stopping) process.exit(1); });
  const publisher = await connection.createConfirmChannel();
  const consumer = await connection.createConfirmChannel();
  publisher.on('error', (error) => { console.error(error); process.exit(1); });
  consumer.on('error', (error) => { console.error(error); process.exit(1); });
  await publisher.assertQueue(queue, { durable: true });
  await publisher.assertQueue(deadQueue, { durable: true });
  await publisher.assertQueue(retryQueue, {
    durable: true,
    arguments: { 'x-message-ttl': 5000, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue },
  });
  await consumer.prefetch(10);
  let stopping = false;
  const active = new Set<Promise<void>>();
  const subscription = await consumer.consume(queue, (message) => {
    if (!message) return;
    const task = (async () => {
      try {
        const event = eventSchema.parse(JSON.parse(message.content.toString('utf8')));
        await processEvent(event);
        consumer.ack(message);
      } catch (error) {
        console.error('Event failed', error);
        const rawAttempts = message.properties.headers?.attempts;
        const attempts = typeof rawAttempts === 'number' && Number.isInteger(rawAttempts) && rawAttempts >= 0 ? rawAttempts : 0;
        try {
          await publish(consumer, attempts >= 4 ? deadQueue : retryQueue, message.content, { attempts: attempts + 1 });
          consumer.ack(message);
        } catch (publishError) {
          console.error('Retry publication failed', publishError);
          consumer.nack(message, false, true);
        }
      }
    })();
    active.add(task);
    void task.finally(() => active.delete(task));
  });
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('Simulation worker running');
  while (!stopping) {
    try {
      await transaction(async (db) => {
        const batch = await db.query('SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED');
        for (const row of batch.rows) {
          await publish(publisher, queue, Buffer.from(JSON.stringify({ id: row.id, type: row.event_type, aggregateId: row.aggregate_id })));
          await db.query('UPDATE outbox SET published_at=now() WHERE id=$1', [row.id]);
        }
      });
    } catch (error) {
      console.error('Outbox publication failed', error);
    }
    await sleep(500);
  }
  await consumer.cancel(subscription.consumerTag);
  await Promise.allSettled([...active]);
  await connection.close();
  await pool.end();
}
main().catch(async (error) => { console.error(error); process.exitCode = 1; await pool.end(); });
