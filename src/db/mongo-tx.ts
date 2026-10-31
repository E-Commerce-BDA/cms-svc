import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';

/**
 * Run `fn` inside one MongoDB transaction.
 *
 * This is legal against the local single-node replica set because its
 * `MONGODB_URI` uses `directConnection=true` (see `test/setup-env.ts` and
 * `.env`): transactions and retryable writes need a replica set, and the flag
 * keeps the driver talking to the member instead of the advertised hostname.
 *
 * `withTransaction` retries the callback on transient errors, so `fn` must be
 * safe to re-run — it is, because every attempt of an aborted transaction left
 * nothing behind.
 */
export async function withMongoTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();

  try {
    const result: { value: T } | null = { value: undefined as T };

    await session.withTransaction(async () => {
      result.value = await fn(session);
    });

    return result.value;
  } finally {
    await session.endSession();
  }
}

/**
 * The injectable form, so a service does not have to hold a `Connection`.
 *
 * Content writes use this instead of `connection.startSession()` directly: the
 * transaction boundary then reads as one call in the service and the tests can
 * swap it for a runner that hands out a fake session.
 */
@Injectable()
export class MongoTransactions {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  run<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    return withMongoTransaction(this.connection, fn);
  }
}
