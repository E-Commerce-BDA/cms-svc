import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { MongoOutboxDb } from '@ecom/messaging';
import type { Connection } from 'mongoose';

/**
 * The `db` thunk `createMongoOutboxModule` asks for.
 *
 * The outbox module is a plain `DynamicModule`, so its store factory has no
 * injector of its own. The connection is therefore captured once by a provider
 * of the global `DbModule`: `MongooseModule.forRootAsync` resolves it while the
 * module graph is being instantiated, which is before any `onModuleInit` (where
 * the store creates its indexes) can run.
 */
let current: Connection | null = null;

@Injectable()
export class MongoConnectionBinder {
  constructor(@InjectConnection() connection: Connection) {
    current = connection;
  }
}

export function mongoConnection(): Connection {
  if (!current) {
    throw new Error(
      'Mongo connection requested before DbModule resolved it; only use the outbox after app init',
    );
  }

  return current;
}

/**
 * Structural view of the driver's `Db` for the outbox store. The store never
 * imports `mongodb`, so the cast is the seam where the real driver meets it.
 */
export function mongoOutboxDb(): MongoOutboxDb {
  const db = mongoConnection().db;

  if (!db) {
    throw new Error('Mongo connection is not ready: the outbox cannot be used');
  }

  return db as unknown as MongoOutboxDb;
}
