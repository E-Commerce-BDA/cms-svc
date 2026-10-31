import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { BlogUpdatedPayload, CmsUpdatedPayload } from '@ecom/contracts';
import type {
  EventTopic,
  MongoSessionLike,
  OutboxStorePort,
  OutboxWriteInput,
} from '@ecom/messaging';
import { OUTBOX_STORE } from '@ecom/messaging/nest';

/** The two topics cms-svc owns. `media.tasks` stays on the direct bus (D10). */
export type CmsEventTopic = 'cms.updated' | 'blog.updated';

export interface CmsUpdatedWrite {
  topic: 'cms.updated';
  /** `cms` unless the caller names a narrower aggregate (e.g. a single page). */
  aggregateType?: string;
  /** What the event is about: the slug, the page key, or the scope name. */
  aggregateId: string;
  payload: CmsUpdatedPayload;
  occurredAt?: Date;
}

export interface BlogUpdatedWrite {
  topic: 'blog.updated';
  aggregateType?: string;
  aggregateId: string;
  payload: BlogUpdatedPayload;
  occurredAt?: Date;
}

export type CmsEventWrite = CmsUpdatedWrite | BlogUpdatedWrite;

/**
 * Writes CMS events into the `cms_outbox` collection, inside the caller's
 * transaction.
 *
 * Payload assembly lives here, so `store.write` validates it against the
 * contracts schema before the document is inserted: a drifted payload aborts
 * the content mutation instead of leaving an event no consumer can parse.
 *
 * The transport topic is `cms.updated` / `blog.updated`, not the old
 * `cms.events` alias — the relay keys on `event_type`, and a row parked under
 * an alias would be an unknown topic to every consumer (D9).
 */
@Injectable()
export class CmsOutbox {
  constructor(@Inject(OUTBOX_STORE) private readonly store: OutboxStorePort<MongoSessionLike>) {}

  record(session: MongoSessionLike, write: CmsEventWrite): Promise<string> {
    if (write.topic === 'cms.updated') {
      return this.write(session, {
        topic: 'cms.updated',
        eventId: randomUUID(),
        aggregateType: write.aggregateType ?? 'cms',
        aggregateId: write.aggregateId,
        occurredAt: write.occurredAt ?? new Date(),
        payload: write.payload,
      });
    }

    return this.write(session, {
      topic: 'blog.updated',
      eventId: randomUUID(),
      aggregateType: write.aggregateType ?? 'blog',
      aggregateId: write.aggregateId,
      occurredAt: write.occurredAt ?? new Date(),
      payload: write.payload,
    });
  }

  private write<T extends EventTopic>(
    session: MongoSessionLike,
    input: OutboxWriteInput<T>,
  ): Promise<string> {
    return this.store.write(session, input);
  }
}
