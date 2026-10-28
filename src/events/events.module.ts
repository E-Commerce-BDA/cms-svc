import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVENT_BUS_TOKEN } from './event-bus/event-bus.interface.js';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import { KafkaEventBus } from './event-bus/kafka-event-bus.js';
import { EventsService } from './events.service.js';

@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS_TOKEN,
      useFactory: (configService: ConfigService) => {
        const brokers = configService.get<string>('KAFKA_BROKERS');
        if (process.env.NODE_ENV === 'test' || !brokers) {
          return new InMemoryEventBus();
        }
        return new KafkaEventBus(configService);
      },
      inject: [ConfigService],
    },
    EventsService,
  ],
  exports: [EVENT_BUS_TOKEN, EventsService],
})
export class EventsModule {}
