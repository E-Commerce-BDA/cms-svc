import { Global, Module } from '@nestjs/common';
import { EVENT_BUS_TOKEN } from './event-bus/event-bus.interface.js';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import { EventsService } from './events.service.js';

@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS_TOKEN,
      useClass: InMemoryEventBus,
    },
    EventsService,
  ],
  exports: [EVENT_BUS_TOKEN, EventsService],
})
export class EventsModule {}
