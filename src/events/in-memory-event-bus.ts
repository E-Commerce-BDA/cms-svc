import { Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope } from '@ecom/contracts';
import type { IEventBus } from './event-bus/event-bus.interface.js';

@Injectable()
export class InMemoryEventBus implements IEventBus {
  private readonly logger = new Logger(InMemoryEventBus.name);
  private readonly publishedEvents: { topic: string; event: EventEnvelope }[] =
    [];

  async publish(topic: string, event: EventEnvelope): Promise<void> {
    this.logger.debug(
      `[${topic}] Published event ${event.eventType} id=${event.id}`,
    );
    this.publishedEvents.push({ topic, event });
  }

  getEvents(): { topic: string; event: EventEnvelope }[] {
    return [...this.publishedEvents];
  }

  clear(): void {
    this.publishedEvents.length = 0;
  }
}
