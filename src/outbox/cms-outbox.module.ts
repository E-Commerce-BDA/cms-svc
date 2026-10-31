import { Global, Module } from '@nestjs/common';
import { createMongoOutboxModule } from '@ecom/messaging/nest';
import { mongoOutboxDb } from '../db/mongo-connection.js';
import { CmsOutbox } from './cms-outbox.js';

/**
 * `cms_outbox` is a collection, not a table, so this module is the Mongo twin
 * of the Postgres `createOutboxModule` the other four services import: same
 * relay, same publisher, same retry policy, different store.
 *
 * `db` is a thunk because the store is only used after the connection exists;
 * see `mongo-connection.ts`.
 */
@Global()
@Module({
  imports: [
    createMongoOutboxModule({
      collection: 'cms_outbox',
      producer: 'cms-svc',
      clientId: 'cms-svc',
      db: () => mongoOutboxDb(),
    }),
  ],
  providers: [CmsOutbox],
  exports: [CmsOutbox],
})
export class CmsOutboxModule {}
