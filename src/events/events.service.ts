import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { EventEnvelope, ResizeImageJob } from '@ecom/contracts';
import {
  EVENT_BUS_TOKEN,
  type IEventBus,
} from './event-bus/event-bus.interface.js';

/**
 * The last producer left on the direct bus.
 *
 * `cms.updated` and `blog.updated` moved to the outbox (`cms-005`): they are
 * domain events and must be written inside the transaction that changed the
 * content. `media.tasks` is a work queue, not an `EventTopic` — the relay would
 * park it — so it stays here until `cms-006` moves it to SQS.
 */
@Injectable()
export class EventsService {
  constructor(
    @Inject(EVENT_BUS_TOKEN)
    private readonly eventBus: IEventBus,
  ) {}

  async publishResizeImageJob(payload: ResizeImageJob): Promise<void> {
    const envelope: EventEnvelope = {
      id: randomUUID(),
      topic: 'media.tasks',
      eventType: 'media.resize-image',
      producer: 'cms-svc',
      timestamp: new Date().toISOString(),
      payload: { ...payload },
    };
    await this.eventBus.publish('media.tasks', envelope);
  }
}
