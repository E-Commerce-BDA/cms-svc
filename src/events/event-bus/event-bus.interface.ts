import type { EventEnvelope } from '@ecom/contracts';

export interface IEventBus {
  publish(topic: string, event: EventEnvelope): Promise<void>;
}

export const EVENT_BUS_TOKEN = Symbol('EVENT_BUS_TOKEN');
