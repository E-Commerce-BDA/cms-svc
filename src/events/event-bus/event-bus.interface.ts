import type { EventEnvelope } from '@ecom/contracts';

export interface IEventBus {
  publish(topic: string, event: EventEnvelope, key?: string): Promise<void>;
}

export const EVENT_BUS_TOKEN = Symbol('EVENT_BUS_TOKEN');
