import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  BlogUpdatedPayload,
  CmsUpdatedPayload,
  EventEnvelope,
  ResizeImageJob,
} from '@ecom/contracts';
import {
  EVENT_BUS_TOKEN,
  type IEventBus,
} from './event-bus/event-bus.interface.js';

@Injectable()
export class EventsService {
  constructor(
    @Inject(EVENT_BUS_TOKEN)
    private readonly eventBus: IEventBus,
  ) {}

  async publishCmsUpdated(payload: CmsUpdatedPayload): Promise<void> {
    const envelope: EventEnvelope = {
      id: randomUUID(),
      topic: 'cms.events',
      eventType: 'cms.updated',
      producer: 'cms-svc',
      timestamp: new Date().toISOString(),
      payload: { ...payload },
    };
    await this.eventBus.publish('cms.events', envelope);
  }

  async publishBlogUpdated(payload: BlogUpdatedPayload): Promise<void> {
    const envelope: EventEnvelope = {
      id: randomUUID(),
      topic: 'blog.events',
      eventType: 'blog.updated',
      producer: 'cms-svc',
      timestamp: new Date().toISOString(),
      payload: { ...payload },
    };
    await this.eventBus.publish('blog.events', envelope);
  }

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
